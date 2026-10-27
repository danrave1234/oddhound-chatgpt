$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $projectRoot
$created = $false
$mutex = [Threading.Mutex]::new($true,'Local\OddhoundChatGPTOwnedDemo',[ref]$created)
if (-not $created) { exit 0 }
$apiUrl = 'http://127.0.0.1:3000/api/development/runner'
function Invoke-RunnerApi($payload) { Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType application/json -Headers @{Origin='http://127.0.0.1:3000'} -Body ($payload | ConvertTo-Json -Depth 30 -Compress) -TimeoutSec 20 }
function Invoke-OwnedCompose { & docker compose -f compose.yaml -f compose.browser-lab.yaml -f compose.paid-lab.yaml @args; if ($LASTEXITCODE -ne 0) { throw 'Owned demo container command failed' } }
function Remove-OwnedBrowser([string]$expectedId) {
  $raw = & docker inspect oddhound-product-browser-lab-1 2>$null
  if ($LASTEXITCODE -ne 0) { return }
  $container = ($raw | ConvertFrom-Json)[0]
  $actualId = ($container.Config.Env | Where-Object { $_.StartsWith('ODDHOUND_RUN_ID=') }) -replace '^ODDHOUND_RUN_ID=',''
  if ($actualId -ne $expectedId) { throw 'The guest belongs to a different run; cleanup is unconfirmed' }
  & docker stop --time 10 oddhound-product-browser-lab-1 | Out-Null
  & docker rm -f oddhound-product-browser-lab-1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Owned guest removal failed' }
}
try {
  Invoke-OwnedCompose --profile paid-lab build meta-lab-controller | Out-Null
  while ($true) {
    try {
      $job = (Invoke-RunnerApi @{operation='claim'}).job
      if (-not $job) { Start-Sleep -Seconds 3; continue }
      $jobId = ([Guid]$job.id).ToString()
      $exitCode = 1
      try {
        if ($job.kind -ne 'cleanup') {
          if ($job.scope.origin -ne 'https://fixture-lab:3002' -or $job.scope.registrationPrefix -notmatch '^lab_[a-f0-9]{10}$') { throw 'Unsupported owned demo scope' }
          $randomBytes = [byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
          $privatePath = [Convert]::ToHexString($randomBytes).ToLowerInvariant()
          $job.scope.expiresAt = ([DateTimeOffset]$job.scope.expiresAt).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
          $scopeJson = $job.scope | ConvertTo-Json -Depth 30 -Compress
          [IO.File]::WriteAllText((Join-Path $projectRoot 'data/browser-lab.env'),"ODDHOUND_RUN_ID=$jobId`nODDHOUND_RUN_PATH=$privatePath`nODDHOUND_SCOPE=$scopeJson`n",[Text.UTF8Encoding]::new($false))
          $env:ODDHOUND_LAB_FIXTURE_CORRECTED = if ($job.corrected) { '1' } else { '0' }
          Invoke-OwnedCompose up -d dns-lab fixture-lab fixture-corrected-lab browser-lab | Out-Null
          $controllerScript = if ($job.kind -eq 'verify') { 'apps/worker/owned-verification.ts' } else { 'apps/worker/lab-meta.ts' }
          & docker compose -f compose.yaml -f compose.browser-lab.yaml -f compose.paid-lab.yaml --profile paid-lab run --rm meta-lab-controller pnpm exec tsx $controllerScript --paid --interactive *> (Join-Path $projectRoot "data/owned-demo-$jobId.log")
          $exitCode = $LASTEXITCODE
        }
      } finally {
        Remove-OwnedBrowser $jobId
        Invoke-RunnerApi @{operation='finish';id=$jobId;exitCode=$exitCode;containerRemoved=$true} | Out-Null
      }
    } catch { Write-Output 'Owned demo execution unavailable; its durable run and cleanup state remain visible.'; Start-Sleep -Seconds 3 }
  }
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }

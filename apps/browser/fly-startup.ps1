param([string]$Image='registry.fly.io/oddhound-chatgpt-browser@sha256:ff2d1972f23ce953d7728001b17343cd4554959e46d1982d1dd08ad46f494bf8')
$ErrorActionPreference='Stop'
$flyExecutable=Join-Path $env:USERPROFILE '.fly/bin/flyctl.exe'
$runId=[Guid]::NewGuid().ToString()
$suffix=$runId.Substring(0,8)
$workerApp='oddhound-chatgpt-worker'
$browserApp='oddhound-chatgpt-browser'
$controllerId=$null;$browserId=$null
$evidence=@{runId=$runId;startedAt=[DateTime]::UtcNow.ToString('o');image=$Image;region='sin';modelInference=$false;siteNavigation=$false;profile='gateway-sandbox-v1';passed=$false;cleanupConfirmed=$false}
function Write-PrivateJson($path,$value){[IO.File]::WriteAllText((Join-Path (Get-Location) $path),($value|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))}
function Machine-List($app){$raw=& $flyExecutable machine list --app $app --json 2>$null;if($LASTEXITCODE -ne 0){throw 'machine_list_failed'};return $raw|ConvertFrom-Json}
try {
  if($Image -notmatch '^registry\.fly\.io/oddhound-chatgpt-browser@sha256:[a-f0-9]{64}$'){throw 'pinned_browser_image_required'}
  $controllerConfig=@{image=$Image;init=@{exec=@('node','-e','setTimeout(()=>{},300000)')};auto_destroy=$true;restart=@{policy='no'};guest=@{cpu_kind='shared';cpus=1;memory_mb=256};services=@();metadata=@{oddhound_probe_id=$runId}}
  Write-PrivateJson 'data/fly-startup-controller.json' $controllerConfig
  & $flyExecutable machine run $controllerConfig.image --app $workerApp --region sin --name "startup-control-$suffix" --machine-config data/fly-startup-controller.json --detach *> data/fly-startup-controller-create.log
  if($LASTEXITCODE -ne 0){throw 'controller_create_failed'}
  $controller=Machine-List $workerApp | Where-Object {$_.name -eq "startup-control-$suffix"} | Select-Object -First 1
  if(-not $controller -or $controller.private_ip -notlike 'fdaa:*'){throw 'controller_private_address_missing'}
  $controllerId=$controller.id
  $privateBytes=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($privateBytes);$privatePath=[Convert]::ToHexString($privateBytes).ToLowerInvariant()
  $expiresAt=[DateTime]::UtcNow.AddSeconds(120).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $scope=@{origin='https://oddhound-chatgpt-browser.fly.dev';writes=$false;registration=$false;expiresAt=$expiresAt;apiOrigins=@();resourceOrigins=@();deniedPaths=@();authorization=@{version=1;mode='mapped';actors=@(@{id='primary';label='Startup-only controller check';credentialReferences=@()});capabilities=@{authenticate=$false;create=$false;edit=$false;cancel=$false;boundary=$true;repeat=$true;unusualOrder=$true};namespace='startup_probe';fixtureIds=@();maxAccounts=0;uiMethods=@('GET','HEAD');operations=@()}}
  $browserConfig=@{image=$Image;auto_destroy=$true;restart=@{policy='no'};guest=@{cpu_kind='shared';cpus=1;memory_mb=2048};services=@();metadata=@{oddhound_probe_id=$runId;oddhound_expires_at=$expiresAt};env=@{ODDHOUND_RUN_ID=$runId;ODDHOUND_RUN_PATH=$privatePath;ODDHOUND_SCOPE=($scope|ConvertTo-Json -Compress -Depth 20);ODDHOUND_TRUSTED_WEB_IPS=$controller.private_ip}}
  Write-PrivateJson 'data/fly-startup-browser.json' $browserConfig
  & $flyExecutable machine run $Image --app $browserApp --region sin --name "startup-browser-$suffix" --machine-config data/fly-startup-browser.json --detach *> data/fly-startup-browser-create.log
  if($LASTEXITCODE -ne 0){throw 'browser_create_failed'}
  $browser=Machine-List $browserApp | Where-Object {$_.name -eq "startup-browser-$suffix"} | Select-Object -First 1
  if(-not $browser -or $browser.private_ip -notlike 'fdaa:*'){throw 'browser_private_address_missing'}
  $browserId=$browser.id
  $url="http://[$($browser.private_ip)]:3001/$privatePath/ready"
  $nodeCode='fetch(process.argv[1],{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(4000)}).then(async r=>{const x=await r.json();console.log(JSON.stringify({ok:r.ok,...x}));}).catch(()=>{console.log(JSON.stringify({error:"private_control_failed"}));process.exitCode=1;})'
  $command="node -e '$nodeCode' '$url'"
  for($attempt=0;$attempt -lt 12;$attempt++){
    $raw=& $flyExecutable machine exec $controllerId $command --app $workerApp --timeout 6 --json 2>$null
    if($LASTEXITCODE -eq 0){try{$exec=$raw|ConvertFrom-Json;$ready=$exec.stdout|ConvertFrom-Json;if($ready.ok -and $ready.runId -eq $runId){$evidence.sandbox=$ready.sandbox;$evidence.privateControl=$true;break}}catch{}}
    Start-Sleep -Seconds 2
  }
  if(-not $evidence.sandbox.enabled -or $evidence.sandbox.uid -ne 1101){throw 'deployed_sandbox_or_control_not_ready'}
  $evidence.passed=$true
} catch { $evidence.error=if($_.Exception.Message -match '^[a-z0-9_]+$'){$_.Exception.Message}else{'fly_startup_failed'} }
finally {
  foreach($pair in @(@{app=$browserApp;id=$browserId},@{app=$workerApp;id=$controllerId})){
    if($pair.id){& $flyExecutable machine destroy $pair.id --app $pair.app --force *> $null}
  }
  try{$leftBrowser=@(Machine-List $browserApp | Where-Object {$_.name -eq "startup-browser-$suffix"});$leftController=@(Machine-List $workerApp | Where-Object {$_.name -eq "startup-control-$suffix"});$evidence.cleanupConfirmed=($leftBrowser.Count -eq 0 -and $leftController.Count -eq 0)}catch{$evidence.cleanupConfirmed=$false}
  if(-not $evidence.cleanupConfirmed){$evidence.passed=$false}
  $evidence.finishedAt=[DateTime]::UtcNow.ToString('o')
  $evidence.claims='Deployed startup/private-control/sandbox component evidence only. No initialization, navigation, website scan, model call or complete runtime/public gate claim. Probe Machines are destroyed afterward.'
  Write-PrivateJson "docs/evidence/fly-startup-$runId.json" $evidence
  Write-PrivateJson 'docs/evidence/fly-startup-latest.json' $evidence
  $evidence|ConvertTo-Json -Depth 10
  if(-not $evidence.passed){exit 1}
}

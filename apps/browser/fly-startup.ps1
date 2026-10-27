param([string]$Image='registry.fly.io/oddhound-chatgpt-browser@sha256:9b3cd6594a805543937fa461eae397e60a25441f68607ad18b16f7f8de3fb4fd')
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
function Invoke-FlyApi($app,$path,$method='GET',$payload=$null){
  $tokenValue=[string]$tokens.$app
  if($tokenValue -notmatch '^(FlyV1 )?[A-Za-z0-9_+/=,.-]+$'){throw 'invalid_scoped_token_format'}
  $headers=@{Authorization=('Bearer '+$tokenValue)}
  $request=@{Uri="https://api.machines.dev/v1/apps/$app$path";Method=$method;Headers=$headers;ContentType='application/json';TimeoutSec=25;SkipHttpErrorCheck=$true;SkipHeaderValidation=$true}
  if($null -ne $payload){$request.Body=$payload|ConvertTo-Json -Depth 30 -Compress}
  $response=Invoke-WebRequest @request
  if($response.StatusCode -eq 404){return $null}
  if($response.StatusCode -lt 200 -or $response.StatusCode -ge 300){throw ('fly_http_'+$response.StatusCode)}
  if($response.Content){return $response.Content|ConvertFrom-Json}
}
function Wait-MachineStarted($app,$id){
  for($poll=0;$poll -lt 30;$poll++){
    $state=Invoke-FlyApi $app ("/machines/$id")
    if(-not $state){throw 'probe_machine_disappeared'}
    if($state.state -eq 'started'){return}
    if($state.state -in @('stopped','destroyed','failed')){throw 'probe_machine_stopped_before_ready'}
    Start-Sleep -Seconds 2
  }
  throw 'probe_machine_start_timeout'
}
try {
  if($Image -notmatch '^registry\.fly\.io/oddhound-chatgpt-browser@sha256:[a-f0-9]{64}$'){throw 'pinned_browser_image_required'}
  $tokensFile=Join-Path (Get-Location) 'data/fly-startup-tokens.json'
  if(Test-Path -LiteralPath $tokensFile){$tokens=Get-Content -LiteralPath $tokensFile -Raw|ConvertFrom-Json}else{$tokens=$null}
  if(-not $tokens -or [DateTimeOffset]$tokens.expiresAt -lt [DateTimeOffset]::UtcNow.AddMinutes(10)){
    $tokens=@{expiresAt=[DateTime]::UtcNow.AddMinutes(55).ToString('o')}
    foreach($app in @($workerApp,$browserApp)){
      $tokenOutput=& $flyExecutable tokens create deploy --app $app --expiry 1h --name 'oddhound-startup-check' 2>$null
      $token=$tokenOutput|Where-Object {$_ -match '^(FlyV1|fm2_)'}|Select-Object -Last 1
      if($LASTEXITCODE -ne 0 -or -not $token){throw 'scoped_token_creation_failed'}
      if($token.Trim() -notmatch '^(FlyV1 )?[A-Za-z0-9_+/=,.-]+$'){throw 'invalid_scoped_token_format'}
      $tokens[$app]=$token.Trim()
    }
    Write-PrivateJson 'data/fly-startup-tokens.json' $tokens
  }
  Write-Output 'Creating the bounded private Fly controller.'
  $controllerConfig=@{image=$Image;init=@{exec=@('node','-e','setTimeout(()=>{},480000)')};auto_destroy=$true;restart=@{policy='no'};guest=@{cpu_kind='shared';cpus=1;memory_mb=256};services=@();metadata=@{oddhound_probe_id=$runId}}
  Write-PrivateJson 'data/fly-startup-controller.json' $controllerConfig
  $controller=Invoke-FlyApi $workerApp '/machines' 'POST' @{name="startup-control-$suffix";region='sin';config=$controllerConfig}
  $controllerId=$controller.id
  if(-not $controller -or $controller.private_ip -notlike 'fdaa:*'){throw 'controller_private_address_missing'}
  Wait-MachineStarted $workerApp $controllerId
  $privateBytes=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($privateBytes);$privatePath=[Convert]::ToHexString($privateBytes).ToLowerInvariant()
  $expiresAt=[DateTime]::UtcNow.AddSeconds(300).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $scope=@{origin='https://oddhound-chatgpt-browser.fly.dev';writes=$false;registration=$false;expiresAt=$expiresAt;apiOrigins=@();resourceOrigins=@();deniedPaths=@();authorization=@{version=1;mode='mapped';actors=@(@{id='primary';label='Startup-only controller check';credentialReferences=@()});capabilities=@{authenticate=$false;create=$false;edit=$false;cancel=$false;boundary=$true;repeat=$true;unusualOrder=$true};namespace='startup_probe';fixtureIds=@();maxAccounts=0;uiMethods=@('GET','HEAD');operations=@()}}
  $browserConfig=@{image=$Image;auto_destroy=$true;restart=@{policy='no'};guest=@{cpu_kind='shared';cpus=1;memory_mb=2048};services=@();metadata=@{oddhound_probe_id=$runId;oddhound_expires_at=$expiresAt};env=@{ODDHOUND_RUN_ID=$runId;ODDHOUND_RUN_PATH=$privatePath;ODDHOUND_SCOPE=($scope|ConvertTo-Json -Compress -Depth 20);ODDHOUND_TRUSTED_WEB_IPS=$controller.private_ip}}
  Write-PrivateJson 'data/fly-startup-browser.json' $browserConfig
  Write-Output 'Creating the fresh private Fly browser.'
  $browser=Invoke-FlyApi $browserApp '/machines' 'POST' @{name="startup-browser-$suffix";region='sin';config=$browserConfig}
  $browserId=$browser.id
  if(-not $browser -or $browser.private_ip -notlike 'fdaa:*'){throw 'browser_private_address_missing'}
  Wait-MachineStarted $browserApp $browserId
  $url="http://[$($browser.private_ip)]:3001/$privatePath/ready"
  $nodeCode='let value;try{const r=await fetch(process.argv[1],{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(4000)});value={ok:r.ok,...await r.json()}}catch(e){value={error:e.name==="TimeoutError"?"private_control_timeout":"private_control_failed"}}process.stdout.write(JSON.stringify(value),()=>process.exit(0))'
  Write-Output 'Checking private readiness and the actual Chromium sandbox.'
  for($attempt=0;$attempt -lt 12;$attempt++){
    try{
      $execResult=Invoke-FlyApi $workerApp ("/machines/$controllerId/exec") 'POST' @{command=@('node','--input-type=module','-e',$nodeCode,$url);timeout=10}
      $ready=$execResult.stdout|ConvertFrom-Json
      if($ready.ok -and $ready.runId -eq $runId){$evidence.sandbox=$ready.sandbox;$evidence.privateControl=$true;break}
      $evidence.lastControlResult=if($ready.error -match '^[a-z0-9_]+$'){$ready.error}else{'not_ready'}
    }catch{$evidence.lastControlResult=if($_.Exception.Message -match '^fly_http_\d{3}$'){$_.Exception.Message}else{'control_probe_failed'}}
    Start-Sleep -Seconds 2
  }
  if(-not $evidence.sandbox.enabled -or $evidence.sandbox.uid -ne 1101){throw 'deployed_sandbox_or_control_not_ready'}
  Write-Output 'Checking browser UID isolation, native egress and a separate untrusted Machine.'
  $networkCode='import net from "node:net";const targets=[{name:"loopback_proxy",host:"127.0.0.1",port:8080,allow:true},{name:"other_loopback",host:"127.0.0.1",port:80},{name:"metadata",host:"169.254.169.254",port:80},{name:"private_v4",host:"10.0.0.1",port:80},{name:"direct_public",host:"1.1.1.1",port:443},{name:"browser_control",host:process.argv[1],port:3001},{name:"controller_6pn",host:process.argv[2],port:3001}];const checks=await Promise.all(targets.map(t=>new Promise(resolve=>{const s=net.createConnection({host:t.host,port:t.port});let done=false;const finish=connected=>{if(done)return;done=true;s.destroy();resolve({name:t.name,connected,expected:Boolean(t.allow)})};s.setTimeout(1200,()=>finish(false));s.once("connect",()=>finish(true));s.once("error",()=>finish(false))})));process.stdout.write(JSON.stringify({uid:process.getuid(),checks}),()=>process.exit(0))'
  $network=Invoke-FlyApi $browserApp ("/machines/$browserId/exec") 'POST' @{command=@('setpriv','--reuid=1101','--regid=1101','--init-groups','--bounding-set=-all','env','-i','PATH=/usr/local/bin:/usr/bin:/bin','node','--input-type=module','-e',$networkCode,$browser.private_ip,$controller.private_ip);timeout=8}
  $networkVerdict=$network.stdout|ConvertFrom-Json
  if($network.exit_code -ne 0 -or $networkVerdict.uid -ne 1101 -or $networkVerdict.checks.Count -ne 7 -or @($networkVerdict.checks|Where-Object {$_.connected -ne $_.expected}).Count){throw 'browser_native_egress_canary_failed'}
  $evidence.nativeEgress=$networkVerdict
  $environmentCode='const names=Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|CREDENTIAL/.test(k));process.stdout.write(JSON.stringify({forbiddenNames:names}),()=>process.exit(0))'
  $environment=Invoke-FlyApi $browserApp ("/machines/$browserId/exec") 'POST' @{command=@('node','-e',$environmentCode);timeout=6}
  $environmentVerdict=$environment.stdout|ConvertFrom-Json
  if($environment.exit_code -ne 0 -or $environmentVerdict.forbiddenNames.Count){throw 'browser_platform_environment_canary_failed'}
  $evidence.platformEnvironment=$environmentVerdict
  $untrusted=Invoke-FlyApi $browserApp '/machines' 'POST' @{name="startup-denied-$suffix";region='sin';config=$controllerConfig}
  Wait-MachineStarted $browserApp $untrusted.id
  $sourceCode='import net from "node:net";const s=net.createConnection({host:process.argv[1],port:3001});let done=false;const finish=connected=>{if(done)return;done=true;s.destroy();process.stdout.write(JSON.stringify({connected}),()=>process.exit(0))};s.setTimeout(1800,()=>finish(false));s.once("connect",()=>finish(true));s.once("error",()=>finish(false))'
  $denied=Invoke-FlyApi $browserApp ("/machines/$($untrusted.id)/exec") 'POST' @{command=@('node','--input-type=module','-e',$sourceCode,$browser.private_ip);timeout=6}
  $sourceVerdict=$denied.stdout|ConvertFrom-Json
  if($denied.exit_code -ne 0 -or $null -eq $sourceVerdict.connected -or $sourceVerdict.connected){throw 'untrusted_control_source_canary_failed'}
  # Recheck the allowed controller after the denied attempt to distinguish a dead service.
  $allowed=Invoke-FlyApi $workerApp ("/machines/$controllerId/exec") 'POST' @{command=@('node','--input-type=module','-e',$nodeCode,$url);timeout=10}
  $allowedVerdict=$allowed.stdout|ConvertFrom-Json
  if(-not $allowedVerdict.ok -or $allowedVerdict.runId -ne $runId){throw 'allowed_control_recheck_failed'}
  $evidence.untrustedSourceDenied=$true
  $evidence.noPublicServices=($null -eq $browser.config.services -or @($browser.config.services).Count -eq 0)
  $evidence.noPersistentMounts=(@($browser.config.mounts).Count -eq 0 -or $null -eq $browser.config.mounts)
  if(-not $evidence.noPublicServices -or -not $evidence.noPersistentMounts){throw 'private_disposable_config_failed'}
  $evidence.passed=$true
} catch { $evidence.error=if($_.Exception.Message -match '^[a-z0-9_]+$'){$_.Exception.Message}else{'fly_startup_failed'};$evidence.errorType=$_.Exception.GetType().Name;$evidence.errorLine=$_.InvocationInfo.ScriptLineNumber }
finally {
  Write-Output 'Destroying the probe Machines and confirming removal.'
  try{
    foreach($app in @($browserApp,$workerApp)){
      $machines=@(Invoke-FlyApi $app '/machines'|Where-Object {$_.config.metadata.oddhound_probe_id -eq $runId})
      foreach($machine in $machines){Invoke-FlyApi $app ("/machines/"+$machine.id+'?force=true') 'DELETE'|Out-Null}
    }
    $leftBrowser=@(Invoke-FlyApi $browserApp '/machines'|Where-Object {$_.config.metadata.oddhound_probe_id -eq $runId});$leftController=@(Invoke-FlyApi $workerApp '/machines'|Where-Object {$_.config.metadata.oddhound_probe_id -eq $runId});$evidence.cleanupConfirmed=($leftBrowser.Count -eq 0 -and $leftController.Count -eq 0)
  }catch{$evidence.cleanupConfirmed=$false}
  if(-not $evidence.cleanupConfirmed){$evidence.passed=$false}
  $evidence.finishedAt=[DateTime]::UtcNow.ToString('o')
  $evidence.claims='Deployed startup/private-control/sandbox component evidence only. No initialization, navigation, website scan, model call or complete runtime/public gate claim. Probe Machines are destroyed afterward.'
  Write-PrivateJson "docs/evidence/fly-startup-$runId.json" $evidence
  Write-PrivateJson 'docs/evidence/fly-startup-latest.json' $evidence
  $evidence|ConvertTo-Json -Depth 10
  if(-not $evidence.passed){exit 1}
}

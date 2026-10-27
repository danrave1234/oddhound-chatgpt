param([Parameter(Mandatory=$true)][Guid]$FindingId,[Parameter(Mandatory=$true)][Guid]$RetestRunId)
$ErrorActionPreference = 'Stop'
$baseUrl = 'http://127.0.0.1:3000'
$checks = [Collections.Generic.List[string]]::new()
$assertionResponse = Invoke-WebRequest "$baseUrl/api/findings/$FindingId/assertion"
$assertion = ($assertionResponse.Content | ConvertFrom-Json).assertion
if ($assertionResponse.StatusCode -ne 200 -or $assertion.attempts.Count -lt 2) { throw 'Saved assertion history missing' }
$checks.Add('owner_read_contains_immutable_spec_and_history')
$run = (Invoke-RestMethod "$baseUrl/api/runs/$RetestRunId")
if ($run.run.execution -ne 'assertion' -or $run.findings[0].lifecycle -ne 'fixed') { throw 'Retest detail must show its original fixed finding' }
if ($run.findings[0].evidence.approvedAssertion.template -ne 'numeric_record_create_v1') { throw 'Original replay recipe missing from report data' }
$checks.Add('retest_run_resolves_original_finding_and_recipe')
$report = (Invoke-WebRequest "$baseUrl/api/runs/$RetestRunId/report").Content
if ($report -is [byte[]]) { $report = [Text.Encoding]::UTF8.GetString($report) }
foreach ($requiredText in @('No model inference (fixed assertion replay)', $assertion.hash, 'numeric_record_create_v1', 'rendered_record_contradicts_rule', 'probe_satisfies_rule_with_valid_control')) {
  if (-not $report.Contains($requiredText)) { throw 'Exported report is missing saved verification evidence' }
}
$checks.Add('report_exports_original_recipe_and_failed_passing_evidence')
$frozen = Invoke-WebRequest "$baseUrl/api/findings/$FindingId/assertion" -Method Post -Headers @{ Origin=$baseUrl } -ContentType application/json -Body ($assertion.spec | ConvertTo-Json -Depth 30) -SkipHttpErrorCheck
if (($frozen.Content | ConvertFrom-Json).error -ne 'assertion_already_frozen') { throw 'HTTP must reject assertion replacement' }
$checks.Add('http_refuses_replacing_frozen_assertion')
$replayBody = @{hash=$assertion.hash;acknowledgeReplayWrites=$true} | ConvertTo-Json
$crossOrigin = Invoke-WebRequest "$baseUrl/api/findings/$FindingId/retest" -Method Post -Headers @{Origin='https://other.example'} -ContentType application/json -Body $replayBody -SkipHttpErrorCheck
if (($crossOrigin.Content | ConvertFrom-Json).error -ne 'request_origin_refused') { throw 'Cross-origin replay request was not refused' }
$checks.Add('http_refuses_cross_origin_replay')
$gated = Invoke-WebRequest "$baseUrl/api/findings/$FindingId/retest" -Method Post -Headers @{Origin=$baseUrl} -ContentType application/json -Body $replayBody -SkipHttpErrorCheck
if (($gated.Content | ConvertFrom-Json).error -notin @('fresh_owner_authorization_required','browser_not_configured','verified_site_execution_not_enabled')) { throw 'Unproved public/runtime profile must refuse new admission' }
$checks.Add('unproved_runtime_cannot_admit_replay')
$after = (Invoke-RestMethod "$baseUrl/api/findings/$FindingId/assertion").assertion
if ($after.attempts.Count -ne $assertion.attempts.Count -or $after.hash -ne $assertion.hash) { throw 'Refused requests must not create attempts or change assertion' }
$checks.Add('refused_requests_leave_hash_and_attempt_history_unchanged')
$result = @{date=[DateTime]::UtcNow.ToString('o');findingId=$FindingId.ToString();retestRunId=$RetestRunId.ToString();passed=$true;checks=$checks.ToArray();identity='explicit local development identity; GitHub OAuth not configured';modelInference=$false}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'docs/evidence/assertion-api.json' -Encoding utf8
$result | ConvertTo-Json -Depth 10

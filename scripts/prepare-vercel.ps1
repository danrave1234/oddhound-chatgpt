$ErrorActionPreference='Stop'
$taskRoot=(Get-Location).Path
$repositoryRoot=(& git rev-parse --show-toplevel).Trim()
if($LASTEXITCODE -ne 0 -or -not [IO.Path]::GetFullPath($repositoryRoot).Equals([IO.Path]::GetFullPath($taskRoot),[StringComparison]::OrdinalIgnoreCase)){throw 'Run this helper from the implementation repository root.'}
$snapshot=@{head=(& git rev-parse HEAD).Trim();sourceHasLocalChanges=[bool](& git status --porcelain);files=@(& git -c core.quotepath=false ls-files)}
if($LASTEXITCODE -ne 0){throw 'Git source inventory failed'}
[IO.Directory]::CreateDirectory((Join-Path $taskRoot 'data'))|Out-Null
[IO.File]::WriteAllText((Join-Path $taskRoot 'data/vercel-git-source.json'),($snapshot|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
docker compose run --rm --no-deps setup node scripts/prepare-vercel.mjs
if($LASTEXITCODE -ne 0){throw 'Vercel source preparation failed'}

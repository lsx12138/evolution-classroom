$ErrorActionPreference = 'Stop'
$stateDir = if ($env:STUDY_CLASSROOM_STATE) { $env:STUDY_CLASSROOM_STATE } else { Join-Path $PSScriptRoot 'state' }
$config = Get-Content -LiteralPath (Join-Path $stateDir 'mobile-gateway.json') -Raw -Encoding UTF8 | ConvertFrom-Json
try {
    $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $config.port + '/health') -TimeoutSec 2
    if ($health.app -eq 'study-whiteboard-gateway') { exit 0 }
} catch { }
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
& (Get-Command node -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'mobile-gateway.mjs') *>> (Join-Path $logDir 'mobile-gateway.log')
exit $LASTEXITCODE

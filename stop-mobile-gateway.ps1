$ErrorActionPreference = 'Stop'
$gatewayScript = Join-Path $PSScriptRoot 'mobile-gateway.mjs'
$wrapperScript = Join-Path $PSScriptRoot 'run-mobile-gateway.ps1'
$stateDir = if ($env:STUDY_CLASSROOM_STATE) { $env:STUDY_CLASSROOM_STATE } else { Join-Path $PSScriptRoot 'state' }
$config = Get-Content -LiteralPath (Join-Path $stateDir 'mobile-gateway.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$publicUri = [Uri]$config.publicOrigin
$proxy = 'http://127.0.0.1:' + $config.port
$recordedGatewayPid = 0
$gatewayVerified = $false
try {
    $recordedGatewayPid = [int]([IO.File]::ReadAllText((Join-Path $stateDir 'mobile-gateway.pid')).Trim())
    $accessToken = [IO.File]::ReadAllText((Join-Path $stateDir 'token')).Trim()
    $health = Invoke-RestMethod -Uri ($proxy + '/health') -TimeoutSec 2
    $tools = Invoke-RestMethod -Uri ($proxy + '/agent/tools') -Headers @{Authorization=('Bearer ' + $accessToken)} -TimeoutSec 2
    $listener = Get-NetTCPConnection -LocalPort $config.port -State Listen -ErrorAction Stop
    $gatewayVerified = $health.app -eq 'study-whiteboard-gateway' -and $tools.tools.Count -eq 15 -and $listener.OwningProcess -contains $recordedGatewayPid
} catch { }
$stopped = 0
$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe' OR Name='tailscale.exe'"
foreach ($candidate in $processes) {
    $line = [string]$candidate.CommandLine
    if (-not $line) { continue }
    $isGateway = $candidate.Name -eq 'node.exe' -and $candidate.ProcessId -eq $recordedGatewayPid -and $gatewayVerified -and $line -match '(?:^|[\s"/\\])mobile-gateway\.mjs(?:"|\s|$)'
    $isWrapper = $candidate.Name -eq 'powershell.exe' -and $line.Contains($wrapperScript)
    $isForwarder = $candidate.Name -eq 'tailscale.exe' -and $line -match '\sserve\s' -and $line.Contains('--https=' + $publicUri.Port) -and $line.Contains($proxy)
    if ($isGateway -or $isWrapper -or $isForwarder) {
        $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $candidate.ProcessId)
        if ($current -and $current.CommandLine -eq $candidate.CommandLine -and $current.CreationDate -eq $candidate.CreationDate) {
            Stop-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
            $stopped++
        }
    }
}
Write-Output ('已停止手机入口的匹配进程：' + $stopped + '。本机白板与已保存内容继续保留。')

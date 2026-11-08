$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot
$stateDir = if ($env:STUDY_CLASSROOM_STATE) { $env:STUDY_CLASSROOM_STATE } else { Join-Path $toolRoot 'state' }
$gatewayConfig = Get-Content -LiteralPath (Join-Path $stateDir 'mobile-gateway.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$publicUri = [Uri]$gatewayConfig.publicOrigin
if ($publicUri.Scheme -ne 'https' -or -not $publicUri.Host.EndsWith('.ts.net')) { throw 'Initialize with your own Tailscale HTTPS origin before starting phone access.' }
$gatewayUrl = 'http://127.0.0.1:' + $gatewayConfig.port
$tailscalePath = (Get-Command tailscale -ErrorAction Stop).Source
$taskMutex = [Threading.Mutex]::new($false, 'Local\StudyWhiteboardManualStart')
$ownsMutex = $false

function Get-StudyHealth([string]$BaseUrl) {
    try { return Invoke-RestMethod -Uri ($BaseUrl + '/health') -TimeoutSec 3 } catch { return $null }
}

function Test-StudyRoute {
    $serveText = & $tailscalePath serve status --json
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Tailscale 转发状态。' }
    $serveConfig = $serveText | ConvertFrom-Json
    $candidates = @($serveConfig)
    if ($serveConfig.Foreground) { $candidates += @($serveConfig.Foreground.PSObject.Properties.Value) }
    foreach ($candidate in $candidates) {
        if ($candidate.TCP -and $candidate.TCP.PSObject.Properties[[string]$publicUri.Port]) {
            $webEntry = $candidate.Web.PSObject.Properties[$publicUri.Authority]
            $handler = if ($webEntry) { $webEntry.Value.Handlers.PSObject.Properties['/'] } else { $null }
            if (-not $handler -or $handler.Value.Proxy -ne $gatewayUrl) {
                throw ('端口 ' + $publicUri.Port + ' 已用于其他服务，请勿覆盖。')
            }
            if ($candidate.AllowFunnel -and $candidate.AllowFunnel.PSObject.Properties[$publicUri.Authority] -and $candidate.AllowFunnel.PSObject.Properties[$publicUri.Authority].Value) {
                throw '该端口存在公网 Funnel 配置，需要先核对，不能直接用于私人课堂。'
            }
            return $true
        }
    }
    return $false
}

try {
    try { $ownsMutex = $taskMutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw '已有一次启动正在进行，请稍后重试。' }
    $tailnetText = & $tailscalePath status --json
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale 未就绪。' }
    $tailnetState = $tailnetText | ConvertFrom-Json
    if ($tailnetState.BackendState -eq 'Stopped') {
        if (-not $tailnetState.Self -or -not $tailnetState.Self.DNSName) { throw '电脑 Tailscale 尚未登录，请先在客户端连接现有账号。' }
        if ($tailnetState.Self.DNSName.TrimEnd('.') -ne $publicUri.Host) { throw '电脑 Tailscale 地址已变化，需要更新接入信息。' }
        throw 'Connect your existing Tailscale account in its app, then retry. This launcher does not change VPN/login settings.'
    }
    if ($tailnetState.BackendState -ne 'Running') { throw '请先让电脑 Tailscale 连接成功。' }
    if ($tailnetState.Self.DNSName.TrimEnd('.') -ne $publicUri.Host) { throw '电脑 Tailscale 地址已变化，需要更新接入信息。' }
    $routeReady = Test-StudyRoute

    Write-Output '正在检查白板后台……'
    & (Get-Command node -ErrorAction Stop).Source (Join-Path $toolRoot 'whiteboard.mjs') call canvas_guide | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '白板后台启动失败，请查看 state/daemon.log。' }

    $health = Get-StudyHealth $gatewayUrl
    if ($health -and $health.app -ne 'study-whiteboard-gateway') { throw '本地入口端口被其他服务占用。' }
    if ($health -and $health.app -eq 'study-whiteboard-gateway' -and $health.version -ne '1.4.0') {
        throw '已有旧版本入口正在运行。先双击“停止手机入口.cmd”，再启动。'
    }
    if (-not $health -or -not $health.ok) {
        $logDir = Join-Path $toolRoot 'logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $workerPath = Join-Path $toolRoot 'run-mobile-gateway.ps1'
        $worker = Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -WindowStyle Hidden -File "' + $workerPath + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'mobile-launcher.out.log') -RedirectStandardError (Join-Path $logDir 'mobile-launcher.err.log')
        $worker.Id | Set-Content -LiteralPath (Join-Path $stateDir 'mobile-launcher.pid') -Encoding ASCII
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 200
            $health = Get-StudyHealth $gatewayUrl
            if ($health -and $health.ok -and $health.app -eq 'study-whiteboard-gateway') { break }
            if ($worker.HasExited) { throw '手机接口进程退出，请查看 logs/mobile-gateway.log。' }
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $health -or -not $health.ok) { throw '手机接口没有按时就绪，请查看日志。' }
    }

    if (-not $routeReady) {
        $logDir = Join-Path $toolRoot 'logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $forwarder = Start-Process -FilePath $tailscalePath -ArgumentList ('serve --https=' + $publicUri.Port + ' ' + $gatewayUrl) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'tailscale-mobile.out.log') -RedirectStandardError (Join-Path $logDir 'tailscale-mobile.err.log')
        $forwarder.Id | Set-Content -LiteralPath (Join-Path $stateDir 'tailscale-mobile.pid') -Encoding ASCII
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $remoteHealth = Get-StudyHealth $gatewayConfig.publicOrigin
        if ($remoteHealth -and $remoteHealth.ok -and $remoteHealth.app -eq 'study-whiteboard-gateway') { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $remoteHealth -or -not $remoteHealth.ok) { throw '本地已运行，但 Tailscale HTTPS 尚不可达，请查看 logs/tailscale-mobile.err.log。' }

    $accessToken = [IO.File]::ReadAllText((Join-Path $stateDir 'token')).Trim()
    $toolsResult = Invoke-RestMethod -Uri ($gatewayConfig.publicOrigin + '/agent/tools') -Headers @{Authorization=('Bearer ' + $accessToken)} -TimeoutSec 10
    if ($toolsResult.tools.Count -ne 21) { throw '远程工具数量与预期不符，需要检查版本。' }
    $setupUrl = $gatewayConfig.publicOrigin + '/mobile/' + $accessToken + '/setup.txt'
    Write-Output '已就绪：白板、共享学习记录、Tailscale HTTPS、21 个工具。'
    Write-Output ('手机接入说明：' + $setupUrl)
    if ($args -contains '-OpenSetup') { Start-Process -FilePath $setupUrl }
} finally {
    if ($ownsMutex) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}

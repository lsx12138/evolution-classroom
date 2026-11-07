$ErrorActionPreference = 'Stop'
$stateDir = if ($env:STUDY_CLASSROOM_STATE) { $env:STUDY_CLASSROOM_STATE } else { Join-Path $PSScriptRoot 'state' }
$endpointPath = Join-Path $stateDir 'minimax-desktop-endpoint.json'
$appPath = Join-Path $env:LOCALAPPDATA 'Programs\MiniMax Code\MiniMax Code.exe'
$processes = @(Get-CimInstance Win32_Process -Filter "Name='MiniMax Code.exe'" | Where-Object { $_.ExecutablePath -eq $appPath })
if ($processes.Count -gt 0) {
    if (Test-Path -LiteralPath $endpointPath) {
        $endpoint = Get-Content -LiteralPath $endpointPath -Raw | ConvertFrom-Json
        if ($processes.ProcessId -contains $endpoint.pid) { Write-Output 'MiniMax desktop classroom connection is already enabled.'; exit 0 }
    }
    throw 'Exit MiniMax Code from its tray menu, then run this classroom launcher again. Existing conversations are preserved.'
}
$env:MAVIS_ELECTRON_ENABLE_DIAGNOSTIC_SIDECAR = '1'
$env:MAVIS_ELECTRON_DIAGNOSTIC_MANIFEST = $endpointPath
Start-Process -FilePath $appPath -WindowStyle Hidden
Remove-Item Env:\MAVIS_ELECTRON_ENABLE_DIAGNOSTIC_SIDECAR
Remove-Item Env:\MAVIS_ELECTRON_DIAGNOSTIC_MANIFEST
Write-Output 'Started MiniMax desktop with its own loopback classroom connection.'

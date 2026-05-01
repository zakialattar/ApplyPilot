$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $scriptDir 'control_center'
$logDir = Join-Path $root 'tmp'
$logFile = Join-Path $logDir 'control-center.log'
$appUrl = 'http://127.0.0.1:8787'
$stateUrl = "$appUrl/api/state"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $root

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    & npm install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE."
    }
}

& npm run build
if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE."
}

$listeners = @()
try {
    $listeners = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop
} catch {
    $listeners = @()
}

if ($listeners.Count -gt 0) {
    Write-Host "Restarting existing ApplyPilot Control Center on $appUrl"
    $listeners |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Seconds 1
}

Set-Content -Path $logFile -Value $null
$launchCommand = "node server/index.mjs > `"$logFile`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', $launchCommand -WorkingDirectory $root -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 20; $i++) {
    try {
        Invoke-WebRequest -Uri $stateUrl -UseBasicParsing | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

Start-Process $appUrl
Write-Host 'Opened ApplyPilot Control Center.'

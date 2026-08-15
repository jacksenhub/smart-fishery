[CmdletBinding()]
param(
    [ValidateSet("before-start", "runtime")]
    [string]$Mode = "runtime"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object Collections.Generic.List[string]
$warnings = New-Object Collections.Generic.List[string]

function Add-Result {
    param(
        [string]$Label,
        [bool]$Passed,
        [string]$Failure,
        [switch]$Warning
    )
    if ($Passed) {
        Write-Host "[OK]   $Label" -ForegroundColor Green
        return
    }
    if ($Warning) {
        Write-Host "[WARN] $Failure" -ForegroundColor Yellow
        $warnings.Add($Failure)
        return
    }
    Write-Host "[FAIL] $Failure" -ForegroundColor Red
    $failures.Add($Failure)
}

function Read-EnvValues {
    param([string]$Path)
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $values }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $parts = $line -split '=', 2
        $values[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $values
}

function Find-ListeningProcess {
    param(
        [int]$Port,
        [ValidateSet("tcp", "udp")]
        [string]$Protocol
    )
    $pattern = if ($Protocol -eq "tcp") {
        ":$Port\s+.*LISTENING"
    } else {
        ":$Port\s+"
    }
    $line = netstat -ano -p $Protocol | Select-String $pattern | Select-Object -First 1
    if (-not $line) { return $null }
    $parts = $line.Line.Trim() -split '\s+'
    $processId = [int]$parts[-1]
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Pid = $processId
        Name = if ($process) { $process.ProcessName } else { "unknown" }
    }
}

Write-Host "Fishery platform preflight ($Mode)" -ForegroundColor Cyan

$nodeVersionText = (& node --version 2>$null).TrimStart('v')
$nodeVersion = $null
$nodeVersionValid = [version]::TryParse($nodeVersionText, [ref]$nodeVersion)
$nodeSupported = $nodeVersionValid -and (
    $nodeVersion.Major -eq 23 -or
    $nodeVersion.Major -eq 24 -or
    ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 20)
)
Add-Result "Node.js $nodeVersionText is supported" $nodeSupported "Node.js $nodeVersionText is unsupported; install Node.js 22.20-24.x."

$backendEnvPath = Join-Path $projectRoot "apps/backend/.env"
$backendEnv = Read-EnvValues $backendEnvPath
$backendToken = [string]$backendEnv["UISYS_API_TOKEN"]
Add-Result "Backend .env exists" (Test-Path -LiteralPath $backendEnvPath) "apps/backend/.env is missing; run npm run setup:devices."
Add-Result "Backend listens on the LAN" ($backendEnv["HOST"] -eq "0.0.0.0") "HOST must be 0.0.0.0 for ESP32 access."
Add-Result "Backend device token is configured" ($backendToken.Length -ge 32) "UISYS_API_TOKEN is missing or shorter than 32 characters."

$desktopAppName = -join ([char[]](0x6E14, 0x535A, 0x58EB))
$desktopEnvPath = Join-Path (Join-Path $env:APPDATA $desktopAppName) "backend.env"
$desktopEnv = Read-EnvValues $desktopEnvPath
$desktopToken = [string]$desktopEnv["UISYS_API_TOKEN"]
Add-Result "Desktop app device token matches backend" ($desktopToken.Length -ge 32 -and $desktopToken -eq $backendToken) "Desktop app configuration is missing or has a different token; run npm run setup:desktop before building/using the desktop app." -Warning

$firmwareSecretPaths = @(
    "firmware/esp32/esp32_simplefoc_dual_propulsion/wifi_secrets.h",
    "firmware/esp32/maker_esp32_pro_servo_temp_01/wifi_secrets.h",
    "firmware/esp32/maker_esp32_pro_four_servo_02/wifi_secrets.h",
    "firmware/esp32/maker_esp32_pro_gps_only/wifi_secrets.h"
)
foreach ($relativePath in $firmwareSecretPaths) {
    $path = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Add-Result $relativePath $false "$relativePath is missing; run npm run setup:devices."
        continue
    }
    $text = Get-Content -LiteralPath $path -Raw
    $ssid = [regex]::Match($text, 'WIFI_SSID\[\]\s*=\s*"([^"]*)"').Groups[1].Value
    $password = [regex]::Match($text, 'WIFI_PASSWORD\[\]\s*=\s*"([^"]*)"').Groups[1].Value
    $token = [regex]::Match($text, 'UISYS_API_TOKEN\[\]\s*=\s*"([^"]*)"').Groups[1].Value
    $placeholder = $ssid -match 'replace-with|your-wifi' -or $password -match 'replace-with|your-wifi'
    Add-Result "$relativePath Wi-Fi is configured" (-not $placeholder -and $ssid.Length -gt 0 -and $password.Length -gt 0) "$relativePath still contains Wi-Fi placeholders."
    Add-Result "$relativePath token matches backend" ($backendToken.Length -ge 32 -and $token -eq $backendToken) "$relativePath token does not match apps/backend/.env; run npm run setup:devices and re-upload that board."
}

$gitIgnorePath = Join-Path $projectRoot ".gitignore"
$gitIgnoreText = Get-Content -LiteralPath $gitIgnorePath -Raw
Add-Result "Firmware secrets are ignored by Git" ($gitIgnoreText -match '\*\*/wifi_secrets\.h') "wifi_secrets.h is not protected by .gitignore."

if ($Mode -eq "before-start") {
    foreach ($item in @(
        @{ Port = 3000; Protocol = "tcp"; Label = "frontend" },
        @{ Port = 5000; Protocol = "tcp"; Label = "backend" },
        @{ Port = 42110; Protocol = "udp"; Label = "ESP32 discovery" }
    )) {
        $listener = Find-ListeningProcess -Port $item.Port -Protocol $item.Protocol
        $available = $null -eq $listener
        $detail = if ($listener) { "PID $($listener.Pid), process $($listener.Name)" } else { "" }
        Add-Result "$($item.Label) port $($item.Port) is available" $available "Port $($item.Port) is already in use ($detail). Stop the previous project process before starting another one."
    }
} else {
    try {
        $web = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/desktop-health" -TimeoutSec 5
        Add-Result "Frontend service is healthy" ($web.service -eq "fishery-digital-twin-web") "Frontend service on port 3000 did not return the expected health response."
    } catch {
        Add-Result "Frontend service is healthy" $false "Frontend is unreachable on http://127.0.0.1:3000."
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/health" -TimeoutSec 5
        Add-Result "Backend service is healthy" ($health.service -eq "fishery-digital-twin-api") "Backend service on port 5000 did not return the expected health response."
        foreach ($device in $health.servos.devices) {
            Add-Result "$($device.device_id) is online" ([bool]$device.online) "$($device.device_id) is offline; verify power, hotspot, firmware upload, and token." -Warning
        }
    } catch {
        Add-Result "Backend service is healthy" $false "Backend is unreachable on http://127.0.0.1:5000."
    }
}

$tcpRule = netsh advfirewall firewall show rule name="Fishery Platform API TCP 5000" 2>$null | Out-String
$udpRule = netsh advfirewall firewall show rule name="Fishery Platform Discovery UDP 42110" 2>$null | Out-String
Add-Result "Private-network TCP 5000 firewall rule exists" ($tcpRule -match '5000' -and $tcpRule -match 'Private') "TCP 5000 private-network firewall rule is missing; run npm run setup:network." -Warning
Add-Result "Private-network UDP 42110 firewall rule exists" ($udpRule -match '42110' -and $udpRule -match 'Private') "UDP 42110 private-network firewall rule is missing; run npm run setup:network." -Warning

Write-Host ""
Write-Host "Result: $($failures.Count) failure(s), $($warnings.Count) warning(s)." -ForegroundColor $(if ($failures.Count -gt 0) { "Red" } elseif ($warnings.Count -gt 0) { "Yellow" } else { "Green" })
if ($failures.Count -gt 0) { exit 1 }

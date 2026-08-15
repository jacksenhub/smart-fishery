[CmdletBinding()]
param(
    [switch]$RotateToken,
    [switch]$SyncDesktopOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendEnvPath = Join-Path $projectRoot "apps/backend/.env"
$desktopAppName = -join ([char[]](0x6E14, 0x535A, 0x58EB))
$desktopEnvDirectory = Join-Path $env:APPDATA $desktopAppName
$desktopEnvPath = Join-Path $desktopEnvDirectory "backend.env"
$firmwareSecretPaths = @(
    (Join-Path $projectRoot "firmware/esp32/esp32_simplefoc_dual_propulsion/wifi_secrets.h"),
    (Join-Path $projectRoot "firmware/esp32/maker_esp32_pro_servo_temp_01/wifi_secrets.h"),
    (Join-Path $projectRoot "firmware/esp32/maker_esp32_pro_four_servo_02/wifi_secrets.h"),
    (Join-Path $projectRoot "firmware/esp32/maker_esp32_pro_gps_only/wifi_secrets.h")
)

function New-RandomHexToken {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return ([BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
}

function ConvertFrom-LocalSecureString {
    param([Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function ConvertTo-CStringLiteral {
    param([string]$Value)
    return $Value.Replace("\", "\\").Replace('"', '\"')
}

function Write-Utf8WithoutBom {
    param(
        [string]$Path,
        [string]$Value
    )
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $Value, $encoding)
}

if ($SyncDesktopOnly) {
    if ($RotateToken) {
        throw "-RotateToken and -SyncDesktopOnly cannot be used together."
    }
    if (-not (Test-Path -LiteralPath $backendEnvPath)) {
        throw "apps/backend/.env is missing; run npm run setup:devices first."
    }
    $existingEnv = Get-Content -LiteralPath $backendEnvPath -Raw
    $tokenMatch = [regex]::Match($existingEnv, "(?m)^UISYS_API_TOKEN=(.+)$")
    $token = if ($tokenMatch.Success) { $tokenMatch.Groups[1].Value.Trim() } else { "" }
    if ($token.Length -lt 32) {
        throw "UISYS_API_TOKEN is missing or shorter than 32 characters; run npm run setup:devices first."
    }
    if (-not (Test-Path -LiteralPath $desktopEnvDirectory)) {
        New-Item -ItemType Directory -Path $desktopEnvDirectory | Out-Null
    }
    $desktopEnv = @"
HOST=0.0.0.0
PORT=5000
UISYS_DISCOVERY_PORT=42110
UISYS_API_TOKEN=$token
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
"@
    Write-Utf8WithoutBom -Path $desktopEnvPath -Value ($desktopEnv.TrimEnd() + "`r`n")
    Write-Host "Desktop app configuration was synchronized without printing secrets."
    exit 0
}

$ssid = Read-Host "Hotspot/Wi-Fi name (SSID)"
if ([string]::IsNullOrWhiteSpace($ssid)) {
    throw "SSID cannot be empty."
}

$securePassword = Read-Host "Hotspot/Wi-Fi password" -AsSecureString
$wifiPassword = ConvertFrom-LocalSecureString $securePassword
if ([string]::IsNullOrWhiteSpace($wifiPassword)) {
    throw "Wi-Fi password cannot be empty."
}

$envText = if (Test-Path -LiteralPath $backendEnvPath) {
    Get-Content -LiteralPath $backendEnvPath -Raw
} else {
    ""
}

$existingTokenMatch = [regex]::Match($envText, "(?m)^UISYS_API_TOKEN=(.+)$")
$existingToken = if ($existingTokenMatch.Success) {
    $existingTokenMatch.Groups[1].Value.Trim()
} else {
    ""
}
$tokenWasRotated = $RotateToken -or $existingToken.Length -lt 32
$token = if ($tokenWasRotated) { New-RandomHexToken } else { $existingToken }

$requiredEnv = [ordered]@{
    HOST = "0.0.0.0"
    PORT = "5000"
    UISYS_API_TOKEN = $token
    CORS_ORIGIN = "http://localhost:3000,http://127.0.0.1:3000"
}

foreach ($entry in $requiredEnv.GetEnumerator()) {
    $pattern = "(?m)^" + [regex]::Escape($entry.Key) + "=.*$"
    $line = $entry.Key + "=" + $entry.Value
    if ([regex]::IsMatch($envText, $pattern)) {
        $envText = [regex]::Replace($envText, $pattern, $line)
    } else {
        if ($envText.Length -gt 0 -and -not $envText.EndsWith("`n")) {
            $envText += "`r`n"
        }
        $envText += $line + "`r`n"
    }
}

Write-Utf8WithoutBom -Path $backendEnvPath -Value ($envText.TrimEnd() + "`r`n")

if (-not (Test-Path -LiteralPath $desktopEnvDirectory)) {
    New-Item -ItemType Directory -Path $desktopEnvDirectory | Out-Null
}
$desktopEnv = @"
HOST=0.0.0.0
PORT=5000
UISYS_DISCOVERY_PORT=42110
UISYS_API_TOKEN=$token
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
"@
Write-Utf8WithoutBom -Path $desktopEnvPath -Value ($desktopEnv.TrimEnd() + "`r`n")

$escapedSsid = ConvertTo-CStringLiteral $ssid
$escapedPassword = ConvertTo-CStringLiteral $wifiPassword
$escapedToken = ConvertTo-CStringLiteral $token
$header = @"
#pragma once

inline constexpr char WIFI_SSID[] = "$escapedSsid";
inline constexpr char WIFI_PASSWORD[] = "$escapedPassword";
inline constexpr char UISYS_API_TOKEN[] = "$escapedToken";
"@

foreach ($path in $firmwareSecretPaths) {
    Write-Utf8WithoutBom -Path $path -Value ($header.TrimEnd() + "`r`n")
}

$wifiPassword = $null
$securePassword.Dispose()
Write-Host "Configured backend and all active firmware secret files. Secret values were not printed."
if ($tokenWasRotated) {
    Write-Host "A new device token was generated. Every ESP32 using this backend must be re-uploaded."
} else {
    Write-Host "The existing device token was preserved."
}
Write-Host "Restart the project, then re-upload the ESP32 sketches used by this boat."

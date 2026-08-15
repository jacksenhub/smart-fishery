[CmdletBinding()]
param(
    [switch]$InstallDependencies,
    [switch]$CompileAll
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Find-ArduinoCli {
    $command = Get-Command arduino-cli -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"),
        "C:/Program Files/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
    )

    $shortcutPath = Join-Path $env:APPDATA "Microsoft/Windows/Start Menu/Programs/Arduino IDE.lnk"
    if (Test-Path -LiteralPath $shortcutPath) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath) {
            $candidates += Join-Path (Split-Path -Parent $shortcut.TargetPath) "resources/app/lib/backend/resources/arduino-cli.exe"
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "Arduino CLI was not found. Install Arduino IDE 2.x first."
}

$cli = Find-ArduinoCli
Write-Host "Arduino CLI: $cli"

$coreList = & $cli core list | Out-String
if ($coreList -notmatch 'esp32:esp32') {
    if (-not $InstallDependencies) {
        throw "ESP32 Arduino core is missing. Run npm run firmware:setup."
    }
    & $cli core install esp32:esp32
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$requiredLibraries = @(
    "ESP32Servo@3.2.1",
    "TinyGPSPlus@1.0.3",
    "Simple FOC@2.4.0"
)

if ($InstallDependencies) {
    foreach ($library in $requiredLibraries) {
        & $cli lib install $library
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host "Firmware dependencies are installed."
}

if ($CompileAll) {
    $sketches = @(
        "firmware/esp32/maker_esp32_pro_servo_temp_01/maker_esp32_pro_servo_temp_01.ino",
        "firmware/esp32/maker_esp32_pro_four_servo_02/maker_esp32_pro_four_servo_02.ino",
        "firmware/esp32/maker_esp32_pro_gps_only/maker_esp32_pro_gps_only.ino",
        "firmware/esp32/esp32_simplefoc_dual_propulsion/esp32_simplefoc_dual_propulsion.ino"
    )
    foreach ($relativePath in $sketches) {
        $sketch = Join-Path $projectRoot $relativePath
        Write-Host "Compiling $relativePath"
        & $cli compile --fqbn esp32:esp32:esp32 $sketch
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host "All firmware sketches compiled successfully."
}

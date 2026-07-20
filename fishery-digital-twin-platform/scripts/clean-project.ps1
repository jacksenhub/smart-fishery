$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path

$Targets = @(
    "apps\frontend\.next",
    "apps\backend\dist",
    "packages\shared\dist",
    "apps\frontend\tsconfig.typecheck.tsbuildinfo"
)

$StaleNextDirs = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "apps\frontend") -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like ".next_stale_*" } |
    Select-Object -ExpandProperty FullName

Write-Host ""
Write-Host "Cleaning generated project files..."
Write-Host "Project root: $RootPath"
Write-Host ""

function Remove-GeneratedItem {
    param(
        [string]$LiteralPath,
        [string]$DisplayName
    )

    try {
        Remove-Item -LiteralPath $LiteralPath -Recurse -Force -ErrorAction Stop
        Write-Host "Removed: $DisplayName"
    } catch [System.IO.FileNotFoundException] {
        Write-Host "Already clean: $DisplayName"
    } catch [System.Management.Automation.ItemNotFoundException] {
        Write-Host "Already clean: $DisplayName"
    } catch {
        Write-Host "Could not fully remove: $DisplayName"
        Write-Host "Reason: $($_.Exception.Message)"
        Write-Host "Stop the running dev server with Ctrl+C, then run npm run clean again."
        throw
    }
}

foreach ($RelativeTarget in $Targets) {
    $Target = Join-Path $ProjectRoot $RelativeTarget
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Host "Already clean: $RelativeTarget"
        continue
    }

    $ResolvedTarget = (Resolve-Path -LiteralPath $Target).Path
    if (-not $ResolvedTarget.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove outside project: $ResolvedTarget"
    }

    Remove-GeneratedItem -LiteralPath $ResolvedTarget -DisplayName $RelativeTarget
}

foreach ($StaleDir in $StaleNextDirs) {
    $ResolvedTarget = (Resolve-Path -LiteralPath $StaleDir).Path
    if (-not $ResolvedTarget.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove outside project: $ResolvedTarget"
    }

    Remove-GeneratedItem -LiteralPath $ResolvedTarget -DisplayName "apps\frontend\$((Split-Path -Leaf $ResolvedTarget))"
}

Write-Host ""
Write-Host "Done. Source code, firmware, models, docs, node_modules, and .env were kept."

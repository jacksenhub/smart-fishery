[CmdletBinding()]
param(
    [string]$InterfaceAlias = "WLAN",
    [int]$ApiPort = 5000,
    [int]$DiscoveryPort = 42110
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"' + $PSCommandPath + '"'),
        "-InterfaceAlias", ('"' + $InterfaceAlias + '"'),
        "-ApiPort", $ApiPort,
        "-DiscoveryPort", $DiscoveryPort
    )
    $process = Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    exit $process.ExitCode
}

$profile = Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias
if ($profile.NetworkCategory -eq "DomainAuthenticated") {
    throw "The '$InterfaceAlias' network is domain-managed and cannot be changed by this script."
}

if ($profile.NetworkCategory -ne "Private") {
    Set-NetConnectionProfile -InterfaceAlias $InterfaceAlias -NetworkCategory Private
}

$tcpRuleName = "Fishery Platform API TCP $ApiPort"
$udpRuleName = "Fishery Platform Discovery UDP $DiscoveryPort"

if (-not (Get-NetFirewallRule -DisplayName $tcpRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
        -DisplayName $tcpRuleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $ApiPort `
        -Profile Private | Out-Null
}

if (-not (Get-NetFirewallRule -DisplayName $udpRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
        -DisplayName $udpRuleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol UDP `
        -LocalPort $DiscoveryPort `
        -Profile Private | Out-Null
}

$updatedProfile = Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias
$tcpRule = Get-NetFirewallRule -DisplayName $tcpRuleName
$udpRule = Get-NetFirewallRule -DisplayName $udpRuleName

[pscustomobject]@{
    Interface = $InterfaceAlias
    NetworkCategory = $updatedProfile.NetworkCategory
    Tcp5000 = $tcpRule.Enabled
    Udp42110 = $udpRule.Enabled
}

#Requires -Version 5.1
<#
.SYNOPSIS
  Reinstall Janus from the repo. Data is kept unless -RemoveData yes is given.

.DESCRIPTION
  -RemoveData no (default)
    install-local.ps1 only: closes the app, replaces Janus.exe, restarts the service if it was
    running. settings.json and logs are kept.
  -RemoveData yes
    Asks for confirmation (skipped with -Yes), then remove-local.ps1 (deletes the whole local
    install, settings, configs, logs and the app data/database), then install-local.ps1
    (fresh install, service started). Also run by: janus rebuild --remove-data=yes

.PARAMETER RemoveData
  'no' keeps settings.json and logs (default). 'yes' wipes them.

.PARAMETER Yes
  Skips the confirmation prompt for -RemoveData yes.

.EXAMPLE
  .\reinstall.ps1
.EXAMPLE
  .\reinstall.ps1 -RemoveData yes -Yes
#>
param(
    [ValidateSet('no', 'yes')]
    [string]$RemoveData = 'no',
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_common.ps1"

if ($RemoveData -eq 'no') {
    Write-Host '=== reinstall: update in place (settings.json and logs kept) ==='
    & "$PSScriptRoot\install-local.ps1"
    $installExit = $LASTEXITCODE
    if ($null -eq $installExit) { $installExit = 0 }
    if ($installExit -ne 0) {
        throw "install-local.ps1 failed with exit code $installExit"
    }
    Write-Host '=== reinstall: done (data kept) ==='
    exit 0
}

if (-not $Yes) {
    $answer = Read-Host 'This deletes ALL Janus settings, data and logs. Type "yes" to continue'
    if ($answer.Trim().ToLowerCase() -ne 'yes') {
        Write-Host 'Cancelled. Nothing was changed.'
        exit 1
    }
}

# Elevate ONCE here so remove-local.ps1 runs inline: it would otherwise spawn its own elevated
# child and return before the removal finished, racing the install below.
$needsElevation = (Test-JanusServiceExists -Name $script:JanusApiService) -or
    (Test-JanusServiceExists -Name $script:JanusWebuiService) -or
    (Test-Path -LiteralPath $script:JanusInstallRoot)
if ($needsElevation -and -not (Test-JanusAdmin)) {
    Write-Host 'Legacy install detected. Relaunching elevated (UAC prompt)...'
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-RemoveData', 'yes', '-Yes') | Out-Null
        exit 0
    }
    catch {
        Write-Warning "Elevation cancelled - nothing was changed: $($_.Exception.Message)"
        exit 1
    }
}

Write-Host '=== reinstall: remove ==='
& "$PSScriptRoot\remove-local.ps1"
$removeExit = $LASTEXITCODE
if ($null -eq $removeExit) { $removeExit = 0 }
if ($removeExit -ne 0) {
    throw "remove-local.ps1 failed with exit code $removeExit"
}

Write-Host '=== reinstall: install ==='
& "$PSScriptRoot\install-local.ps1"
$installExit = $LASTEXITCODE
if ($null -eq $installExit) { $installExit = 0 }
if ($installExit -ne 0) {
    throw "install-local.ps1 failed with exit code $installExit"
}

Write-Host '=== reinstall: done (fresh local install, service started) ==='
exit 0

#Requires -Version 5.1
<#
.SYNOPSIS
  Remove Janus: the local install (%LOCALAPPDATA%\Janus + %ProgramData%\Janus app data + user PATH entry) and, when present,
  the legacy install (Windows services 'janus'/'janus-webui', C:\Program Files\Janus,
  %ProgramData%\Janus).

.DESCRIPTION
  The local-only part needs no administrator rights. When the legacy install is detected the
  script relaunches itself elevated (UAC prompt) because deleting Windows services and
  C:\Program Files requires elevation. Cancelling the UAC prompt removes nothing.

.EXAMPLE
  .\remove-local.ps1
#>
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_common.ps1"

function Test-JanusLegacyInstall {
    if (Test-JanusServiceExists -Name $script:JanusApiService) { return $true }
    if (Test-JanusServiceExists -Name $script:JanusWebuiService) { return $true }
    if (Test-Path -LiteralPath $script:JanusInstallRoot) { return $true }
    return $false
}

$legacyPresent = Test-JanusLegacyInstall

if ($legacyPresent -and -not (Test-JanusAdmin)) {
    Write-Host 'Legacy install detected - elevation required to remove it (UAC prompt)...'
    try {
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList | Out-Null
        exit 0
    }
    catch {
        Write-Warning "Elevation cancelled - nothing was removed: $($_.Exception.Message)"
        exit 1
    }
}

# 1. Local install (no admin): close app -> delete %LOCALAPPDATA%\Janus -> drop PATH entry.
$root = Get-JanusLocalRoot
Write-JanusLocalLog Info 'remove-local: removing local install'
Stop-JanusLocalProcesses
if (Test-Path -LiteralPath $root) {
    Write-Host "Removing local install: $root"
    Remove-JanusLocalPathWithRetry -Path $root
}
else {
    Write-Host "No local install at $root (skipping)."
}
Remove-JanusUserPathEntry -Dir $root
Clear-JanusLocalRoot

# 1b. App data (database, repo-bank, ...) under %ProgramData%\Janus.
if (Test-Path -LiteralPath $script:JanusDataRoot) {
    Write-Host "Removing app data: $script:JanusDataRoot"
    Remove-JanusLocalPathWithRetry -Path $script:JanusDataRoot
}

# 2. Legacy install (admin): services + C:\Program Files\Janus + %ProgramData%\Janus.
if ($legacyPresent) {
    Write-Host 'Removing legacy install (services janus/janus-webui, C:\Program Files\Janus, %ProgramData%\Janus)...'
    Remove-JanusAppCompletely
}

Write-Host 'Janus removed.'
# Ensure a successful remove does not inherit a native sc.exe miss code (1060).
Clear-JanusNativeExitCode
exit 0

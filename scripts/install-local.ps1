#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update local Janus as a single Janus.exe. First install asks for the location:
    1) %LOCALAPPDATA%\Janus (default, no admin)   2) %APPDATA%\Janus
    3) %ProgramFiles%\Janus (admin, UAC prompt)   4) custom absolute folder
  The chosen folder is saved in HKCU:\Software\Janus (InstallDir); updates keep it.

.DESCRIPTION
  Install layout:
    <root>\Janus.exe                single executable (API + WebUI embedded)
    <root>\settings.json            app settings (created from template, preserved on update)
    <root>\logs\infos\YYYY-MM-DD.txt     info log    (one file per day)
    <root>\logs\warnings\YYYY-MM-DD.txt  warning log (one file per day)
    <root>\logs\errors\YYYY-MM-DD.txt    error log   (one file per day)

  Fresh install     : builds Janus.exe, installs it, adds the install dir to your user PATH,
                      and starts the background service.
  Already installed : closes the running app, removes the old Janus.exe, replaces it with the
                      new build, then restarts the service if it was running before
                      (settings.json and logs are preserved).

  After installing, open a NEW terminal and use:
    janus doctor | janus status | janus help
    janus run [--port=N] [--no-open]
    janus port [--port=N]
    janus service start [--port=N] | janus service stop | janus service status
    janus service restart [--port=N]
    janus stop | janus rebuild [--remove-data=no|yes] [-y]
    janus remove | janus uninstall | janus update
  (--port defaults to the configured port, initial default 47911; change it with: janus port --port=N.)

.EXAMPLE
  .\install-local.ps1
#>
param(
    # `janus rebuild` passes this so the service always starts after the rebuild.
    [switch]$StartService,
    # Install folder; skips the location prompt. Omit to use the saved/default location.
    [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_common.ps1"

$root = Resolve-JanusInstallRoot -Requested $InstallDir
$previousRoot = Get-JanusSavedLocalRoot

# Program Files needs admin: relaunch elevated with the chosen folder (one UAC prompt).
if ((Test-JanusUnderProgramFiles -Dir $root) -and -not (Test-JanusAdmin)) {
    Write-Host 'Program Files install selected - relaunching as Administrator (UAC)...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-InstallDir', ('"{0}"' -f $root))
    if ($StartService) { $argList += '-StartService' }
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
    exit $p.ExitCode
}
Set-JanusLocalRoot -Dir $root
$exe = Join-Path $root 'Janus.exe'
$alreadyInstalled = Test-Path -LiteralPath $exe
$wasRunning = $false
if ($alreadyInstalled) {
    $running = @(Get-JanusLocalInstances)
    $wasRunning = $running.Count -gt 0
}

Write-Host "Janus local root: $root"
$mode = if ($alreadyInstalled) { 'update' } else { 'fresh install' }
if ($wasRunning) { $mode += ' (app running -> close, replace, restart)' }
Write-Host "Mode:             $mode"

# 1. Build the new exe FIRST: a build failure must not disturb the installed app.
$staged = Get-JanusStagedExePath
Write-Host 'Building Janus.exe (WebUI + API -> single executable)...'
& "$PSScriptRoot\build-janus-exe.ps1" -OutExe $staged | Out-Null
if (-not (Test-Path -LiteralPath $staged)) { throw "Build did not produce $staged" }

# 2. Layout: logs\{infos,warnings,errors} + seed settings.json (never overwrites an existing one).
Ensure-JanusLocalLayout
# Lets `janus rebuild` find scripts\install-local.ps1 from any directory.
Set-Content -LiteralPath (Join-Path $root 'repo-root.txt') -Value (Get-JanusRepoRoot) -Encoding UTF8

# 3. Close app -> remove old .exe -> replace with the new .exe (retries on file locks).
Copy-JanusLocalFileWithRetry -Source $staged -Destination $exe

# 4. Make `janus ...` resolvable: add the install dir to the user PATH (no admin needed).
if ($previousRoot -and ($previousRoot -ne $root)) { Remove-JanusUserPathEntry -Dir $previousRoot }
Add-JanusUserPathEntry -Dir $root

# 5. Start fresh / restart-if-running; a stopped app stays stopped after an update.
if ($wasRunning -or -not $alreadyInstalled -or $StartService) {
    Write-Host 'Starting service...'
    & $exe service start
    if ($LASTEXITCODE -ne 0) { throw "janus service start failed (exit $LASTEXITCODE)" }
}
else {
    Write-Host 'App was stopped before the update - leaving it stopped (run: janus service start).'
}

$outcome = if ($wasRunning) { 'updated, service restarted' } elseif ($alreadyInstalled) { 'updated, service left stopped' } else { 'installed, service started' }
Write-JanusLocalLog Info "install-local: $outcome"
Write-Host ''
Write-Host "Janus installed: $exe"
Write-Host 'Open a NEW terminal, then try:  janus doctor   |   janus help   |   janus run'
exit 0

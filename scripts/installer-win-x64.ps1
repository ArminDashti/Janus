#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update Janus (Windows x64): build Janus.exe, deploy to %LOCALAPPDATA%\Janus,
  add the install dir to the user PATH, and optionally map --local-address in the hosts file.

.EXAMPLE
  .\installer-win-x64.ps1
  .\installer-win-x64.ps1 --local-address=janus.local
#>
param(
    [string]$LocalAddress,
    [string]$ParentLocalAppData,
    [string]$InstallDir,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_common.ps1"

# PowerShell never binds --local-address forms to a param - they land in the remaining args.
for ($i = 0; $i -lt $Rest.Count; $i++) {
    $tok = [string]$Rest[$i]
    if ($tok -match '^--local-address=(.+)$') { $LocalAddress = $Matches[1] }
    elseif ($tok -eq '--local-address' -and ($i + 1) -lt $Rest.Count) { $LocalAddress = [string]$Rest[$i + 1]; $i++ }
}

# Elevated relaunch guard: never install under a different account's profile.
if ($ParentLocalAppData -and ($ParentLocalAppData -ne $env:LOCALAPPDATA)) {
    Write-Host "Elevation switched user profiles (expected '$ParentLocalAppData', got '$env:LOCALAPPDATA') - aborting." -ForegroundColor Red
    exit 1
}

if ($LocalAddress -and $LocalAddress -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$') {
    Write-Host "Invalid --local-address '$LocalAddress' (letters, digits, dots and hyphens only)." -ForegroundColor Red
    exit 1
}

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$root = Resolve-JanusInstallRoot -Requested $InstallDir
$exe = Join-Path $root 'Janus.exe'
$previousRoot = Get-JanusSavedLocalRoot

# Hosts editing and Program Files need Administrator: restart the whole script elevated; fail fast if UAC is declined.
$needsAdmin = $LocalAddress -or (Test-JanusUnderProgramFiles -Dir $root)
if ($needsAdmin -and -not (Test-JanusAdmin)) {
    Write-Host 'Administrator rights needed (hosts edit or Program Files) - relaunching as Administrator (UAC)...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
        '-InstallDir', ('"{0}"' -f $root), '-ParentLocalAppData', ('"{0}"' -f $env:LOCALAPPDATA))
    if ($LocalAddress) { $argList += @('-LocalAddress', $LocalAddress) }
    try {
        $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $p.ExitCode
    }
    catch {
        Write-Host "Elevation declined - nothing was installed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Re-run as Administrator, or omit --local-address.' -ForegroundColor Red
        exit 1
    }
}

Set-JanusLocalRoot -Dir $root

# 1. Build FIRST: a build failure must not disturb the installed app.
$staged = Get-JanusStagedExePath
Write-Host "Building Janus.exe -> $staged ..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot\build-janus-exe.ps1" -OutExe $staged | Out-Null
}
catch {
    Write-Host "Build FAILED - nothing was installed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $staged)) {
    Write-Host "Build FAILED - no exe at $staged (nothing was installed)." -ForegroundColor Red
    exit 1
}
Write-Host 'Build OK.' -ForegroundColor Green

# 2. Graceful stop; Copy-JanusLocalFileWithRetry force-kills any leftover instances.
$alreadyInstalled = Test-Path -LiteralPath $exe
$wasRunning = $false
if ($alreadyInstalled) {
    $running = @(Get-JanusLocalInstances)
    $wasRunning = $running.Count -gt 0
    if ($wasRunning) {
        Write-Host "Stopping running Janus (PID(s) $(($running | ForEach-Object { $_.ProcessId }) -join ', '))..." -ForegroundColor Yellow
        & $exe service stop
    }
}

# 3. Layout: logs + settings.json (template-seeded) + empty Data.db placeholder.
Ensure-JanusLocalLayout
$dbPath = Join-Path $root 'Data.db'
if (-not (Test-Path -LiteralPath $dbPath)) {
    New-Item -ItemType File -Path $dbPath -Force | Out-Null
    Write-Host 'Created empty Data.db.' -ForegroundColor Green
}

# 4. Replace the exe (removes the old one first, tolerates file locks).
Write-Host 'Deploying Janus.exe...' -ForegroundColor Yellow
Copy-JanusLocalFileWithRetry -Source $staged -Destination $exe
Write-Host "Installed: $exe" -ForegroundColor Green

# 5. Make `janus ...` resolvable: user PATH entry (idempotent, no admin needed).
if ($previousRoot -and ($previousRoot -ne $root)) { Remove-JanusUserPathEntry -Dir $previousRoot }
Add-JanusUserPathEntry -Dir $root

# 6. hosts: append 127.0.0.1 <name> tagged with # janus-local (skipped if already mapped).
if ($LocalAddress) {
    if (-not (Test-JanusAdmin)) {
        Write-Host 'Administrator rights missing for the hosts edit - aborting.' -ForegroundColor Red
        exit 1
    }
    $raw = [IO.File]::ReadAllText($hostsPath)
    $mapped = $false
    foreach ($line in ($raw -split "`r?`n")) {
        $tok = (((($line -split '#')[0]) -replace '\s+', ' ').Trim()) -split ' '
        if ($tok.Count -ge 2 -and $tok[0] -eq '127.0.0.1' -and $tok[1] -ieq $LocalAddress) { $mapped = $true; break }
    }
    if ($mapped) {
        Write-Host "hosts already maps $LocalAddress - left untouched." -ForegroundColor Yellow
    }
    else {
        $nl = if ($raw.Length -eq 0 -or $raw.EndsWith("`n")) { '' } else { "`r`n" }
        [IO.File]::WriteAllText($hostsPath, $raw + $nl + "127.0.0.1 $LocalAddress # janus-local`r`n")
        Write-Host "hosts: added '127.0.0.1 $LocalAddress' (# janus-local)" -ForegroundColor Green
    }
}

# 7. Start on fresh install; after an update restart only if it was running before.
if ($wasRunning -or -not $alreadyInstalled) {
    Write-Host 'Starting Janus service...' -ForegroundColor Yellow
    & $exe service start
    if ($LASTEXITCODE -ne 0) {
        Write-Host "janus service start failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}
else {
    Write-Host 'Update: Janus was stopped before - left stopped (janus service start to run it).' -ForegroundColor Yellow
}

$outcome = if ($wasRunning) { 'updated (service restarted)' } elseif ($alreadyInstalled) { 'updated (service left stopped)' } else { 'installed (service started)' }
Write-JanusLocalLog Info "installer-win-x64: $outcome"
Write-Host "Janus $outcome." -ForegroundColor Green
Write-Host 'Open a NEW terminal, then: janus doctor | janus help | janus run' -ForegroundColor Yellow
exit 0

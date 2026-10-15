#Requires -Version 5.1
<#
.SYNOPSIS
  Remove the local Janus install (Windows x64): stop it, delete %LOCALAPPDATA%\Janus,
  drop the user PATH entry, and clean # janus-local entries from the hosts file.

.DESCRIPTION
  The local part needs no administrator rights. Only the hosts cleanup elevates:
  the script relaunches itself as Administrator (UAC prompt); cancelling leaves the
  hosts entries in place but the rest of the removal still succeeds.

.EXAMPLE
  .\Remove-win-x64.ps1
  .\Remove-win-x64.ps1 --local-address=janus.local
#>
param(
    [string]$LocalAddress,
    [string]$ParentLocalAppData,
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

if ($ParentLocalAppData -and ($ParentLocalAppData -ne $env:LOCALAPPDATA)) {
    Write-Host "Elevation switched user profiles (expected '$ParentLocalAppData', got '$env:LOCALAPPDATA') - nothing was removed." -ForegroundColor Red
    exit 1
}

$root = Get-JanusLocalRoot
$exe = Join-Path $root 'Janus.exe'
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'

# 1. Graceful stop (service stop), then force-kill leftovers.
Write-JanusLocalLog Info 'Remove-win-x64: starting'
if (Test-Path -LiteralPath $exe) {
    $running = @(Get-JanusLocalInstances)
    if ($running.Count -gt 0) {
        Write-Host "Stopping running Janus (PID(s) $(($running | ForEach-Object { $_.ProcessId }) -join ', '))..." -ForegroundColor Yellow
        & $exe service stop
    }
}
Stop-JanusLocalProcesses

# 2. Forcefully delete the base path and all contents.
if (Test-Path -LiteralPath $root) {
    Write-Host "Deleting $root ..." -ForegroundColor Yellow
    Remove-JanusLocalPathWithRetry -Path $root
    Write-Host 'Install directory removed.' -ForegroundColor Green
}
else {
    Write-Host "No install at $root (skipping)." -ForegroundColor Yellow
}

# 3. Drop the base path from the user PATH.
Remove-JanusUserPathEntry -Dir $root
Clear-JanusLocalRoot

# 4. hosts cleanup. All # janus-local entries, plus an exact 127.0.0.1 <name> line
#    when --local-address was given explicitly.
$raw = if (Test-Path -LiteralPath $hostsPath) { [IO.File]::ReadAllText($hostsPath) } else { '' }
$hasMarker = $raw -match '#\s*janus-local'
$hasNamed = $false
if ($LocalAddress) {
    foreach ($line in ($raw -split "`r?`n")) {
        $tok = (((($line -split '#')[0]) -replace '\s+', ' ').Trim()) -split ' '
        if ($tok.Count -ge 2 -and $tok[0] -eq '127.0.0.1' -and $tok[1] -ieq $LocalAddress) { $hasNamed = $true; break }
    }
}

if (-not $hasMarker -and -not $hasNamed) {
    Write-Host 'hosts: no janus-local entries to clean.' -ForegroundColor Green
}
elseif (-not (Test-JanusAdmin)) {
    Write-Host 'hosts cleanup requires Administrator - relaunching elevated (UAC)...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
        '-ParentLocalAppData', ('"{0}"' -f $env:LOCALAPPDATA))
    if ($LocalAddress) { $argList += @('-LocalAddress', $LocalAddress) }
    try {
        $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $p.ExitCode
    }
    catch {
        Write-Host "Elevation declined - hosts entries remain: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
else {
    $eol = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    $lines = @($raw -split "`r?`n")
    $kept = @($lines | Where-Object {
            $line = $_
            if ($line -match '#\s*janus-local\s*$') { return $false }
            if ($LocalAddress) {
                $tok = (((($line -split '#')[0]) -replace '\s+', ' ').Trim()) -split ' '
                if ($tok.Count -ge 2 -and $tok[0] -eq '127.0.0.1' -and $tok[1] -ieq $LocalAddress) { return $false }
            }
            return $true
        })
    if ($kept.Count -lt $lines.Count) {
        [IO.File]::WriteAllText($hostsPath, ($kept -join $eol))
        $n = $lines.Count - $kept.Count
        Write-Host "hosts: removed $n janus-local entr$(if ($n -eq 1) { 'y' } else { 'ies' })." -ForegroundColor Green
    }
    else {
        Write-Host 'hosts: nothing to change.' -ForegroundColor Green
    }
}

# No Write-JanusLocalLog after deletion: it would recreate <root>\logs and
# leave a half-empty install directory behind.
Write-Host 'Janus removed.' -ForegroundColor Green
# Ensure a successful remove does not inherit a native sc.exe miss code (1060).
Clear-JanusNativeExitCode
exit 0

# Shared helpers for Janus install / remove / reinstall scripts.
# Dot-sourced only — do not run directly.

$ErrorActionPreference = 'Stop'

$script:JanusInstallRoot = 'C:\Program Files\Janus'
$script:JanusApiDir = Join-Path $script:JanusInstallRoot 'api'
$script:JanusWebuiDir = Join-Path $script:JanusInstallRoot 'webui'
$script:JanusBinDir = Join-Path $script:JanusInstallRoot 'bin'
$script:JanusConfigPath = Join-Path $script:JanusInstallRoot 'install-config.json'
$script:JanusDataRoot = Join-Path $env:ProgramData 'Janus'
$script:JanusApiService = 'janus'
$script:JanusWebuiService = 'janus-webui'
$script:DefaultApiPort = 7070
$script:DefaultWebuiPort = 7071
$script:JanusWinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$script:JanusWinSwPath = Join-Path $script:JanusBinDir 'WinSW.exe'

function Get-JanusRepoRoot {
    Split-Path -Parent $PSScriptRoot
}

function Write-JanusUtf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Test-JanusAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Parse-JanusInstallArgs {
    param([string[]]$RawArgs)

    # Unbound ValueFromRemainingArguments is $null; @($null) is one empty token — ignore blanks.
    $RawArgs = @(
        if ($null -ne $RawArgs) {
            $RawArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        }
    )

    $result = [ordered]@{
        ApiPort    = $null
        WebuiPort  = $null
        RemoveData = $false
    }

    $i = 0
    while ($i -lt $RawArgs.Count) {
        $tok = $RawArgs[$i].ToLowerInvariant()

        if ($tok -eq 'data' -and ($i + 2) -lt $RawArgs.Count -and $RawArgs[$i + 1].ToLowerInvariant() -eq 'remove') {
            $val = $RawArgs[$i + 2].ToLowerInvariant()
            $result.RemoveData = ($val -in @('yes', 'true', '1', 'y'))
            $i += 3
            continue
        }

        if ($tok -eq 'api' -and ($i + 3) -lt $RawArgs.Count -and
            $RawArgs[$i + 1].ToLowerInvariant() -eq 'port' -and
            $RawArgs[$i + 2].ToLowerInvariant() -eq 'set') {
            $result.ApiPort = [int]$RawArgs[$i + 3]
            $i += 4
            continue
        }

        if ($tok -eq 'webui' -and ($i + 3) -lt $RawArgs.Count -and
            $RawArgs[$i + 1].ToLowerInvariant() -eq 'port' -and
            $RawArgs[$i + 2].ToLowerInvariant() -eq 'set') {
            $result.WebuiPort = [int]$RawArgs[$i + 3]
            $i += 4
            continue
        }

        throw "Unknown argument '$($RawArgs[$i])'. Supported: data remove yes|no, api port set <n>, webui port set <n>"
    }

    return $result
}

function Read-JanusConfig {
    if (-not (Test-Path -LiteralPath $script:JanusConfigPath)) {
        return $null
    }
    return Get-Content -LiteralPath $script:JanusConfigPath -Raw | ConvertFrom-Json
}

function Write-JanusConfig {
    param(
        [int]$ApiPort,
        [int]$WebuiPort,
        [string]$UserHome = $env:USERPROFILE
    )

    $obj = [ordered]@{
        apiPort     = $ApiPort
        webuiPort   = $WebuiPort
        installRoot = $script:JanusInstallRoot
        # Captured at install time so the LocalSystem service can resolve ~/.cursor
        # to the installing user's profile instead of systemprofile.
        userHome    = $UserHome
        updatedAt   = (Get-Date).ToString('o')
    }
    $dir = Split-Path -Parent $script:JanusConfigPath
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Write-JanusUtf8NoBom -Path $script:JanusConfigPath -Content (($obj | ConvertTo-Json) + "`n")
}

function Resolve-JanusPorts {
    param(
        $Parsed,
        $Existing
    )

    $api = $script:DefaultApiPort
    $webui = $script:DefaultWebuiPort

    if ($Existing) {
        if ($Existing.apiPort) { $api = [int]$Existing.apiPort }
        if ($Existing.webuiPort) { $webui = [int]$Existing.webuiPort }
    }

    if ($null -ne $Parsed.ApiPort) { $api = [int]$Parsed.ApiPort }
    if ($null -ne $Parsed.WebuiPort) { $webui = [int]$Parsed.WebuiPort }

    return @{ ApiPort = $api; WebuiPort = $webui }
}

function Test-JanusInstalled {
    return (Test-Path -LiteralPath $script:JanusInstallRoot) -and
        (Test-Path -LiteralPath (Join-Path $script:JanusApiDir 'package.json'))
}

function Get-JanusNodePath {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    throw 'Node.js was not found. Install Node.js 20+ and ensure node is on PATH.'
}

function Invoke-JanusSc {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ScArgs)
    & sc.exe @ScArgs | Out-Null
    return $LASTEXITCODE
}

function Clear-JanusNativeExitCode {
    # sc.exe query/delete of a missing service leaves LASTEXITCODE=1060 and would
    # poison remove-local.ps1 / reinstall.ps1 process exit even when the script succeeded.
    $global:LASTEXITCODE = 0
}

function Get-JanusWinSwExePath {
    param([string]$Name)
    return Join-Path $script:JanusBinDir "$Name.exe"
}

function Get-JanusWinSwXmlPath {
    param([string]$Name)
    return Join-Path $script:JanusBinDir "$Name.xml"
}

function Ensure-JanusWinSw {
    if (-not (Test-Path -LiteralPath $script:JanusBinDir)) {
        New-Item -ItemType Directory -Path $script:JanusBinDir -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $script:JanusWinSwPath)) {
        Write-Host "Downloading WinSW to $script:JanusWinSwPath ..."
        Invoke-WebRequest -Uri $script:JanusWinSwUrl -OutFile $script:JanusWinSwPath -UseBasicParsing
    }
    if (-not (Test-Path -LiteralPath $script:JanusWinSwPath)) {
        throw "WinSW download failed: $script:JanusWinSwPath missing"
    }
    return $script:JanusWinSwPath
}

function Test-JanusServiceExists {
    param([string]$Name)
    $out = & sc.exe query $Name 2>&1 | Out-String
    $exists = ($LASTEXITCODE -eq 0) -and ($out -match 'SERVICE_NAME')
    if (-not $exists) {
        Clear-JanusNativeExitCode
    }
    return $exists
}

function Stop-JanusInstallProcesses {
    # WinSW stop can leave node/tsx grandchildren (or WinSW itself) holding C:\Program Files\Janus.
    $root = $script:JanusInstallRoot
    $escaped = [regex]::Escape($root)
    $wrapperNames = @("$($script:JanusApiService).exe", "$($script:JanusWebuiService).exe", 'WinSW.exe')
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $cmd = $_.CommandLine
            $exe = $_.ExecutablePath
            ($cmd -and ($cmd -match $escaped)) -or
            ($exe -and ($exe -match $escaped)) -or
            ($wrapperNames -contains $_.Name)
        })
    foreach ($p in $procs) {
        Write-Host "Stopping leftover process $($p.ProcessId) ($($p.Name)) still using install root..."
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Could not stop PID $($p.ProcessId): $($_.Exception.Message)"
        }
    }
    if ($procs.Count -gt 0) {
        Start-Sleep -Seconds 2
    }
}

function Copy-JanusFileWithRetry {
    param(
        [string]$Source,
        [string]$Destination,
        [int]$Attempts = 8,
        [int]$DelaySeconds = 2
    )

    for ($i = 1; $i -le $Attempts; $i++) {
        Stop-JanusInstallProcesses
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        }
        catch {
            if ($i -eq $Attempts) { throw }
            Write-Warning "Copy '$Destination' attempt $i/$Attempts failed: $($_.Exception.Message)"
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Stop-JanusServiceSafe {
    param([string]$Name)
    $winsw = Get-JanusWinSwExePath -Name $Name
    if (Test-Path -LiteralPath $winsw) {
        Write-Host "Stopping service '$Name' (WinSW)..."
        & $winsw stop 2>&1 | Out-Null
        Clear-JanusNativeExitCode
        Start-Sleep -Seconds 2
        Stop-JanusInstallProcesses
        return
    }
    if (-not (Test-JanusServiceExists -Name $Name)) { return }
    Write-Host "Stopping service '$Name'..."
    & sc.exe stop $Name | Out-Null
    Clear-JanusNativeExitCode
    Start-Sleep -Seconds 2
    Stop-JanusInstallProcesses
}

function Remove-JanusServiceSafe {
    param([string]$Name)
    $winsw = Get-JanusWinSwExePath -Name $Name
    if (Test-Path -LiteralPath $winsw) {
        Write-Host "Removing service '$Name' (WinSW)..."
        & $winsw stop 2>&1 | Out-Null
        & $winsw uninstall 2>&1 | Out-Null
        Clear-JanusNativeExitCode
        Start-Sleep -Seconds 2
        Stop-JanusInstallProcesses
    }
    elseif (Test-JanusServiceExists -Name $Name) {
        Stop-JanusServiceSafe -Name $Name
        Write-Host "Removing service '$Name'..."
        & sc.exe delete $Name | Out-Null
        Clear-JanusNativeExitCode
        Start-Sleep -Seconds 1
    }

    foreach ($path in @(
            (Get-JanusWinSwExePath -Name $Name),
            (Get-JanusWinSwXmlPath -Name $Name)
        )) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-JanusServiceSafe {
    param([string]$Name)
    Write-Host "Starting service '$Name'..."
    $winsw = Get-JanusWinSwExePath -Name $Name
    if (Test-Path -LiteralPath $winsw) {
        $out = & $winsw start 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "WinSW start '$Name' failed (exit $LASTEXITCODE):`n$out"
        }
        return
    }
    $code = Invoke-JanusSc start $Name
    if ($code -ne 0) {
        throw "Failed to start service '$Name' (sc exit $code). Run elevated and check Event Viewer."
    }
}

function Register-JanusService {
    param(
        [string]$Name,
        [string]$DisplayName,
        [string]$Executable,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$Description
    )

    # Plain node.exe is not SCM-aware (error 1053). WinSW wraps it as a real service.
    $template = Ensure-JanusWinSw
    $winswExe = Get-JanusWinSwExePath -Name $Name
    $winswXml = Get-JanusWinSwXmlPath -Name $Name

    # Must stop/uninstall before overwriting the WinSW wrapper — a running janus.exe locks the file.
    if (Test-JanusServiceExists -Name $Name) {
        Stop-JanusServiceSafe -Name $Name
        if (Test-Path -LiteralPath $winswExe) {
            $out = & $winswExe uninstall 2>&1 | Out-String
            Clear-JanusNativeExitCode
            Start-Sleep -Seconds 1
        }
        else {
            & sc.exe delete $Name | Out-Null
            Clear-JanusNativeExitCode
            Start-Sleep -Seconds 1
        }
        Stop-JanusInstallProcesses
    }

    Copy-JanusFileWithRetry -Source $template -Destination $winswExe

    $xml = @"
<service>
  <id>$Name</id>
  <name>$DisplayName</name>
  <description>$Description</description>
  <executable>$Executable</executable>
  <arguments>$Arguments</arguments>
  <workingdirectory>$WorkingDirectory</workingdirectory>
  <logmode>rotate</logmode>
  <logpath>$($script:JanusBinDir)</logpath>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
</service>
"@
    Write-JanusUtf8NoBom -Path $winswXml -Content $xml

    $installOut = & $winswExe install 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "WinSW install '$Name' failed (exit $LASTEXITCODE):`n$installOut"
    }
    Clear-JanusNativeExitCode
}

function Backup-JanusUserFiles {
    param([string]$ApiDir)

    $backup = Join-Path $env:TEMP ("janus-preserve-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null

    $names = @('settings.json', 'imported-projects.json', '.trash')
    foreach ($name in $names) {
        $src = Join-Path $ApiDir $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $backup $name) -Recurse -Force
        }
    }
    return $backup
}

function Restore-JanusUserFiles {
    param(
        [string]$ApiDir,
        [string]$BackupDir
    )

    if (-not $BackupDir -or -not (Test-Path -LiteralPath $BackupDir)) { return }

    foreach ($item in Get-ChildItem -LiteralPath $BackupDir -Force) {
        $dest = Join-Path $ApiDir $item.Name
        if (Test-Path -LiteralPath $dest) {
            Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
        }
        Copy-Item -LiteralPath $item.FullName -Destination $dest -Recurse -Force
    }
    Remove-Item -LiteralPath $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Copy-JanusTree {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Source not found: $Source"
    }
    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    # /E copy subdirs; no /MIR so existing user files not in source are kept until we restore explicitly.
    # Exclude node_modules / .git / dist — reinstall deps and rebuild at destination.
    & robocopy.exe $Source $Destination /E /NFL /NDL /NJH /NJS /nc /ns /np `
        /XD node_modules .git dist .armin .cursor `
        /XF settings.json imported-projects.json | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "robocopy failed from '$Source' to '$Destination' (exit $code)"
    }
}

function Set-JanusCorsOrigins {
    param(
        [string]$ServerTsPath,
        [int]$WebuiPort
    )

    if (-not (Test-Path -LiteralPath $ServerTsPath)) {
        throw "server.ts not found at $ServerTsPath"
    }

    $content = Get-Content -LiteralPath $ServerTsPath -Raw
    if ($content -match 'janus\.local') {
        return
    }
    $replacement = "origin: ['http://janus.local', 'http://janus.local:$WebuiPort', 'http://janus-api.local', 'http://127.0.0.1:$WebuiPort', 'http://localhost:$WebuiPort', 'http://127.0.0.1:8006', 'http://localhost:8006']"
    $updated = [regex]::Replace($content, 'origin:\s*\[[^\]]*\]', $replacement)
    if ($updated -eq $content) {
        Write-Warning 'CORS origin block was not patched (pattern not found). WebUI may be blocked by CORS.'
    }
    Set-Content -LiteralPath $ServerTsPath -Value $updated -Encoding UTF8
}

function Write-JanusLaunchers {
    param(
        [string]$NodePath
    )

    if (-not (Test-Path -LiteralPath $script:JanusBinDir)) {
        New-Item -ItemType Directory -Path $script:JanusBinDir -Force | Out-Null
    }

    $startApi = @'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(root, 'install-config.json'), 'utf8').replace(/^\uFEFF/, ''))
const apiRoot = join(root, 'api')
process.env.JANUS_APP_ROOT = apiRoot
process.env.JANUS_API_BIND = `127.0.0.1:${cfg.apiPort}`
if (cfg.userHome) process.env.JANUS_USER_HOME = String(cfg.userHome)
const tsxCli = join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const cliTs = join(apiRoot, 'src', 'cli.ts')
const child = spawn(process.execPath, [tsxCli, cliTs, 'run'], {
  stdio: 'inherit',
  windowsHide: true,
  cwd: apiRoot,
  env: process.env
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
'@

    $startWebui = @'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(root, 'install-config.json'), 'utf8').replace(/^\uFEFF/, ''))
const webuiRoot = join(root, 'webui')
const viteBin = join(webuiRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const child = spawn(
  process.execPath,
  [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(cfg.webuiPort)],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd: webuiRoot,
    env: process.env
  }
)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
'@

    Write-JanusUtf8NoBom -Path (Join-Path $script:JanusBinDir 'start-api.mjs') -Content $startApi
    Write-JanusUtf8NoBom -Path (Join-Path $script:JanusBinDir 'start-webui.mjs') -Content $startWebui
}

function Invoke-JanusNpm {
    param(
        [string]$WorkingDirectory,
        [string[]]$NpmArgs
    )

    Push-Location $WorkingDirectory
    try {
        & npm.cmd @NpmArgs
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($NpmArgs -join ' ') failed in $WorkingDirectory (exit $LASTEXITCODE)"
        }
    }
    finally {
        Pop-Location
    }
}

function Remove-JanusPathWithRetry {
    param(
        [string]$Path,
        [int]$Attempts = 8,
        [int]$DelaySeconds = 2
    )

    if (-not (Test-Path -LiteralPath $Path)) { return }

    for ($i = 1; $i -le $Attempts; $i++) {
        Stop-JanusInstallProcesses
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $Path)) { return }
        }
        catch {
            if ($i -eq $Attempts) { throw }
            Write-Warning "Remove '$Path' attempt $i/$Attempts failed: $($_.Exception.Message)"
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    if (Test-Path -LiteralPath $Path) {
        throw "Failed to remove '$Path' after $Attempts attempts (path still locked)."
    }
}

function Remove-JanusAppCompletely {
    Write-Host 'Removing Janus services...'
    Remove-JanusServiceSafe -Name $script:JanusWebuiService
    Remove-JanusServiceSafe -Name $script:JanusApiService

    # Also clear the in-repo janus service if it points at a non-Program-Files path.
    if (Test-JanusServiceExists -Name $script:JanusApiService) {
        Remove-JanusServiceSafe -Name $script:JanusApiService
    }

    Stop-JanusInstallProcesses

    if (Test-Path -LiteralPath $script:JanusInstallRoot) {
        Write-Host "Removing install directory: $script:JanusInstallRoot"
        Remove-JanusPathWithRetry -Path $script:JanusInstallRoot
    }

    if (Test-Path -LiteralPath $script:JanusDataRoot) {
        Write-Host "Removing data directory: $script:JanusDataRoot"
        Remove-JanusPathWithRetry -Path $script:JanusDataRoot
    }

    Clear-JanusNativeExitCode
    Write-Host 'Janus removed completely (app + data).'
}

function Start-JanusApp {
    param(
        [int]$ApiPort,
        [int]$WebuiPort
    )

    Start-JanusServiceSafe -Name $script:JanusApiService
    Start-Sleep -Seconds 2
    Start-JanusServiceSafe -Name $script:JanusWebuiService
    Start-Sleep -Seconds 1

    $url = "http://127.0.0.1:$WebuiPort"
    Write-Host "Janus API:   http://127.0.0.1:$ApiPort"
    Write-Host "Janus WebUI: $url"
    try {
        Start-Process $url | Out-Null
    }
    catch {
        Write-Warning "Could not open browser: $($_.Exception.Message)"
    }
}

# -----------------------------------------------------------------------------
# Local single-exe install helpers (build-janus-exe / install-local / remove-local)
# -----------------------------------------------------------------------------

$script:JanusLocationRegKey = 'HKCU:\Software\Janus'

function Get-JanusDefaultLocalRoot {
    return (Join-Path $env:LOCALAPPDATA 'Janus')
}

function Get-JanusSavedLocalRoot {
    # Install dir chosen at install time (HKCU), or $null when Janus was never installed locally.
    $item = Get-ItemProperty -LiteralPath $script:JanusLocationRegKey -Name InstallDir -ErrorAction SilentlyContinue
    if ($item) { return [string]$item.InstallDir }
    return $null
}

function Get-JanusLocalRoot {
    $saved = Get-JanusSavedLocalRoot
    if ($saved) { return $saved }
    return (Get-JanusDefaultLocalRoot)
}

function Set-JanusLocalRoot {
    param([string]$Dir)
    New-Item -Path $script:JanusLocationRegKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $script:JanusLocationRegKey -Name InstallDir -Value $Dir
}

function Clear-JanusLocalRoot {
    Remove-Item -LiteralPath $script:JanusLocationRegKey -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-JanusUnderProgramFiles {
    param([string]$Dir)
    return $Dir.StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-JanusInstallRoot {
    # Install dir for install/update. Order: -Requested, saved location, existing default install,
    # then an interactive choice (skipped when stdin is redirected, e.g. `janus rebuild`).
    param([string]$Requested)

    if ($Requested) {
        $dir = $Requested.Trim().TrimEnd('\')
        if ($dir -notmatch '^[A-Za-z]:\\.+') { throw "Install folder must be an absolute path with a drive letter: '$Requested'" }
        return $dir
    }
    $saved = Get-JanusSavedLocalRoot
    if ($saved) { return $saved }
    $default = Get-JanusDefaultLocalRoot
    if (Test-Path -LiteralPath (Join-Path $default 'Janus.exe')) { return $default }
    if ([Console]::IsInputRedirected) { return $default }

    $options = @{
        '1' = Join-Path $env:LOCALAPPDATA 'Janus'
        '2' = Join-Path $env:APPDATA 'Janus'
        '3' = Join-Path $env:ProgramFiles 'Janus'
    }
    Write-Host 'Where should Janus be installed?'
    Write-Host "  1) $($options['1'])  (default, no admin)"
    Write-Host "  2) $($options['2'])"
    Write-Host "  3) $($options['3'])  (needs admin)"
    Write-Host '  4) Custom path'
    $choice = (Read-Host 'Enter 1-4 [1]').Trim()
    if ($choice -eq '') { $choice = '1' }
    if ($choice -eq '4') {
        $custom = (Read-Host 'Full path of the install folder (e.g. D:\Apps\Janus)').Trim().TrimEnd('\')
        if ($custom -notmatch '^[A-Za-z]:\\.+') { throw "Custom path must be an absolute folder path, e.g. D:\Apps\Janus (got '$custom')." }
        return $custom
    }
    if (-not $options.ContainsKey($choice)) { throw "Invalid choice '$choice' (use 1-4)." }
    return $options[$choice]
}

function Get-JanusStagedExePath {
    # Where build-janus-exe.ps1 emits the freshly built Janus.exe before install copies it in.
    return (Join-Path $env:TEMP 'janus-build\Janus.exe')
}

function Write-JanusLocalLog {
    param(
        [ValidateSet('Info', 'Warning', 'Error')]
        [string]$Level = 'Info',
        [Parameter(Mandatory = $true)]
        [string]$Message
    )
    $bucket = switch ($Level) { 'Info' { 'infos' } 'Warning' { 'warnings' } 'Error' { 'errors' } }
    $dir = Join-Path (Join-Path (Get-JanusLocalRoot) 'logs') $bucket
    try {
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        $day = (Get-Date).ToString('yyyy-MM-dd')
        $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
        Add-Content -LiteralPath (Join-Path $dir "$day.txt") -Value $line -Encoding UTF8
    }
    catch {
        Write-Warning "Could not write local log ($Level): $($_.Exception.Message)"
    }
}

function Ensure-JanusLocalLayout {
    # Creates <root>\logs\{infos,warnings,errors} and seeds settings.json from the template
    # when missing (an existing settings.json is never overwritten).
    $root = Get-JanusLocalRoot
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    if (Test-JanusUnderProgramFiles -Dir $root) {
        # Program Files is admin-only for writes; the app runs as the user and must write settings/logs/data.
        & icacls.exe $root /grant '*S-1-5-32-545:(OI)(CI)M' /T /C | Out-Null
    }
    foreach ($bucket in @('infos', 'warnings', 'errors')) {
        New-Item -ItemType Directory -Path (Join-Path (Join-Path $root 'logs') $bucket) -Force | Out-Null
    }
    # Touch today's file in every bucket so each active day has its full log set
    # (infos\2026-09-07.txt style), matching the CLI's ensureDailyLogs().
    $today = (Get-Date).ToString('yyyy-MM-dd')
    foreach ($bucket in @('infos', 'warnings', 'errors')) {
        $todayFile = Join-Path (Join-Path (Join-Path $root 'logs') $bucket) "$today.txt"
        if (-not (Test-Path -LiteralPath $todayFile)) { New-Item -ItemType File -Path $todayFile -Force | Out-Null }
    }
    $settings = Join-Path $root 'settings.json'
    if (-not (Test-Path -LiteralPath $settings)) {
        $template = Join-Path (Join-Path (Get-JanusRepoRoot) 'janus-api') 'resources\settings.template.json'
        if (Test-Path -LiteralPath $template) {
            Copy-Item -LiteralPath $template -Destination $settings -Force
            Write-Host 'Seeded settings.json from template'
        }
        else {
            Write-Warning "settings template not found ($template) - settings.json will be created on first server start"
        }
    }
}

function Get-JanusLocalInstances {
    # Every running Janus.exe (service, run, stray, legacy). Matched by image name only:
    # ExecutablePath is blank for elevated processes, so a path match would miss them.
    return @(Get-CimInstance Win32_Process -Filter "Name='Janus.exe'" -ErrorAction SilentlyContinue)
}

function Stop-JanusLocalProcesses {
    $procs = @(Get-JanusLocalInstances)
    if ($procs.Count -eq 0) { return }
    Write-Host "Closing running Janus (PID(s): $(($procs | ForEach-Object { $_.ProcessId }) -join ', '))..."
    $refused = @()
    foreach ($p in $procs) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }
        catch { $refused += $p.ProcessId }
    }
    if ($refused.Count -gt 0) {
        # Elevated instances refuse a normal kill: close them in one elevated taskkill (one UAC prompt).
        Write-Host "Elevation needed to close PID(s): $($refused -join ', ') (approve the UAC prompt)..."
        $killArgs = @($refused | ForEach-Object { '/PID', $_ }) + @('/T', '/F')
        try { Start-Process taskkill.exe -ArgumentList $killArgs -Verb RunAs -WindowStyle Hidden -Wait | Out-Null }
        catch { Write-Warning "Elevated close was not completed: $($_.Exception.Message)" }
    }
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if (@(Get-JanusLocalInstances).Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    }
    if (@(Get-JanusLocalInstances).Count -gt 0) {
        throw 'Could not stop the running Janus process (still alive after 8s).'
    }
}

function Remove-JanusLocalPathWithRetry {
    param(
        [string]$Path,
        [int]$Attempts = 6,
        [int]$DelaySeconds = 2
    )
    if (-not (Test-Path -LiteralPath $Path)) { return }
    for ($i = 1; $i -le $Attempts; $i++) {
        Stop-JanusLocalProcesses
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $Path)) { return }
        }
        catch {
            if ($i -eq $Attempts) { throw }
            Write-Warning "Remove '$Path' attempt $i/$Attempts failed: $($_.Exception.Message)"
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Copy-JanusLocalFileWithRetry {
    # Requirement: close app -> remove old .exe -> replace with the new .exe (lock-tolerant).
    param(
        [string]$Source,
        [string]$Destination,
        [int]$Attempts = 6,
        [int]$DelaySeconds = 2
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        Stop-JanusLocalProcesses
        try {
            if (Test-Path -LiteralPath $Destination) {
                Remove-Item -LiteralPath $Destination -Force -ErrorAction Stop
            }
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        }
        catch {
            if ($i -eq $Attempts) { throw }
            Write-Warning "Replace '$Destination' attempt $i/$Attempts failed: $($_.Exception.Message)"
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Invoke-JanusBroadcastEnvChange {
    # Without WM_SETTINGCHANGE, newly opened terminals keep the old user PATH until next sign-in.
    try {
        if (-not ('JanusEnv.Native' -as [type])) {
            Add-Type -Namespace JanusEnv -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
        }
        [UIntPtr]$result = [UIntPtr]::Zero
        [void][JanusEnv.Native]::SendMessageTimeout([IntPtr]0xffff, [uint32]0x1A, [UIntPtr]::Zero, 'Environment', [uint32]0x2, [uint32]5000, [ref]$result)
    }
    catch {
        Write-Warning "Could not broadcast environment change: $($_.Exception.Message)"
    }
}

function Add-JanusUserPathEntry {
    param([string]$Dir)
    $norm = $Dir.TrimEnd('\')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) { $entries = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() }) }
    $present = $false
    foreach ($e in $entries) { if ($e.Trim().TrimEnd('\') -ieq $norm) { $present = $true; break } }
    if (-not $present) {
        $entries += $norm
        [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
        Invoke-JanusBroadcastEnvChange
        Write-Host "Added $norm to your user PATH (new terminals pick it up; this session updated too)."
    }
    else {
        Write-Host "User PATH already contains $norm."
    }
    $curPresent = $false
    foreach ($e in @($env:Path -split ';')) { if ($e -and $e.Trim().TrimEnd('\') -ieq $norm) { $curPresent = $true; break } }
    if (-not $curPresent) { $env:Path = $env:Path.TrimEnd(';') + ';' + $norm }
}

function Remove-JanusUserPathEntry {
    param([string]$Dir)
    $norm = $Dir.TrimEnd('\')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
        $kept = @($userPath -split ';' | Where-Object { $_ -and $_.Trim().TrimEnd('\') -ine $norm })
        if ($kept.Count -eq 0) {
            [Environment]::SetEnvironmentVariable('Path', $null, 'User')
            Invoke-JanusBroadcastEnvChange
            Write-Host "Removed $norm from your user PATH."
        }
        else {
            $newPath = $kept -join ';'
            if ($newPath -ne $userPath) {
                [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
                Invoke-JanusBroadcastEnvChange
                Write-Host "Removed $norm from your user PATH."
            }
        }
    }
    $keptCur = @($env:Path -split ';' | Where-Object { $_ -and $_.Trim().TrimEnd('\') -ine $norm })
    if ($keptCur.Count -ne @($env:Path -split ';').Count) { $env:Path = $keptCur -join ';' }
}

// Janus.exe CLI entry (bundled into a Node SEA by build-janus-exe.ps1).
//
// Implements the local-install command surface:
//   janus doctor | status | version | help
//   janus service start|stop|status|restart [--port=N]
//   janus run [--port=N] [--no-open]
//   janus port [--port=N]           (show or set the default port)
//   janus skills list
//   janus skills delete --skill=<name>
//   janus skills rename --skill=<name> --new-name=<name>
//   janus ide status
//   janus ide list
//   janus ide enable --ide=<id>
//   janus ide disable --ide=<id>
//   janus stop                      (stop every Janus process and verify the port is free)
//   janus remove | uninstall        (completely remove the local install incl. app data)
//   janus update                    (placeholder — no implementation yet)
//   janus rebuild [--remove-data=no|yes] [-y]   (rebuild Janus.exe from the repo, replace the install, restart; yes wipes settings, configs, logs and database)
//   janus __serve --port=N          (internal: background server process)
//
// The server is composed here from janus-api's exported pieces (registerRoutes,
// addSseClient, ensurePortableLayout, startFileWatcher) so that the WebUI can be
// served from the SAME Fastify instance (same-origin, required because the port
// is random per start). janus-api sources are not modified.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync, unlinkSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { format } from 'node:util'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline/promises'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from '../janus-api/src/routes/index'
import { addSseClient, onScanChanged } from '../janus-api/src/events'
import { ensurePortableLayout } from '../janus-api/src/app-paths'
import { startFileWatcher } from '../janus-api/src/services/watcher.service'
import { settingsStore } from '../janus-api/src/services/settings-store'
import { scannerService } from '../janus-api/src/services/scanner.service'
import { resourceService } from '../janus-api/src/services/resource.service'
import {
  applyMcpEnableCascade,
  removeUnselectedPlatformFolders,
  syncEnabledPlatformsToProjects
} from '../janus-api/src/services/platform-sync.service'
import { PLATFORM_IDS, PLATFORM_LABELS, type PlatformId } from '../janus-api/src/shared/types'

// Build stamp injected by scripts/build-janus-exe.ps1 via esbuild --define.
declare const __JANUS_VERSION__: string | undefined
const JANUS_VERSION: string =
  typeof __JANUS_VERSION__ === 'undefined' ? 'dev' : __JANUS_VERSION__

// ---------------------------------------------------------------------------
// Paths & environment
// ---------------------------------------------------------------------------

// SEA production: the install dir is where Janus.exe lives. Dev runs (node bundle.cjs)
// can override via JANUS_INSTALL_DIR; otherwise fall back to dirname(process.execPath).
const installDir = process.env.JANUS_INSTALL_DIR?.trim() || dirname(process.execPath)
const logsRoot = join(installDir, 'logs')
const settingsPath = join(installDir, 'settings.json')
// App data (database, repo-bank, ...) lives here, outside the install dir.
const appDataRoot = join(process.env.ProgramData || 'C:\\ProgramData', 'Janus')

// Everything under janus-api resolves settings/data from the install dir.
process.env.JANUS_APP_ROOT = process.env.JANUS_APP_ROOT || installDir

// Default port used by every command unless the user changes it (janus port --port=N,
// persisted top-level in settings.json) or overrides it per invocation (--port=N).
const DEFAULT_PORT = 47911

const SERVER_FLAG = '__serve'
const SERVER_ARG = `--port=`

// ---------------------------------------------------------------------------
// Logging -> logs/{infos,warnings,errors}/YYYY-MM-DD.txt (daily files)
// ---------------------------------------------------------------------------

type LogBucket = 'infos' | 'warnings' | 'errors'

function writeLog(bucket: LogBucket, message: string): void {
  try {
    const dir = join(logsRoot, bucket)
    mkdirSync(dir, { recursive: true })
    const day = todayLocal()
    appendFileSync(join(dir, `${day}.txt`), `${new Date().toISOString()} ${message}\n`, 'utf-8')
  } catch {
    // Logging must never take the process down.
  }
}

// Local calendar day — matches install-local.ps1's Get-Date naming and the spec's
// per-day examples (infos/2026-09-07.txt), not the UTC day (differs before +03:30 midnight).
function todayLocal(): string {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// Touch today's file in every bucket so each active day has its full log set
// (infos/…, warnings/…, errors/…), even before the first warning or error occurs.
function ensureDailyLogs(): void {
  const day = todayLocal()
  for (const bucket of ['infos', 'warnings', 'errors'] as LogBucket[]) {
    try {
      const dir = join(logsRoot, bucket)
      mkdirSync(dir, { recursive: true })
      closeSync(openSync(join(dir, `${day}.txt`), 'a'))
    } catch {
      // Logging must never take the process down.
    }
  }
}

let consoleInstalled = false
function installConsoleHooks(echo: boolean): void {
  if (consoleInstalled) return
  consoleInstalled = true
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }
  console.log = (...args: unknown[]): void => {
    writeLog('infos', format(...args))
    if (echo) orig.log(...args)
  }
  console.info = (...args: unknown[]): void => {
    writeLog('infos', format(...args))
    if (echo) orig.info(...args)
  }
  console.warn = (...args: unknown[]): void => {
    writeLog('warnings', format(...args))
    if (echo) orig.warn(...args)
  }
  console.error = (...args: unknown[]): void => {
    writeLog('errors', format(...args))
    if (echo) orig.error(...args)
  }
  process.on('uncaughtException', (err) => {
    writeLog('errors', `uncaughtException: ${err && err.stack ? err.stack : err}`)
    if (echo) orig.error(err)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    writeLog('errors', `unhandledRejection: ${format(reason)}`)
  })
}

// ---------------------------------------------------------------------------
// WebUI assets: embedded SEA assets in production, dist/ on disk in dev.
// ---------------------------------------------------------------------------

interface SeaModule {
  isSea(): boolean
  getAsset(key: string): unknown
}

let seaMod: SeaModule | null = null
try {
  const m = require('node:sea') as SeaModule
  if (m && typeof m.isSea === 'function' && m.isSea()) seaMod = m
} catch {
  seaMod = null
}

function devDistDir(): string | null {
  const candidates = [
    process.env.JANUS_WEBUI_DIST,
    join(process.cwd(), 'janus-webui', 'dist'),
    join(process.cwd(), 'dist')
  ].filter((c): c is string => Boolean(c))
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c
  }
  return null
}

function getWebuiAsset(relPosix: string): Buffer | null {
  if (seaMod) {
    try {
      const a = seaMod.getAsset(`webui/${relPosix}`) as ArrayBuffer | string | undefined
      if (a === undefined || a === null) return null
      if (typeof a === 'string') return Buffer.from(a, 'utf-8')
      return Buffer.from(a as ArrayBuffer)
    } catch {
      return null
    }
  }
  const dist = devDistDir()
  if (!dist) return null
  // Normalize and refuse traversal.
  const rel = normalize(relPosix).replace(/^([/\\])+/, '')
  if (rel.includes('..')) return null
  const full = join(dist, rel)
  if (!full.startsWith(dist + sep) && full !== dist) return null
  try {
    return readFileSync(full)
  } catch {
    return null
  }
}

function contentTypeFor(p: string): string {
  switch (extname(p).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.webmanifest': return 'application/manifest+json; charset=utf-8'
    case '.map': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.ico': return 'image/x-icon'
    case '.gif': return 'image/gif'
    case '.woff2': return 'font/woff2'
    case '.woff': return 'font/woff'
    case '.ttf': return 'font/ttf'
    case '.txt': return 'text/plain; charset=utf-8'
    case '.wasm': return 'application/wasm'
    default: return 'application/octet-stream'
  }
}

function cacheControlFor(p: string): string {
  if (p.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'no-cache'
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

function bindTest(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.listen(port, '127.0.0.1')
  })
}

function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

// The default port lives top-level in settings.json ("port": N) so it survives
// janus-api's settings rewrites (migrateSettings spreads unknown top-level keys).
function readConfiguredPort(): number {
  try {
    if (existsSync(settingsPath)) {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { port?: unknown }
      if (parsed && typeof parsed === 'object' && isValidPort(parsed.port)) return parsed.port
    }
  } catch {
    // Unreadable/corrupt settings fall back to the default port.
  }
  return DEFAULT_PORT
}

function writeConfiguredPort(port: number): void {
  let settings: Record<string, unknown> = {}
  try {
    if (existsSync(settingsPath)) {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>
      }
    }
  } catch {
    // Corrupt settings.json is replaced rather than merged — JSON.parse already failed.
  }
  settings.port = port
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

function portInUseHint(explicit: boolean): string {
  return explicit ? '' : ' (change the default with: janus port --port=<N>)'
}

// ---------------------------------------------------------------------------
// Background process discovery (the "service" is a detached Janus.exe process)
// ---------------------------------------------------------------------------

interface Instance {
  pid: number
  commandLine: string
  port: number | null
  mode: 'serve' | 'webui' | 'unknown'
}

const PS_JSON_FLAGS = ['-NoProfile', '-NonInteractive', '-Command']

function findJanusInstances(match?: 'serve' | 'any', excludePid?: number): Instance[] {
  const exePath = process.execPath.replace(/'/g, "''")
  // Only ever target THIS install's exe (there may be stray Janus.exe copies elsewhere).
  const script =
    `$p = Get-CimInstance Win32_Process -Filter "Name='Janus.exe'" -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq '${exePath}' }; ` +
    `if ($p) { $p | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress }`
  const res = spawnSync('powershell.exe', [...PS_JSON_FLAGS, script], {
    encoding: 'utf-8',
    windowsHide: true
  })
  if (res.status !== 0 || !res.stdout || !res.stdout.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(res.stdout.trim())
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const out: Instance[] = []
  for (const item of list) {
    const rec = item as { ProcessId?: number; CommandLine?: string }
    if (typeof rec.ProcessId !== 'number') continue
    if (excludePid !== undefined && rec.ProcessId === excludePid) continue
    const commandLine = rec.CommandLine || ''
    const mode: Instance['mode'] = commandLine.includes(SERVER_FLAG)
      ? 'serve'
      : commandLine.includes('local-webui') || /\srun(\s|$)/.test(commandLine)
        ? 'webui'
        : 'unknown'
    const pm = /--port=(\d+)/.exec(commandLine)
    out.push({ pid: rec.ProcessId, commandLine, port: pm ? parseInt(pm[1], 10) : null, mode })
  }
  if (match === 'serve') return out.filter((i) => i.mode === 'serve')
  return out
}

function killInstance(pid: number): void {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}

function stopAllInstances(match?: 'serve' | 'any', excludePid?: number): number {
  const found = findJanusInstances(match, excludePid)
  for (const i of found) killInstance(i.pid)
  if (found.length > 0) {
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      if (findJanusInstances(match, excludePid).length === 0) break
      spawnSync('ping', ['-n', '2', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' })
    }
  }
  return found.length
}

// ---------------------------------------------------------------------------
// Health probe
// ---------------------------------------------------------------------------

async function probeHealth(port: number, timeoutMs = 1200): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body && body.ok === true
  } catch {
    return false
  }
}

async function waitUntilHealthy(port: number, totalMs: number): Promise<boolean> {
  const deadline = performance.now() + totalMs
  while (performance.now() < deadline) {
    if (await probeHealth(port)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function tailErrors(n = 8): string {
  try {
    const day = new Date().toISOString().slice(0, 10)
    const p = join(logsRoot, 'errors', `${day}.txt`)
    const lines = readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean)
    return lines.slice(-n).join('\n')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Server: API + WebUI on ONE port (same origin)
// ---------------------------------------------------------------------------

async function serve(port: number): Promise<void> {
  installConsoleHooks(true)
  process.env.JANUS_API_BIND = `127.0.0.1:${port}`

  ensurePortableLayout()
  startFileWatcher()
  // Keep the scan cache warm: refresh on watcher events (in-process) and on a
  // fixed interval, so page reads serve the latest background update instantly.
  onScanChanged(() => scannerService.scheduleBackgroundRefresh(settingsStore.get()))
  scannerService.startBackgroundUpdates(() => settingsStore.get())

  const app = Fastify({ logger: false })

  // Same effective behavior as janus-api's server.ts CORS config (allow all).
  await app.register(cors, { origin: true, credentials: true })

  await registerRoutes(app)

  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/events', async (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    reply.raw.write(': connected\n\n')
    const client = { write: (chunk: string): void => { reply.raw.write(chunk) }, close: (): void => { reply.raw.end() } }
    const remove = addSseClient(client)
    request.raw.on('close', () => { remove() })
  })

  // Static WebUI + SPA fallback.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      void reply.code(404).send({ error: 'Not found' })
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      void reply.code(404).send({ error: 'Not found' })
      return
    }
    let rel = request.url.split('?')[0]
    try {
      rel = decodeURIComponent(rel)
    } catch {
      /* keep raw */
    }
    if (rel.includes('..')) {
      void reply.code(400).send({ error: 'Bad path' })
      return
    }
    if (rel === '/' || rel === '') rel = '/index.html'

    let body = rel.endsWith('/') ? null : getWebuiAsset(rel.replace(/^\/+/, ''))
    let served = rel
    if (!body && !extname(rel)) {
      // SPA fallback for extension-less routes.
      body = getWebuiAsset('index.html')
      served = '/index.html'
    }
    if (!body) {
      void reply.code(404).send({ error: 'Not found' })
      return
    }
    void reply
      .code(200)
      .header('Content-Type', contentTypeFor(served))
      .header('Cache-Control', cacheControlFor(served))
      .send(body)
  })

  try {
    await app.listen({ host: '127.0.0.1', port })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e && e.code === 'EADDRINUSE') {
      // Logged via console hook (-> logs/errors) and rethrown so callers decide:
      // foreground retry loop picks a new port; the detached child exits(1).
      console.error(`Port ${port} is already in use.`)
    }
    throw err
  }

  const url = `http://127.0.0.1:${port}/`
  console.log(`Janus running at ${url} (pid ${process.pid})`)

  const shutdown = (): void => {
    console.log('Server stopping (signal)')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

const USAGE = `Janus local CLI

Usage:
  janus doctor                          Check installation health
  janus status                          Show install and service status
  janus version                         Show the Janus version
  janus help                            Show this help
  janus run [--port=N] [--no-open]
                                        Start API + WebUI in the background, open
                                        the browser, and release the terminal
                                        (if already running, opens its URL instead)
  janus port [--port=N]                 Show the default port, or set it
                                        (default: ${DEFAULT_PORT}; persisted in settings.json)
  janus service start [--port=N]        Start the background service
                                        (default: the configured port)
  janus service stop                    Stop the background service
  janus service status                  Show background service status
  janus service restart [--port=N]      Restart the background service
                                        (default: the configured port)
  janus skills list                     List all skills across projects and globals
  janus skills delete --skill=<name>    Delete a skill (moved to the Janus trash)
  janus skills rename --skill=<name> --new-name=<name>
                                        Rename a skill everywhere it is installed
  janus ide status                      Summarize enabled/disabled IDEs/CLIs
  janus ide list                        List every IDE/CLI with its state and paths
  janus ide enable --ide=<id>           Enable an IDE/CLI and sync it into projects
  janus ide disable --ide=<id>          Disable an IDE/CLI and purge its project folders
  janus stop                            Stop Janus completely (service and foreground runs)
  janus rebuild [--remove-data=no|yes] [-y]
                                        Rebuild Janus from the repo, replace the install and
                                        restart the service (runs in a new window). Default "no"
                                        keeps settings, configs, logs and database; "yes" deletes
                                        them all (asks unless -y)
  janus remove                          Completely remove the local Janus install (exe, settings,
                                        configs, logs and database)
  janus uninstall                       Same as remove
  janus update                          Update Janus (not implemented yet)
`

function cmdHelp(): number {
  console.log(USAGE)
  return 0
}

function parsePortFlag(argv: string[]): { port: number | null; rest: string[]; explicit: boolean } {
  const rest: string[] = []
  let port: number | null = null
  let explicit = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    let m: RegExpExecArray | null = null
    if ((m = /^--port=(\d+)$/.exec(a))) {
      port = parseInt(m[1], 10)
      explicit = true
    } else if (a === '--port' && argv[i + 1] !== undefined && /^\d+$/.test(argv[i + 1])) {
      port = parseInt(argv[i + 1], 10)
      explicit = true
      i++
    } else {
      rest.push(a)
    }
  }
  if (port !== null && (port < 1 || port > 65535)) {
    fail(`Invalid port: ${port}`)
  }
  return { port, rest, explicit }
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function parseNamedFlag(argv: string[], flag: string): string | null {
  const prefix = `--${flag}=`
  const eq = argv.find((a) => a.startsWith(prefix))
  if (eq) return eq.slice(prefix.length).trim() || null
  const i = argv.findIndex((a) => a === `--${flag}`)
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    return argv[i + 1].trim() || null
  }
  return null
}

function requireNamedFlag(argv: string[], flag: string, usage: string): string {
  const value = parseNamedFlag(argv, flag)
  if (!value) fail(`--${flag} is required.\nUsage: ${usage}`)
  return value
}

async function cmdServiceStart(argv: string[]): Promise<number> {
  const { port, explicit } = parsePortFlag(argv)
  const existing = findJanusInstances('serve')
  if (existing.length > 0) {
    const e = existing[0]
    const url = e.port ? `http://127.0.0.1:${e.port}/` : 'unknown port'
    console.log(`Service already running (pid ${e.pid}) at ${url}`)
    return 0
  }

  const chosen = explicit && port !== null ? port : readConfiguredPort()
  if (!(await bindTest(chosen))) {
    console.error(`Port ${chosen} is already in use.${portInUseHint(explicit)}`)
    return 1
  }

  const child = spawn(process.execPath, [SERVER_FLAG, `${SERVER_ARG}${chosen}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env }
  })
  child.unref()

  if (await waitUntilHealthy(chosen, 6000)) {
    console.log(`Service started (pid ${child.pid}) at http://127.0.0.1:${chosen}/`)
    return 0
  }

  // Health wait failed: kill the child if it is alive, then report with log tail.
  if (findJanusInstances('serve').some((i) => i.port === chosen)) stopAllInstances('serve')

  const tail = tailErrors()
  console.error('Service failed to start.')
  if (tail) console.error(`Recent errors (logs/errors/${new Date().toISOString().slice(0, 10)}.txt):\n${tail}`)
  return 1
}

function cmdServiceStop(): number {
  const n = stopAllInstances('serve')
  if (n === 0) {
    console.log('Service is not running.')
    return 0
  }
  console.log(`Service stopped (killed ${n} process${n === 1 ? '' : 'es'}).`)
  return 0
}

async function cmdServiceStatus(): Promise<number> {
  const found = findJanusInstances('serve')
  if (found.length === 0) {
    console.log('Service: stopped')
    return 1
  }
  const e = found[0]
  const healthy = e.port !== null ? await probeHealth(e.port) : false
  console.log(`Service: running`)
  console.log(`  PID:    ${e.pid}`)
  console.log(`  Port:   ${e.port ?? 'unknown'}`)
  console.log(`  Health: ${healthy ? 'ok' : e.port === null ? 'unknown' : 'UNREACHABLE'}`)
  if (e.port) console.log(`  URL:    http://127.0.0.1:${e.port}/`)
  return healthy ? 0 : 1
}

async function cmdServiceRestart(argv: string[]): Promise<number> {
  const { port, explicit } = parsePortFlag(argv)
  stopAllInstances('serve')
  const argv2: string[] = []
  if (explicit && port !== null) argv2.push(`--port=${port}`)
  // No explicit port: start uses the configured default port.
  return cmdServiceStart(argv2)
}

// Full stop: every Janus.exe of this install (service + foreground runs), then verify
// nothing is left and the default port is free. Idempotent.
async function cmdStop(): Promise<number> {
  const n = stopAllInstances('any', process.pid)
  console.log(n > 0 ? `Stopped ${n} Janus process${n === 1 ? '' : 'es'}.` : 'Janus is not running.')
  if (findJanusInstances('any', process.pid).length > 0) {
    console.error('Janus processes are still running after stop.')
    return 1
  }
  const port = readConfiguredPort()
  if (!(await bindTest(port))) {
    console.error(`Port ${port} is still in use by another program.`)
    return 1
  }
  return 0
}

// Starts (or reuses) the detached background service, opens the browser, and
// returns immediately so the terminal is released.
async function cmdRun(argv: string[]): Promise<number> {
  const noOpen = argv.some((a) => a === '--no-open')
  const started = await cmdServiceStart(argv)
  if (started !== 0) return started
  const e = findJanusInstances('serve')[0]
  if (!e || e.port === null) return 1
  const url = `http://127.0.0.1:${e.port}/`
  if (!noOpen) openBrowser(url)
  console.log(`Janus is running in the background at ${url}. Use "janus service stop" to stop it.`)
  return 0
}

async function cmdPort(argv: string[]): Promise<number> {
  const { port, explicit } = parsePortFlag(argv)
  if (!explicit) {
    const current = readConfiguredPort()
    const source = existsSync(settingsPath) && current !== DEFAULT_PORT ? 'settings.json' : 'built-in default'
    console.log(`Default port: ${current} (${source})`)
    console.log('Set it with: janus port --port=<N>')
    return 0
  }
  if (port === null) fail('Invalid port.')
  writeConfiguredPort(port)
  console.log(`Default port set to ${port} (saved in settings.json).`)
  if (findJanusInstances('serve').length > 0) {
    console.log('Restart the service for the change to take effect: janus service restart')
  }
  return 0
}

async function cmdRemove(): Promise<number> {
  // Safety: only ever delete a real installed layout (Janus.exe next to us). This
  // keeps dev runs (`node bundle.cjs`, execPath = node.exe) from deleting a random dir.
  const exeInInstall = join(installDir, 'Janus.exe')
  if (process.execPath.toLowerCase() !== exeInInstall.toLowerCase() || !existsSync(exeInInstall)) {
    console.error(`Refusing to remove: ${installDir} is not an installed Janus location (expected ${exeInInstall}).`)
    return 1
  }

  // 1. Stop every other Janus.exe instance of this install (service + foreground run).
  //    Our own pid must be excluded: killing it would abort this removal mid-flight.
  const stopped = stopAllInstances('any', process.pid)
  console.log(stopped > 0 ? `Stopped ${stopped} running Janus process${stopped === 1 ? '' : 'es'}.` : 'No running Janus processes.')

  // 2. Drop the user PATH entry (mirrors scripts/_common.ps1 Remove-JanusUserPathEntry).
  removeUserPathEntry(installDir)

  // 3. Legacy Windows services need elevation; point at the script instead of failing.
  const legacy = spawnSync('sc.exe', ['query', 'janus'], { windowsHide: true, stdio: 'ignore' })
  if (legacy.status === 0) {
    console.warn('Legacy Windows service "janus" detected — remove it with scripts\\remove-local.ps1 (elevation required).')
  }

  // 4. The install dir cannot be deleted while THIS exe is running from it:
  //    hand deletion to a detached helper that waits for our exit, then deletes
  //    the install dir (exe, settings, logs) and the app data (database).
  const ps =
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }; ` +
    `Remove-Item -LiteralPath '${installDir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue; ` +
    `Remove-Item -LiteralPath '${appDataRoot.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.env.TEMP || 'C:\\'
  })
  helper.unref()

  console.log(`Janus will be removed from ${installDir} and ${appDataRoot} when this process exits.`)
  return 0
}

function removeUserPathEntry(dir: string): void {
  const norm = dir.replace(/\\+$/, '').replace(/'/g, "''")
  const script =
    `$norm = '${norm}'; ` +
    `$userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); ` +
    `if ($userPath) { ` +
    `$kept = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() -and $_.Trim().TrimEnd('\\') -ine $norm }); ` +
    `if ($kept.Count -eq 0) { [Environment]::SetEnvironmentVariable('Path', $null, 'User') } ` +
    `else { $newPath = $kept -join ';'; if ($newPath -ne $userPath) { [Environment]::SetEnvironmentVariable('Path', $newPath, 'User') } } }`
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    windowsHide: true
  })
  if (res.status === 0) console.log('Removed install dir from user PATH.')
  else console.warn('Could not remove the install dir from user PATH (remove it manually).')
}

function cmdUpdate(): number {
  console.error('janus update: not implemented yet.')
  return 1
}

// Runs scripts\install-local.ps1 from the repo recorded at install time. It runs in its
// own console window because the script stops this very Janus.exe before replacing it.
// Runs a script from the repo recorded at install time, in a new window (the script stops
// this very Janus.exe, so it cannot run in our own console).
function runRepoScriptInWindow(scriptName: string, scriptArgs: string[]): number {
  const repoFile = join(installDir, 'repo-root.txt')
  const repoRoot = existsSync(repoFile) ? readFileSync(repoFile, 'utf-8').trim() : ''
  const script = join(repoRoot, 'scripts', scriptName)
  if (!repoRoot || !existsSync(script)) {
    console.error(`Repo not found (${repoFile}). Run scripts\\${scriptName} once from the repo.`)
    return 1
  }
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const argList = ['-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script, ...scriptArgs]
  const ps = `Start-Process powershell.exe -WorkingDirectory ${q(repoRoot)} -ArgumentList ${argList.map(q).join(',')}`
  spawnSync('powershell.exe', [...PS_JSON_FLAGS, ps], { windowsHide: true })
  return 0
}

// Rebuilds Janus.exe from the repo and replaces the install (service restarted).
// remove-data=no (default) keeps settings, configs, logs and database; yes deletes them all
// after a confirmation (skipped with -y).
async function cmdRebuild(argv: string[]): Promise<number> {
  const removeData = parseNamedFlag(argv, 'remove-data') ?? 'no'
  if (removeData !== 'no' && removeData !== 'yes') fail('--remove-data must be "no" or "yes".')
  const yes = argv.includes('-y') || argv.includes('--yes')
  if (removeData === 'yes' && !yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`This deletes ALL Janus settings, configs, logs and database in ${installDir} and ${appDataRoot}. Type "yes" to continue: `)
    rl.close()
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Cancelled. Nothing was changed.')
      return 1
    }
  }
  const code = removeData === 'yes'
    ? runRepoScriptInWindow('reinstall.ps1', ['-RemoveData', 'yes', '-Yes'])
    : runRepoScriptInWindow('install-local.ps1', ['-StartService'])
  if (code === 0) console.log(`Rebuild started in a new window (remove-data=${removeData}).`)
  return code
}

function openBrowser(url: string): void {
  try {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (err) {
    console.warn(`could not open browser: ${format(err)}`)
  }
}

async function cmdStatus(): Promise<number> {
  console.log(`Install dir: ${installDir}${process.env.JANUS_INSTALL_DIR?.trim() ? '  [JANUS_INSTALL_DIR override]' : ''}`)
  console.log(`Exe:         ${process.execPath}`)
  try {
    const st = statSync(process.execPath)
    console.log(`             ${(st.size / (1024 * 1024)).toFixed(1)} MB, built ${st.mtime.toISOString()}`)
  } catch {
    /* ignore */
  }

  // settings.json (raw read — no side effects)
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed as object).length : 0
      console.log(`Settings:    ${settingsPath} (ok, ${keys} top-level keys)`)
    } catch (err) {
      console.log(`Settings:    ${settingsPath} (INVALID: ${format(err)})`)
    }
  } else {
    console.log(`Settings:    ${settingsPath} (missing — created on first server start)`)
  }

  console.log(`Default port: ${readConfiguredPort()}`)

  const found = findJanusInstances('serve')
  if (found.length === 0) {
    console.log('Service:     stopped')
  } else {
    const e = found[0]
    const healthy = e.port !== null ? await probeHealth(e.port) : false
    console.log(`Service:     running (pid ${e.pid}, port ${e.port ?? '?'}, health ${healthy ? 'ok' : 'unreachable'})`)
    if (e.port) console.log(`WebUI:       http://127.0.0.1:${e.port}/`)
  }

  const legacy = spawnSync('sc.exe', ['query', 'janus'], { windowsHide: true, stdio: 'ignore' })
  if (legacy.status === 0) {
    console.log('Legacy:      old Windows service "janus" detected (run scripts\\remove-local.ps1 to remove it)')
  }
  // Exit codes: 0 running, 3 stopped, 4 not installed.
  if (!existsSync(join(installDir, 'Janus.exe'))) return 4
  return found.length > 0 ? 0 : 3
}

interface CheckResult {
  state: 'OK' | 'WARN' | 'FAIL'
  name: string
  detail: string
}

async function cmdDoctor(): Promise<number> {
  const checks: CheckResult[] = []
  const ok = (name: string, detail: string): void => { checks.push({ state: 'OK', name, detail }) }
  const warn = (name: string, detail: string): void => { checks.push({ state: 'WARN', name, detail }) }
  const bad = (name: string, detail: string): void => { checks.push({ state: 'FAIL', name, detail }) }

  // 1. Executable present (we are running from it).
  if (process.execPath.toLowerCase().endsWith('janus.exe')) {
    ok('exe', process.execPath)
  } else {
    bad('exe', `running from ${process.execPath}, expected Janus.exe`)
  }

  // 2. settings.json parses.
  if (existsSync(settingsPath)) {
    try {
      JSON.parse(readFileSync(settingsPath, 'utf-8'))
      ok('settings.json', 'present and valid JSON')
    } catch (err) {
      bad('settings.json', `present but INVALID: ${format(err)}`)
    }
  } else {
    warn('settings.json', 'missing (will be created on first server start)')
  }

  // 3. Log dirs exist and are writable.
  let logsOk = true
  for (const b of ['infos', 'warnings', 'errors'] as LogBucket[]) {
    try {
      const dir = join(logsRoot, b)
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, `.probe`), '')
      try { unlinkSync(join(dir, `.probe`)) } catch { /* ignore */ }
    } catch (err) {
      logsOk = false
      bad('logs', `${b}: ${format(err)}`)
      break
    }
  }
  if (logsOk) ok('logs', `${logsRoot}\\{infos,warnings,errors} writable`)

  // 4. Install dir on PATH (current session).
  const pathEntries = (process.env.Path || process.env.PATH || '').split(';').map((p) => p.trim().replace(/\\+$/, '').toLowerCase())
  if (pathEntries.includes(installDir.replace(/\\+$/, '').toLowerCase())) {
    ok('PATH', 'install dir is on PATH')
  } else {
    const envOverride = process.env.JANUS_INSTALL_DIR?.trim()
    warn('PATH', `install dir NOT on PATH — open a new terminal (or re-run install-local.ps1)${envOverride ? ` [JANUS_INSTALL_DIR override active: ${envOverride}]` : ''}`)
  }

  // 5. WebUI assets embedded.
  const idx = getWebuiAsset('index.html')
  if (idx && idx.length > 0) {
    ok('webui', `embedded index.html (${idx.length} bytes)${seaMod ? '' : ' [dev mode: reading dist from disk]'}`)
  } else {
    bad('webui', 'embedded index.html not found in exe')
  }

  // 6. git on PATH (needed by scans via simple-git).
  const git = spawnSync('git', ['--version'], { windowsHide: true, stdio: 'ignore' })
  if (git.status === 0) ok('git', 'available')
  else warn('git', 'not found on PATH — resource scans that use git will fail')

  // 7. Service state (needed by the default-port check below).
  const found = findJanusInstances('serve')
  if (found.length === 0) {
    warn('service', 'stopped (janus service start to run it)')
  } else {
    const e = found[0]
    const healthy = e.port !== null ? await probeHealth(e.port) : false
    if (healthy) ok('service', `running (pid ${e.pid}, port ${e.port})`)
    else bad('service', `running (pid ${e.pid}) but health check failed on port ${e.port}`)
  }

  // 8. Default port free, or already held by our own running service.
  const defaultPort = readConfiguredPort()
  if (await bindTest(defaultPort)) {
    ok('port', `default port ${defaultPort} is free`)
  } else if (found.some((i) => i.port === defaultPort)) {
    ok('port', `default port ${defaultPort} in use by the running service`)
  } else {
    bad('port', `default port ${defaultPort} is in use by another program — change it with: janus port --port=<N>`)
  }

  // 9. Legacy Windows services.
  const legacy = spawnSync('sc.exe', ['query', 'janus'], { windowsHide: true, stdio: 'ignore' })
  if (legacy.status === 0) {
    warn('legacy', 'old Windows services "janus"/"janus-webui" still installed — run scripts\\remove-local.ps1 to remove them')
  }

  // Print report.
  for (const c of checks) {
    const tag = c.state === 'OK' ? '[OK]  ' : c.state === 'WARN' ? '[WARN]' : '[FAIL]'
    console.log(`${tag} ${c.name.padEnd(14)} ${c.detail}`)
  }
  const failed = checks.filter((c) => c.state === 'FAIL').length
  const warned = checks.filter((c) => c.state === 'WARN').length
  console.log(`\n${checks.length} checks: ${checks.length - failed - warned} ok, ${warned} warnings, ${failed} failed`)
  return failed > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// version / skills / ide commands
// ---------------------------------------------------------------------------

// Installed and CLI versions are the same build stamp (the CLI is bundled into Janus.exe).
// Source is the repo's janus-api/package.json, read via the repo-root.txt written at install.
function cmdVersion(): number {
  const repoFile = join(installDir, 'repo-root.txt')
  const repoRoot = existsSync(repoFile) ? readFileSync(repoFile, 'utf-8').trim() : ''
  const pkg = join(repoRoot, 'janus-api', 'package.json')
  const source = repoRoot && existsSync(pkg)
    ? (JSON.parse(readFileSync(pkg, 'utf-8')) as { version?: string }).version ?? 'unknown'
    : 'unknown (no repo-root.txt)'
  console.log(`Installed: ${JANUS_VERSION}`)
  console.log(`Source:    ${source}`)
  if (source !== 'unknown' && source !== JANUS_VERSION) {
    console.warn(`Mismatch: installed ${JANUS_VERSION} differs from source ${source}. Run: janus rebuild`)
  }
  return 0
}

async function cmdSkillsList(): Promise<number> {
  ensurePortableLayout()
  const settings = settingsStore.get()
  const scan = await scannerService.scanAll(settings)
  const summaries = await resourceService.getGroupSummaries(scan, settings, 'skill')
  if (summaries.length === 0) {
    console.log('No skills found (check your projects and enabled IDEs/CLIs with: janus ide list).')
    return 0
  }
  for (const s of summaries) {
    const flags = [
      `${s.usedProjectCount}/${s.totalProjectCount} projects`,
      s.inGlobal ? 'global' : null,
      s.mandatory ? 'mandatory' : null,
      s.structureOk ? null : 'structure-warning'
    ].filter(Boolean).join(', ')
    const desc = s.description ? `  ${s.description}` : ''
    console.log(`${s.name.padEnd(32)} [~${s.tokenEstimate} tok] (${flags})${desc}`)
  }
  console.log(`\n${summaries.length} skill${summaries.length === 1 ? '' : 's'}`)
  return 0
}

async function cmdSkillsDelete(argv: string[]): Promise<number> {
  const name = requireNamedFlag(argv, 'skill', 'janus skills delete --skill=<name>')
  ensurePortableLayout()
  const settings = settingsStore.get()
  const scan = await scannerService.scanAll(settings)
  if (!resourceService.findCanonicalInstance(scan, 'skill', name)) {
    console.error(`Skill not found: ${name}`)
    return 1
  }
  try {
    await resourceService.deleteResource(scan, 'skill', name)
  } catch (err) {
    fail(`Failed to delete skill "${name}": ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log(`Skill "${name}" deleted (moved to the Janus trash).`)
  return 0
}

async function cmdSkillsRename(argv: string[]): Promise<number> {
  const name = requireNamedFlag(argv, 'skill', 'janus skills rename --skill=<name> --new-name=<name>')
  const newName = requireNamedFlag(argv, 'new-name', 'janus skills rename --skill=<name> --new-name=<name>')
  ensurePortableLayout()
  const settings = settingsStore.get()
  const scan = await scannerService.scanAll(settings)
  if (!resourceService.findCanonicalInstance(scan, 'skill', name)) {
    console.error(`Skill not found: ${name}`)
    return 1
  }
  try {
    await resourceService.renameResource(scan, 'skill', name, newName)
  } catch (err) {
    fail(`Failed to rename skill "${name}": ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log(`Skill renamed: ${name} -> ${newName}`)
  return 0
}

function resolvePlatformId(raw: string): PlatformId {
  const lower = raw.trim().toLowerCase()
  const byId = PLATFORM_IDS.find((id) => id === lower)
  if (byId) return byId
  const byLabel = PLATFORM_IDS.find((id) => PLATFORM_LABELS[id].toLowerCase() === lower)
  if (byLabel) return byLabel
  fail(
    `Unknown IDE/CLI: "${raw}". Known ids: ${PLATFORM_IDS.join(', ')} ` +
    `(or labels: ${PLATFORM_IDS.map((id) => PLATFORM_LABELS[id]).join(', ')}).`
  )
}

async function cmdIdeList(): Promise<number> {
  const settings = settingsStore.get()
  for (const p of settings.platforms) {
    const state = p.enabled ? '[ON ]' : '[OFF]'
    const rootMissing = p.enabled && !existsSync(p.rootPath) ? ' (root folder missing)' : ''
    console.log(
      `${state} ${p.id.padEnd(12)} ${PLATFORM_LABELS[p.id].padEnd(12)} ` +
      `root=${p.rootPath}${rootMissing}  projectDir=${p.projectDirName}`
    )
  }
  return 0
}

async function cmdIdeStatus(): Promise<number> {
  const settings = settingsStore.get()
  const enabled = settings.platforms.filter((p) => p.enabled)
  const disabled = settings.platforms.filter((p) => !p.enabled)
  console.log(`IDEs/CLIs: ${enabled.length} enabled, ${disabled.length} disabled (${settings.platforms.length} total)`)
  console.log(`Enabled:   ${enabled.map((p) => PLATFORM_LABELS[p.id]).join(', ') || '(none)'}`)
  console.log(`Disabled:  ${disabled.map((p) => PLATFORM_LABELS[p.id]).join(', ') || '(none)'}`)
  console.log(`Projects:  ${settings.projectRoots.reduce((n, r) => n + r.projects.length, 0)} configured`)
  for (const p of enabled) {
    if (!existsSync(p.rootPath)) {
      console.warn(`Warning: enabled ${PLATFORM_LABELS[p.id]} root folder is missing: ${p.rootPath}`)
    }
  }
  return 0
}

// Mirrors PUT /api/settings' platform-change handling: mcp enable cascade,
// folder purge on disable, then re-sync of enabled platforms into projects.
async function setIdeEnabled(raw: string, enabled: boolean): Promise<number> {
  const id = resolvePlatformId(raw)
  const settings = settingsStore.get()
  const platform = settings.platforms.find((p) => p.id === id)
  if (!platform) fail(`Platform "${id}" is not configured in settings.`)
  if (platform.enabled === enabled) {
    console.log(`${PLATFORM_LABELS[id]} is already ${enabled ? 'enabled' : 'disabled'}.`)
    return 0
  }

  const previousPlatforms = settings.platforms
  const nextPlatforms = previousPlatforms.map((p) => (p.id === id ? { ...p, enabled } : p))
  const mcpEnabled = await applyMcpEnableCascade(
    previousPlatforms,
    nextPlatforms,
    settings.mcpEnabled ?? {}
  )
  settingsStore.save({ ...settings, platforms: nextPlatforms, mcpEnabled })

  if (!enabled) {
    try {
      await removeUnselectedPlatformFolders(previousPlatforms, nextPlatforms)
    } catch (err) {
      console.error(`Removing ${PLATFORM_LABELS[id]} project folders failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    await syncEnabledPlatformsToProjects()
  } catch (err) {
    console.error(`Project sync after ${enabled ? 'enable' : 'disable'} failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  console.log(`${PLATFORM_LABELS[id]} ${enabled ? 'enabled' : 'disabled'}.`)
  if (findJanusInstances('serve').length > 0) {
    console.log('A running service picks the change up through its file watcher.')
  }
  return 0
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Every command's console output is mirrored into the daily log files.
  installConsoleHooks(true)
  ensureDailyLogs()
  const argv = process.argv.slice(2)
  const cmd = argv[0]

  // Internal background-server mode.
  if (cmd === SERVER_FLAG) {
    const { port } = parsePortFlag(argv.slice(1))
    if (port === null) fail(`${SERVER_FLAG} requires --port=N`)
    await serve(port)
    return
  }

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.exit(cmdHelp())
      break
    case 'doctor':
      process.exit(await cmdDoctor())
      break
    case 'version':
    case '--version':
      process.exit(cmdVersion())
      break
    case 'status':
      process.exit(await cmdStatus())
      break
    case 'skills': {
      const sub = argv[1]
      if (sub === 'list') process.exit(await cmdSkillsList())
      else if (sub === 'delete') process.exit(await cmdSkillsDelete(argv.slice(2)))
      else if (sub === 'rename') process.exit(await cmdSkillsRename(argv.slice(2)))
      else {
        console.error(`Unknown skills command: ${sub || '(missing)'}\n\n${USAGE}`)
        process.exit(1)
      }
      break
    }
    case 'ide': {
      const sub = argv[1]
      if (sub === 'status') process.exit(await cmdIdeStatus())
      else if (sub === 'list') process.exit(await cmdIdeList())
      else if (sub === 'enable') process.exit(await setIdeEnabled(requireNamedFlag(argv.slice(2), 'ide', 'janus ide enable --ide=<id>'), true))
      else if (sub === 'disable') process.exit(await setIdeEnabled(requireNamedFlag(argv.slice(2), 'ide', 'janus ide disable --ide=<id>'), false))
      else {
        console.error(`Unknown ide command: ${sub || '(missing)'}\n\n${USAGE}`)
        process.exit(1)
      }
      break
    }
    case 'service': {
      const sub = argv[1]
      if (sub === 'start') process.exit(await cmdServiceStart(argv.slice(2)))
      else if (sub === 'stop') process.exit(cmdServiceStop())
      else if (sub === 'status') process.exit(await cmdServiceStatus())
      else if (sub === 'restart') process.exit(await cmdServiceRestart(argv.slice(2)))
      else {
        console.error(`Unknown service command: ${sub || '(missing)'}\n\n${USAGE}`)
        process.exit(1)
      }
      break
    }
    case 'run':
      process.exit(await cmdRun(argv.slice(1)))
      break
    case 'stop':
      process.exit(await cmdStop())
      break
    case 'rebuild':
    case 'reinstall': // legacy alias of rebuild
      process.exit(await cmdRebuild(argv.slice(1)))
      break
    case 'port':
      process.exit(await cmdPort(argv.slice(1)))
      break
    case 'remove':
    case 'uninstall':
      process.exit(await cmdRemove())
      break
    case 'update':
      process.exit(cmdUpdate())
      break
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : format(err))
  process.exit(1)
})

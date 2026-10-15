import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'
import type {
  AppSettings,
  ProjectInfo,
  ResourceSource,
  ResourceType,
  ScanResult
} from '../shared/types'
import {
  parseFrontmatter,
  skillContentHash,
  stableId,
  extractResourceMeta,
  metaTimestampToIso,
  validateSkillStructure,
  validateSubAgentStructure
} from '../shared/utils'
import { fileService } from './file.service'
import { getAdapter } from '../platforms'
import type { PlatformAdapter, PlatformPaths } from '../platforms/types'
import { supportsResource } from '../platforms/types'
import { probeMcpServers } from './mcp-probe.service'
import { agentDebugLog } from './debug-log'
import { getSkillsStorePath } from '../app-paths'
import { seedSkillContentHashes } from './skill-sync.service'
import { reconcileSharedUuids } from './uuid-reconcile.service'
import { reconcileSkillNames } from './skill-name-sync.service'

const PLATFORM_SCAN_TYPES: ResourceType[] = ['mcp']
/** Global skills under each enabled platform root (rootPath/skills). */
const GLOBAL_SCAN_TYPES: ResourceType[] = ['skill']
/** Cursor root (~/.cursor) additionally hosts sub-agents. */
const CURSOR_GLOBAL_SCAN_TYPES: ResourceType[] = ['skill', 'subAgent']

export interface ScanAllOptions {
  /** Spawn MCP processes to check connectivity. Expensive; default false. */
  probeMcps?: boolean
}

const STORE_SOURCE: ResourceSource = { type: 'local', id: 'janus', label: 'Janus' }

/** A cached scan older than this triggers a background refresh on read. */
const READ_STALE_MS = 30_000
/** Unconditional background re-scan interval even without watcher events. */
const BACKGROUND_REFRESH_MS = 120_000
/** Coalesce watcher bursts into a single refresh. */
const REFRESH_DEBOUNCE_MS = 500

export class ScannerService {
  private inflight: Promise<ScanResult> | null = null
  private inflightProbe = false
  private pendingAfterInflight = false
  private cached: ScanResult | null = null
  private cachedAt = 0
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshSettings: AppSettings | null = null
  private backgroundTimer: ReturnType<typeof setInterval> | null = null

  async scanAll(settings: AppSettings, options: ScanAllOptions = {}): Promise<ScanResult> {
    const probeMcps = options.probeMcps === true

    // Share one in-flight scan when concurrent callers agree on probe level
    if (this.inflight && (!probeMcps || this.inflightProbe)) {
      // #region agent log
      agentDebugLog('C', 'scanner.service.ts:scanAll:reuse', 'reusing in-flight scanAll', {
        probeMcps,
        inflightProbe: this.inflightProbe
      })
      // #endregion
      return this.inflight
    }

    const run = this.executeScanAll(settings, probeMcps)
    this.inflight = run
    this.inflightProbe = probeMcps
    try {
      return await run
    } finally {
      if (this.inflight === run) {
        this.inflight = null
        this.inflightProbe = false
        if (this.pendingAfterInflight && this.refreshSettings) {
          this.pendingAfterInflight = false
          this.scheduleBackgroundRefresh(this.refreshSettings)
        }
      }
    }
  }

  /** Latest completed scan, or null before the first scan finishes. */
  getCachedScan(): ScanResult | null {
    return this.cached
  }

  /**
   * Read path used by page-load endpoints: serve the latest cached scan
   * immediately and refresh in the background when stale. Falls back to a
   * synchronous scan only on cold start (no cache yet).
   */
  async getScanForRead(settings: AppSettings): Promise<ScanResult> {
    if (!this.cached) {
      return this.scanAll(settings)
    }
    if (Date.now() - this.cachedAt > READ_STALE_MS) {
      this.scheduleBackgroundRefresh(settings)
    }
    return this.cached
  }

  /** Run a scan now and update the cache (used after in-app mutations). */
  async refresh(settings: AppSettings): Promise<ScanResult> {
    return this.scanAll(settings)
  }

  /** Queue a debounced, non-blocking cache refresh. */
  scheduleBackgroundRefresh(settings: AppSettings): void {
    this.refreshSettings = settings
    if (this.inflight) {
      this.pendingAfterInflight = true
      return
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      const target = this.refreshSettings
      if (!target) return
      void this.scanAll(target).catch((err) => {
        console.error('Background scan refresh failed:', err)
      })
    }, REFRESH_DEBOUNCE_MS)
  }

  /** Warm the cache at boot and keep it current on a fixed interval. */
  startBackgroundUpdates(getSettings: () => AppSettings): void {
    if (this.backgroundTimer) return
    void this.scanAll(getSettings()).catch((err) => {
      console.error('Initial background scan failed:', err)
    })
    this.backgroundTimer = setInterval(() => {
      this.scheduleBackgroundRefresh(getSettings())
    }, BACKGROUND_REFRESH_MS)
  }

  stopBackgroundUpdates(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer)
      this.backgroundTimer = null
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.pendingAfterInflight = false
  }

  private async executeScanAll(settings: AppSettings, probeMcps: boolean): Promise<ScanResult> {
    // #region agent log
    const scanStartedAt = Date.now()
    const projectCount = settings.projectRoots.reduce((n, r) => n + r.projects.length, 0)
    const enabledPlatforms = settings.platforms.filter((p) => p.enabled).length
    agentDebugLog('E', 'scanner.service.ts:scanAll:start', 'scanAll started', {
      projectCount,
      enabledPlatforms,
      probeMcps,
      runId: 'post-fix'
    })
    // #endregion

    const result: ScanResult = {
      skills: [],
      mcps: [],
      subAgents: []
    }

    // Janus store is the canonical skill list; platform/project copies are read below.
    await this.pushSkillRoots(getSkillsStorePath(), STORE_SOURCE, settings, result)

    for (const platform of settings.platforms) {
      if (!platform.enabled) continue
      const adapter = getAdapter(platform.id)
      if (!adapter) continue

      const paths = adapter.getPlatformPaths(platform.rootPath)
      const source: ResourceSource = {
        type: 'platform',
        id: platform.id,
        label: adapter.label
      }

      // MCPs / tools from the platform root (all platforms)
      await this.scanPaths(adapter, paths, source, settings, result, PLATFORM_SCAN_TYPES)

      // Global Skills from every enabled platform root (surface as "<Name> (Global)"
      // rows in the Projects panel). Cursor root also hosts sub-agents; its skills
      // load exclusively from ~/.cursor/skills (not skills-cursor).
      const isCursor = platform.id === 'cursor'
      const globalPaths: PlatformPaths = isCursor
        ? { ...paths, skillsDirs: [join(platform.rootPath, 'skills')] }
        : paths
      await this.scanPaths(
        adapter,
        globalPaths,
        source,
        settings,
        result,
        isCursor ? CURSOR_GLOBAL_SCAN_TYPES : GLOBAL_SCAN_TYPES
      )
    }

    for (const root of settings.projectRoots) {
      for (const project of root.projects) {
        for (const platform of settings.platforms) {
          if (!platform.enabled) continue
          const adapter = getAdapter(platform.id)
          if (!adapter) continue

          const paths = adapter.getProjectPaths(project.path, platform.projectDirName)
          const source: ResourceSource = {
            type: 'project',
            id: project.id,
            label: `${project.name} (${adapter.label})`
          }

          await this.scanPaths(adapter, paths, source, settings, result)
        }
      }
    }

    // #region agent log
    const fsScanMs = Date.now() - scanStartedAt
    agentDebugLog('A', 'scanner.service.ts:scanAll:afterFs', 'filesystem scan done', {
      fsScanMs,
      skills: result.skills.length,
      uniqueSkillNames: [...new Set(result.skills.map((s) => s.name))].length,
      mcps: result.mcps.length,
      subAgents: result.subAgents.length,
      probeMcps
    })
    // #endregion

    await reconcileSharedUuids(result)
    // Reflect skills renamed outside the app (folder <-> SKILL.md name sync).
    await reconcileSkillNames(result)

    if (probeMcps) {
      await this.probeMcps(result)
    }

    seedSkillContentHashes(
      result.skills.map((s) => ({ rootPath: s.rootPath, contentHash: s.contentHash }))
    )

    // #region agent log
    agentDebugLog('A', 'scanner.service.ts:scanAll:end', 'scanAll finished', {
      totalMs: Date.now() - scanStartedAt,
      fsScanMs,
      mcpCount: result.mcps.length,
      probeMcps,
      runId: 'post-fix'
    })
    // #endregion

    this.cached = result
    this.cachedAt = Date.now()

    return result
  }

  private async probeMcps(result: ScanResult): Promise<void> {
    const unique = new Map<string, Record<string, unknown>>()
    for (const mcp of result.mcps) {
      if (!mcp.enabled) continue
      if (!unique.has(mcp.name)) unique.set(mcp.name, mcp.params)
    }

    const probes = await probeMcpServers(
      [...unique.entries()].map(([name, params]) => ({ name, params }))
    )

    for (const mcp of result.mcps) {
      const probe = probes.get(mcp.name)
      if (probe) {
        mcp.status = probe.status
        mcp.tools = probe.tools
        mcp.error = probe.error
      }
    }
  }

  async discoverGitProjects(scanPath: string): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = []
    await this.walkForGit(scanPath, projects, scanPath)
    return projects.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async walkForGit(
    dir: string,
    projects: ProjectInfo[],
    rootId: string,
    depth = 0
  ): Promise<void> {
    if (depth > 6) return
    if (!existsSync(dir)) return

    const gitDir = join(dir, '.git')
    if (existsSync(gitDir)) {
      projects.push({
        id: stableId(dir),
        name: basename(dir),
        path: dir,
        rootId
      })
      return
    }

    const subdirs = await fileService.listDirectories(dir)
    for (const sub of subdirs) {
      const name = basename(sub)
      if (name === 'node_modules' || name === '.git') continue
      await this.walkForGit(sub, projects, rootId, depth + 1)
    }
  }

  private async scanPaths(
    adapter: PlatformAdapter,
    paths: PlatformPaths,
    source: ResourceSource,
    settings: AppSettings,
    result: ScanResult,
    allowedTypes?: ResourceType[]
  ): Promise<void> {
    const canScan = (type: ResourceType) => !allowedTypes || allowedTypes.includes(type)

    if (canScan('skill') && supportsResource(adapter, 'skill')) {
      for (const skillsDir of paths.skillsDirs) {
        await this.pushSkillRoots(skillsDir, source, settings, result)
      }
    }


    if (canScan('mcp') && supportsResource(adapter, 'mcp') && existsSync(paths.mcpConfigPath)) {
      try {
        const mtimeMs = await fileService.getMtime(paths.mcpConfigPath)
        const lastUpdatedAt = mtimeMs ? new Date(mtimeMs).toISOString() : null
        const raw = await fileService.readText(paths.mcpConfigPath)
        const parsed = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> }
        for (const [name, params] of Object.entries(parsed.mcpServers ?? {})) {
          const id = stableId(source.id, name)
          result.mcps.push({
            id,
            name,
            params,
            tools: [],
            status: 'unknown',
            platforms: [source.id],
            configPath: paths.mcpConfigPath,
            lastUpdatedAt,
            enabled: settings.mcpEnabled?.[name] ?? true
          })
        }
      } catch {
        // ignore invalid mcp.json
      }
    }


    if (
      canScan('subAgent') &&
      supportsResource(adapter, 'subAgent') &&
      paths.agentsDir &&
      existsSync(paths.agentsDir)
    ) {
      const files = await fileService.listFilesRecursive(paths.agentsDir)
      for (const file of files) {
        if (!/\.md$/i.test(file)) continue
        const content = await fileService.readText(file)
        const { frontmatter } = parseFrontmatter(content)
        const meta = extractResourceMeta(frontmatter)
        const structure = validateSubAgentStructure(frontmatter)
        const id = meta.uuid || `pending:${stableId(source.id, file)}`
        result.subAgents.push({
          id,
          name: String(frontmatter.name ?? basename(file, '.md')),
          description: String(frontmatter.description ?? ''),
          filePath: file,
          frontmatter,
          uuid: meta.uuid ?? '',
          lastUpdatedAt: metaTimestampToIso(meta.last_updated),
          structureOk: structure.ok,
          structureWarning: structure.ok ? undefined : structure.reason,
          source,
          enabled: settings.assignments.subAgents[id]?.includes(source.id) ?? true
        })
      }
    }
  }
  /** Add every skill folder under skillsDir to result.skills (names are relative to skillsDir). */
  private async pushSkillRoots(
    skillsDir: string,
    source: ResourceSource,
    settings: AppSettings,
    result: ScanResult
  ): Promise<void> {
    for (const dir of await this.findSkillRoots(skillsDir)) {
      const skillMd = join(dir, 'SKILL.md')
      const files = await fileService.listFilesRecursive(dir)
      const skillMdText = await fileService.readText(skillMd)
      const { frontmatter } = parseFrontmatter(skillMdText)
      const meta = extractResourceMeta(frontmatter)
      const structure = validateSkillStructure(frontmatter)
      const id = meta.uuid || `pending:${stableId(source.id, dir)}`
      const relativeName = dir
        .slice(skillsDir.length)
        .replace(/^[/\\]+/, '')
        .replace(/\\/g, '/')
      result.skills.push({
        id,
        name: relativeName || basename(dir),
        rootPath: dir,
        skillMdPath: skillMd,
        contentHash: skillContentHash(skillMdText),
        uuid: meta.uuid ?? '',
        lastUpdatedAt: metaTimestampToIso(meta.last_updated),
        structureOk: structure.ok,
        structureWarning: structure.ok ? undefined : structure.reason,
        files,
        source,
        enabled: settings.assignments.skills[id]?.includes(source.id) ?? true
      })
    }
  }

  /**
   * Find every skill root under a skills directory, including nested folders.
   * A skill root is any directory that contains a SKILL.md file.
   */
  private async findSkillRoots(skillsDir: string): Promise<string[]> {
    if (!existsSync(skillsDir)) return []

    const files = await fileService.listFilesRecursive(skillsDir)
    const roots: string[] = []
    const seen = new Set<string>()

    for (const file of files) {
      if (basename(file).toLowerCase() !== 'skill.md') continue
      if (this.shouldSkipSkillPath(file, skillsDir)) continue

      const root = dirname(file)
      const key = root.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      roots.push(root)
    }

    return roots.sort((a, b) => a.localeCompare(b))
  }

  private shouldSkipSkillPath(filePath: string, skillsDir: string): boolean {
    const rel = filePath.slice(skillsDir.length).replace(/^[/\\]+/, '')
    return rel.split(/[/\\]/).some(
      (segment) =>
        segment === 'node_modules' ||
        segment === '.git' ||
        segment === '.trash' ||
        segment === 'dist' ||
        segment === 'coverage'
    )
  }
}

export const scannerService = new ScannerService()

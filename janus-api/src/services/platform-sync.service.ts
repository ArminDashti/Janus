import { existsSync } from 'fs'
import { join } from 'path'
import type {
  PlatformConfig,
  PlatformId,
  ResourceType,
  ScanResult,
  SkillResource,
  SubAgentResource
} from '../shared/types'
import { getSkillsStorePath } from '../app-paths'
import { assignmentService } from './assignment.service'
import { fileService } from './file.service'
import { platformCleanupService } from './platform-cleanup.service'
import { projectBootstrapService } from './project-bootstrap.service'
import { scannerService } from './scanner.service'
import { settingsStore } from './settings-store'
import { getAdapter } from '../platforms'

type ScannedResource = SkillResource | SubAgentResource

const FILL_TYPES: Array<Exclude<ResourceType, 'mcp'>> = ['skill', 'subAgent']

function getItems(scan: ScanResult, resourceType: Exclude<ResourceType, 'mcp'>): ScannedResource[] {
  switch (resourceType) {
    case 'skill':
      return scan.skills
    case 'subAgent':
      return scan.subAgents
  }
}

function resourceKey(item: ScannedResource): string {
  return item.name
}

/**
 * Import platform/project skills into the store. For each skill name the newest copy wins
 * (SKILL.md mtime); the store is replaced only when that copy is strictly newer.
 * ponytail: mtime is the recency signal; frontmatter last_updated is stamped once and never refreshed.
 */
export async function importNewestSkillsIntoStore(scan: ScanResult): Promise<void> {
  const store = getSkillsStorePath()
  const newest = new Map<string, { skill: SkillResource; mtime: number }>()
  for (const skill of scan.skills) {
    if (skill.source.type === 'local') continue
    const mtime = (await fileService.getMtime(join(skill.rootPath, 'SKILL.md'))) ?? 0
    if (mtime > (newest.get(skill.name)?.mtime ?? -1)) newest.set(skill.name, { skill, mtime })
  }
  for (const [name, { skill, mtime }] of newest) {
    const dest = join(store, ...name.split('/'))
    const storeMtime = (await fileService.getMtime(join(dest, 'SKILL.md'))) ?? -1
    if (storeMtime >= mtime) continue
    await fileService.removePath(dest)
    await fileService.copyDirectory(skill.rootPath, dest)
  }
}

/**
 * Janus store is the source of truth. Ensure enabled platform folders exist, import the newest
 * copy of each skill into the store, then overwrite every copy with the store version.
 * Runs on Sync click and on app start.
 */
export async function syncEnabledPlatformsToProjects(): Promise<void> {
  await projectBootstrapService.bootstrapEnabledPlatformsForAllProjects()

  let scan = await scannerService.scanAll(settingsStore.get())
  await importNewestSkillsIntoStore(scan)
  scan = await scannerService.scanAll(settingsStore.get())

  // IDE/CLI global copies: refresh each one that exists from the store.
  for (const copy of scan.skills) {
    if (copy.source.type !== 'platform') continue
    const canonical = scan.skills.find((s) => s.source.type === 'local' && s.name === copy.name)
    if (canonical) {
      await assignmentService.assignToPlatformGlobal(canonical, 'skill', copy.source.id as PlatformId, true)
    }
  }

  for (const resourceType of FILL_TYPES) {
    // Dedupe: one assign per (resource name, projectId)
    const seen = new Set<string>()

    for (const item of getItems(scan, resourceType)) {
      if (item.source.type !== 'project') continue

      const name = resourceKey(item)
      const projectId = item.source.id
      const dedupeKey = `${resourceType}:${name}:${projectId}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      // Janus store copy is canonical; project/platform copies are overwritten from it.
      const sameName = getItems(scan, resourceType).filter((candidate) => resourceKey(candidate) === name)
      const canonical =
        sameName.find((c) => c.source.type === 'local') ??
        sameName.find((c) => c.source.type === 'project' && c.source.id === projectId) ??
        sameName.find((c) => c.source.type === 'project') ??
        sameName.find((c) => c.source.type === 'platform') ??
        sameName[0]

      if (!canonical) continue
      await assignmentService.assignToProject(canonical, resourceType, projectId, true)
    }
  }
}

/** Server names declared in a platform's mcp.json (empty when missing or invalid). */
async function readMcpServerNames(platform: PlatformConfig): Promise<string[]> {
  const adapter = getAdapter(platform.id)
  if (!adapter) return []
  const configPath = adapter.getPlatformPaths(platform.rootPath).mcpConfigPath
  if (!existsSync(configPath)) return []
  try {
    const raw = await fileService.readText(configPath)
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    return Object.keys(parsed.mcpServers ?? {})
  } catch {
    return []
  }
}

/**
 * Keep settings.mcpEnabled in sync when IDE/CLIs are toggled: enabling an IDE/CLI enables
 * every MCP it declares; disabling one disables its MCPs unless another enabled IDE/CLI
 * still declares the same server name.
 */
export async function applyMcpEnableCascade(
  previousPlatforms: PlatformConfig[],
  nextPlatforms: PlatformConfig[],
  current: Record<string, boolean>
): Promise<Record<string, boolean>> {
  const flipped = nextPlatforms.filter((p) => {
    const prev = previousPlatforms.find((q) => q.id === p.id)
    return prev !== undefined && prev.enabled !== p.enabled
  })
  if (flipped.length === 0) return current

  const namesByPlatform = new Map<string, string[]>()
  const namesFor = async (platform: PlatformConfig): Promise<string[]> => {
    let names = namesByPlatform.get(platform.id)
    if (!names) {
      names = await readMcpServerNames(platform)
      namesByPlatform.set(platform.id, names)
    }
    return names
  }

  const result = { ...current }
  for (const platform of flipped) {
    const names = await namesFor(platform)
    if (platform.enabled) {
      for (const name of names) result[name] = true
      continue
    }
    for (const name of names) {
      let stillDefined = false
      for (const other of nextPlatforms) {
        if (!other.enabled || other.id === platform.id) continue
        if ((await namesFor(other)).includes(name)) {
          stillDefined = true
          break
        }
      }
      if (!stillDefined) result[name] = false
    }
  }
  return result
}

/**
 * Disable cascade: delete the project-level folders of platforms that were just
 * unselected in Settings. Uses each platform's previous projectDirName (the
 * folder actually on disk); names still claimed by an enabled platform are
 * skipped by the cleanup service.
 */
export async function removeUnselectedPlatformFolders(
  previousPlatforms: PlatformConfig[],
  nextPlatforms: PlatformConfig[]
): Promise<void> {
  const turnedOff = previousPlatforms.filter((p) => {
    if (!p.enabled) return false
    const next = nextPlatforms.find((q) => q.id === p.id)
    return next === undefined || !next.enabled
  })
  if (turnedOff.length === 0) return

  const result = await platformCleanupService.purgeUnselectedFromProjects(turnedOff)
  if (result.errors.length > 0) {
    throw new Error(`Failed to remove unselected IDE project folders: ${result.errors.join('; ')}`)
  }
}

export const platformSyncService = {
  syncEnabledPlatformsToProjects,
  removeUnselectedPlatformFolders
}

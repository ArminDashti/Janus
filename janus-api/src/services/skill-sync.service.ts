import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { getSkillsStorePath } from '../app-paths'
import { skillContentHash } from '../shared/utils'
import { getAdapter } from '../platforms'
import { fileService } from './file.service'
import { settingsStore } from './settings-store'

const syncingRoots = new Set<string>()
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Previous hash captured at first change in a debounce window (per skill root). */
const pendingPreviousHash = new Map<string, string | undefined>()
/** Last-known SKILL.md hash per skill root (normalized path). */
const contentHashByRoot = new Map<string, string>()
let paused = false

function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, '/').toLowerCase()
}

function isUnderSyncingRoot(changedPath: string): boolean {
  const n = normalizePath(changedPath)
  for (const root of syncingRoots) {
    if (n === root || n.startsWith(`${root}/`)) return true
  }
  return false
}

async function hashSkillRoot(skillRoot: string): Promise<string | null> {
  const skillMd = join(skillRoot, 'SKILL.md')
  if (!existsSync(skillMd)) return null
  const text = await fileService.readText(skillMd)
  return skillContentHash(text)
}

/** Seed / refresh hash cache from a scan so fan-out can detect pre-edit clones. */
export function seedSkillContentHashes(
  skills: Array<{ rootPath: string; contentHash: string }>
): void {
  for (const skill of skills) {
    contentHashByRoot.set(normalizePath(skill.rootPath), skill.contentHash)
  }
}

/** Pause fan-out during in-app rename/delete so mid-move events do not sync ghosts. */
export function pauseSkillSync(): void {
  paused = true
  for (const timer of pendingTimers.values()) clearTimeout(timer)
  pendingTimers.clear()
  pendingPreviousHash.clear()
}

export function resumeSkillSync(): void {
  paused = false
}

export async function withSkillSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  pauseSkillSync()
  try {
    return await fn()
  } finally {
    resumeSkillSync()
  }
}

/** Every skills dir holding copies of a skill: Janus store, platform global, and project dirs. */
function allSkillsDirs(): string[] {
  const settings = settingsStore.get()
  const dirs = [getSkillsStorePath()]
  for (const platform of settings.platforms) {
    if (!platform.enabled) continue
    const adapter = getAdapter(platform.id)
    if (!adapter) continue
    // Mirrors scanner.service: Cursor global skills live only in ~/.cursor/skills.
    const globalDirs =
      platform.id === 'cursor'
        ? [join(platform.rootPath, 'skills')]
        : adapter.getPlatformPaths(platform.rootPath).skillsDirs
    dirs.push(...globalDirs)
  }
  for (const root of settings.projectRoots) {
    for (const project of root.projects) {
      for (const platform of settings.platforms) {
        if (!platform.enabled) continue
        const adapter = getAdapter(platform.id)
        if (!adapter) continue
        dirs.push(...adapter.getProjectPaths(project.path, platform.projectDirName).skillsDirs)
      }
    }
  }
  return dirs
}

export function resolveSkillFromPath(
  changedPath: string
): { skillName: string; sourceRoot: string } | null {
  const abs = resolve(changedPath)
  const normalizedAbs = normalizePath(abs)

  for (const skillsDir of allSkillsDirs()) {
    const skillsDirResolved = resolve(skillsDir)
    const skillsDirNorm = normalizePath(skillsDirResolved)
    if (normalizedAbs !== skillsDirNorm && !normalizedAbs.startsWith(`${skillsDirNorm}/`)) {
      continue
    }

    const skillRoot = findNearestSkillRoot(abs, skillsDirResolved)
    if (!skillRoot) continue

    const skillName = skillRoot.slice(skillsDirResolved.length).replace(/^[/\\]+/, '')
    if (!skillName) continue
    return { skillName, sourceRoot: skillRoot }
  }
  return null
}

/** Walk up from a path until a directory containing SKILL.md is found (within skillsDir). */
function findNearestSkillRoot(changedPath: string, skillsDir: string): string | null {
  const skillsDirNorm = normalizePath(skillsDir)
  let current = existsSync(join(changedPath, 'SKILL.md'))
    ? resolve(changedPath)
    : dirname(resolve(changedPath))

  while (true) {
    const currentNorm = normalizePath(current)
    if (currentNorm === skillsDirNorm || !currentNorm.startsWith(`${skillsDirNorm}/`)) {
      return null
    }
    if (existsSync(join(current, 'SKILL.md'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** Every existing same-name copy in other projects/platforms (all copies follow the source). */
async function collectCloneSkillRoots(skillName: string, sourceRoot: string): Promise<string[]> {
  const sourceNorm = normalizePath(sourceRoot)
  const destRoots: string[] = []

  for (const skillsDir of allSkillsDirs()) {
    const dest = join(skillsDir, ...skillName.split(/[/\\]/).filter(Boolean))
    if (!existsSync(join(dest, 'SKILL.md'))) continue
    if (normalizePath(dest) === sourceNorm) continue
    if (destRoots.some((d) => normalizePath(d) === normalizePath(dest))) continue
    destRoots.push(dest)
  }

  return destRoots
}

/** Fan out a saved skill to same-name clones still on `previousHash`. Called directly by the save route. */
export async function syncSkillFromResolved(
  skillName: string,
  sourceRoot: string,
  previousHash: string | undefined
): Promise<void> {
  if (paused) return
  if (!existsSync(join(sourceRoot, 'SKILL.md'))) return

  const sourceNorm = normalizePath(sourceRoot)
  const newHash = await hashSkillRoot(sourceRoot)
  if (!newHash) return

  if (previousHash === newHash) {
    contentHashByRoot.set(sourceNorm, newHash)
    return
  }

  const destRoots = await collectCloneSkillRoots(skillName, sourceRoot)
  if (destRoots.length === 0) {
    contentHashByRoot.set(sourceNorm, newHash)
    return
  }

  const norms = destRoots.map((d) => normalizePath(d))
  for (const n of norms) syncingRoots.add(n)

  try {
    for (const dest of destRoots) {
      await fileService.removePath(dest)
      await fileService.copyDirectory(sourceRoot, dest)
      contentHashByRoot.set(normalizePath(dest), newHash)
    }
    contentHashByRoot.set(sourceNorm, newHash)
  } finally {
    setTimeout(() => {
      for (const n of norms) syncingRoots.delete(n)
    }, 2500)
  }
}

/** Debounced fan-out: copy changed skill only to same-name peers that still match the previous hash. */
export function scheduleSkillSyncFromPath(changedPath: string): void {
  if (paused) return
  if (isUnderSyncingRoot(changedPath)) return

  const resolved = resolveSkillFromPath(changedPath)
  if (!resolved) return

  const key = normalizePath(resolved.sourceRoot)
  // Keep the first pre-edit hash for this debounce window (ignore mid-window scan updates).
  if (!pendingPreviousHash.has(key)) {
    pendingPreviousHash.set(key, contentHashByRoot.get(key))
  }
  const previousHash = pendingPreviousHash.get(key)
  const existing = pendingTimers.get(key)
  if (existing) clearTimeout(existing)

  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key)
      pendingPreviousHash.delete(key)
      void syncSkillFromResolved(resolved.skillName, resolved.sourceRoot, previousHash)
    }, 800)
  )
}

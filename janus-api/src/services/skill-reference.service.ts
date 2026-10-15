import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import { getDataPath } from '../app-paths'
import { getAdapter } from '../platforms'
import { fileService } from './file.service'
import { settingsStore } from './settings-store'

// Janus-owned copies of skills that live in imported projects:
// <dataPath>/repo-bank/references/<projectId>/<skillName>/
const DEBOUNCE_MS = 300

interface SkillSource {
  projectId: string
  skillName: string
  sourceRoot: string
}

let timer: ReturnType<typeof setTimeout> | null = null
let pendingFull = true
const pendingPaths = new Set<string>()
// Serialize runs so overlapping triggers never copy into the same folder at once.
let chain: Promise<void> = Promise.resolve()

function getReferencesRoot(): string {
  return join(getDataPath(settingsStore.get().dataPath), 'repo-bank', 'references')
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Skills (direct children of each enabled platform's skills dir) for every imported project. */
async function collectSkillSources(): Promise<SkillSource[]> {
  const settings = settingsStore.get()
  const sources: SkillSource[] = []

  for (const root of settings.projectRoots) {
    for (const project of root.projects) {
      const seen = new Set<string>()
      for (const platform of settings.platforms) {
        if (!platform.enabled) continue
        const adapter = getAdapter(platform.id)
        if (!adapter) continue
        const { skillsDirs } = adapter.getProjectPaths(project.path, platform.projectDirName)
        for (const skillsDir of skillsDirs) {
          for (const dir of await fileService.listDirectories(skillsDir)) {
            const skillName = basename(dir)
            if (seen.has(skillName) || !existsSync(join(dir, 'SKILL.md'))) continue
            seen.add(skillName)
            sources.push({ projectId: project.id, skillName, sourceRoot: dir })
          }
        }
      }
    }
  }
  return sources
}

/** changed = null copies every skill; otherwise only skills whose folder contains a changed path. */
async function runSync(changed: string[] | null): Promise<void> {
  const root = getReferencesRoot()
  const sources = await collectSkillSources()

  const keep = new Set<string>()
  for (const s of sources) {
    const dest = join(root, s.projectId, s.skillName)
    keep.add(resolve(dest))
    if (changed && !changed.some((p) => isWithin(resolve(p), resolve(s.sourceRoot)))) continue
    // ponytail: copies the whole skill folder on each change; upgrade to per-file copy if skills grow large.
    await fileService.removePath(dest)
    await fileService.copyDirectory(s.sourceRoot, dest)
  }

  // Drop references whose skill or project no longer exists in Janus.
  for (const projectDir of await fileService.listDirectories(root)) {
    for (const skillDir of await fileService.listDirectories(projectDir)) {
      if (!keep.has(resolve(skillDir))) await fileService.removePath(skillDir)
    }
    if ((await fileService.listEntries(projectDir)).length === 0) {
      await rm(projectDir, { recursive: true, force: true })
    }
  }
}

/** Reconcile references: full copy when changed is null, otherwise only the touched skills. */
export function syncSkillReferences(changed: string[] | null = null): Promise<void> {
  chain = chain.then(() => runSync(changed), () => runSync(changed))
  return chain
}

/** Debounced reconcile. Pass the changed path for file events; omit it for a full reconcile. */
export function scheduleSkillReferenceSync(changedPath?: string): void {
  if (changedPath) pendingPaths.add(changedPath)
  else pendingFull = true

  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const full = pendingFull
    const paths = [...pendingPaths]
    pendingFull = false
    pendingPaths.clear()
    syncSkillReferences(full ? null : paths).catch((err) =>
      console.error('skill references sync failed:', err)
    )
  }, DEBOUNCE_MS)
}

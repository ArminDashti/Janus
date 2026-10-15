import { watch } from 'chokidar'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ProjectInfo } from '../shared/types'
import { importedProjectsStore } from './imported-projects-store'
import { normalizeScanPath, rescanProjectRoots } from './project-root-rescan.service'
import { settingsStore } from './settings-store'
import { getAdapter } from '../platforms'
import { scheduleSkillSyncFromPath } from './skill-sync.service'
import { scheduleSkillReferenceSync } from './skill-reference.service'
import { notifyScanChanged } from '../events'

let watcher: ReturnType<typeof watch> | null = null
let rootsWatcher: ReturnType<typeof watch> | null = null
let changeNotifyTimer: ReturnType<typeof setTimeout> | null = null
let unlinkNotifyTimer: ReturnType<typeof setTimeout> | null = null
let rootsScanTimer: ReturnType<typeof setTimeout> | null = null
let quietDepth = 0

const CHANGE_DEBOUNCE_MS = 400
const UNLINK_DEBOUNCE_MS = 75
const ROOTS_SCAN_DEBOUNCE_MS = 1500

type ProjectRootsAddedListener = (added: ProjectInfo[]) => void

const rootsAddedListeners = new Set<ProjectRootsAddedListener>()

/** Fired when a scan-root re-walk loads new `.git` projects at runtime. */
export function onProjectRootsAdded(listener: ProjectRootsAddedListener): () => void {
  rootsAddedListeners.add(listener)
  return () => {
    rootsAddedListeners.delete(listener)
  }
}

function collectWatchPaths(): string[] {
  const settings = settingsStore.get()
  const paths = new Set<string>()

  for (const platform of settings.platforms) {
    if (!platform.enabled) continue
    const adapter = getAdapter(platform.id)
    if (!adapter) continue

    const platformPaths = adapter.getPlatformPaths(platform.rootPath)
    const candidates = [join(platform.rootPath, 'mcp.json')]

    for (const p of candidates) {
      if (p && existsSync(p)) paths.add(p)
    }
  }

  for (const root of settings.projectRoots) {
    for (const project of root.projects) {
      // Only the resource folders (skills/, agents/) and mcp configs are watched;
      // whole-repo trees would flood chokidar handles. New repos under a scan
      // root are picked up by the rootsWatcher in startFileWatcher().
      for (const platform of settings.platforms) {
        if (!platform.enabled) continue
        const adapter = getAdapter(platform.id)
        if (!adapter) continue
        const projectPaths = adapter.getProjectPaths(project.path, platform.projectDirName)

        if (platform.id === 'cursor') {
          const candidates = [...projectPaths.skillsDirs, projectPaths.agentsDir]
          for (const p of candidates) {
            if (p && existsSync(p)) paths.add(p)
          }
        } else {
          for (const skillsDir of projectPaths.skillsDirs) {
            if (existsSync(skillsDir)) paths.add(skillsDir)
          }
          if (existsSync(projectPaths.mcpConfigPath)) paths.add(projectPaths.mcpConfigPath)
        }
      }
    }
  }

  return [...paths]
}

function collectRootScanPaths(): string[] {
  const paths = new Set<string>()
  for (const root of settingsStore.get().projectRoots) {
    if (!root.scanPath) continue
    const trimmed = root.scanPath.replace(/[\\/]+$/, '')
    if (trimmed && existsSync(trimmed)) paths.add(trimmed)
  }
  return [...paths]
}

function scheduleRootsRescan(): void {
  if (quietDepth > 0) return
  if (rootsScanTimer) clearTimeout(rootsScanTimer)
  rootsScanTimer = setTimeout(() => {
    rootsScanTimer = null
    if (quietDepth > 0) return
    void rescanProjectRoots().then((added) => {
      if (quietDepth > 0 || added.length === 0) return
      for (const listener of rootsAddedListeners) {
        try {
          listener(added)
        } catch {
          rootsAddedListeners.delete(listener)
        }
      }
      stopFileWatcher()
      startFileWatcher()
      emitScanChanged()
    })
  }, ROOTS_SCAN_DEBOUNCE_MS)
}

function emitScanChanged(): void {
  notifyScanChanged()
}

function notifyChange(): void {
  if (quietDepth > 0) return
  if (changeNotifyTimer) clearTimeout(changeNotifyTimer)
  changeNotifyTimer = setTimeout(() => {
    changeNotifyTimer = null
    if (quietDepth > 0) return
    emitScanChanged()
  }, CHANGE_DEBOUNCE_MS)
}

function notifyUnlink(): void {
  if (quietDepth > 0) return
  if (unlinkNotifyTimer) clearTimeout(unlinkNotifyTimer)
  unlinkNotifyTimer = setTimeout(() => {
    unlinkNotifyTimer = null
    if (quietDepth > 0) return
    const removed = importedProjectsStore.pruneMissingOnDisk()
    if (removed.length > 0) {
      stopFileWatcher()
      startFileWatcher()
    }
    emitScanChanged()
  }, UNLINK_DEBOUNCE_MS)
}

export function beginQuietWatch(): void {
  quietDepth++
}

export function endQuietWatch(): void {
  quietDepth = Math.max(0, quietDepth - 1)
}

export async function withQuietWatch<T>(fn: () => Promise<T>): Promise<T> {
  beginQuietWatch()
  try {
    return await fn()
  } finally {
    endQuietWatch()
  }
}

export function startFileWatcher(): void {
  if (!watcher) {
    const paths = collectWatchPaths()
    if (paths.length > 0) {
      watcher = watch(paths, {
        ignoreInitial: true,
        depth: 12,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
      })

      const onAddOrChange = (changedPath: string): void => {
        scheduleSkillSyncFromPath(changedPath)
        scheduleSkillReferenceSync(changedPath)
        notifyChange()
      }

      const onUnlink = (removedPath: string): void => {
        scheduleSkillReferenceSync(removedPath)
        notifyUnlink()
      }

      watcher
        .on('add', onAddOrChange)
        .on('addDir', onAddOrChange)
        .on('change', onAddOrChange)
        .on('unlink', onUnlink)
        .on('unlinkDir', onUnlink)
    }
  }

  // Repos appearing under (or vanishing from) a browsed scan root must be
  // picked up automatically; depth 2 sees `<repo>` and `<repo>/.git` events.
  if (!rootsWatcher) {
    const rootPaths = collectRootScanPaths()
    if (rootPaths.length > 0) {
      rootsWatcher = watch(rootPaths, { ignoreInitial: true, depth: 2 })
      // Every directory event (re)starts the debounce; a clone keeps firing
      // until `.git` is fully written, so the rescan runs on a settled repo.
      rootsWatcher.on('addDir', () => scheduleRootsRescan())
      rootsWatcher.on('unlinkDir', () => scheduleRootsRescan())
    }
  }

  // Every (re)start reconciles references: covers boot, project add/remove, settings changes.
  scheduleSkillReferenceSync()
}

export function stopFileWatcher(): void {
  if (changeNotifyTimer) {
    clearTimeout(changeNotifyTimer)
    changeNotifyTimer = null
  }
  if (unlinkNotifyTimer) {
    clearTimeout(unlinkNotifyTimer)
    unlinkNotifyTimer = null
  }
  if (rootsScanTimer) {
    clearTimeout(rootsScanTimer)
    rootsScanTimer = null
  }
  void watcher?.close()
  watcher = null
  void rootsWatcher?.close()
  rootsWatcher = null
}

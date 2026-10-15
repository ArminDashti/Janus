import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

let appRoot: string | null = null

function packageRoot(): string {
  // src/app-paths.ts -> repo root (dev) or dist/ -> repo root (built)
  const here = dirname(fileURLToPath(import.meta.url))
  const candidate = join(here, '..')
  if (existsSync(join(candidate, 'package.json'))) return candidate
  const up = join(here, '..', '..')
  if (existsSync(join(up, 'package.json'))) return up
  return process.cwd()
}

export function getAppRoot(): string {
  if (appRoot) return appRoot
  appRoot = process.env.JANUS_APP_ROOT?.trim() || packageRoot()
  return appRoot
}

export function resolveFromAppRoot(...segments: string[]): string {
  return join(getAppRoot(), ...segments)
}

function getBundledResourceDir(name: string): string {
  return join(getAppRoot(), 'resources', name)
}

export function getBundledLogosPath(): string {
  return getBundledResourceDir('logos')
}

export function getBundledBrandingPath(): string {
  return getBundledResourceDir('branding')
}

function getUserDataRoot(): string {
  const programData =
    process.env.ProgramData || process.env.PROGRAMDATA || join(getAppRoot(), 'data')
  return join(programData, 'Janus', 'JanusApi')
}

function migrateLegacyDataDir(root: string): void {
  const legacy = join(root, 'data')
  const target = getUserDataRoot()
  if (!existsSync(legacy)) return

  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(legacy, { withFileTypes: true })) {
    const src = join(legacy, entry.name)
    const dest = join(target, entry.name)
    if (!existsSync(dest)) {
      cpSync(src, dest, { recursive: true })
    }
  }
  rmSync(legacy, { recursive: true, force: true })
}

function cleanupLegacyPortableDirs(root: string): void {
  for (const dir of ['mcps', 'logos', 'data']) {
    const full = join(root, dir)
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true })
    }
  }
}

export function ensurePortableLayout(): void {
  const root = getAppRoot()

  migrateLegacyDataDir(root)
  cleanupLegacyPortableDirs(root)

  const dirs = ['.trash', '.trash/skills', '.trash/subAgents', 'Skills']

  for (const dir of dirs) {
    const full = join(root, dir)
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true })
    }
  }

  const userDataDirs = ['repo-bank']
  const dataRoot = getUserDataRoot()
  for (const dir of userDataDirs) {
    const full = join(dataRoot, dir)
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true })
    }
  }

  const importedPath = join(root, 'imported-projects.json')
  if (!existsSync(importedPath)) {
    writeFileSync(importedPath, `${JSON.stringify({ projectRoots: [] }, null, 2)}\n`, 'utf-8')
  }

  const legacyCategories = join(root, 'categories.json')
  if (existsSync(legacyCategories)) {
    try {
      rmSync(legacyCategories, { force: true })
    } catch {
      // ignore
    }
  }

  // Seed settings.json from template if missing
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) {
    const template = join(root, 'resources', 'settings.template.json')
    if (existsSync(template)) {
      cpSync(template, settingsPath)
    }
  }
}

export function getDataPath(settingsDataPath = './data'): string {
  const normalized = settingsDataPath.replace(/^\.\//, '')
  if (normalized === 'data') {
    return getUserDataRoot()
  }
  return resolveFromAppRoot(normalized)
}

export function getLogosPath(): string {
  return getBundledLogosPath()
}

export function getBrandingPath(): string {
  return getBundledBrandingPath()
}

export function getSettingsPath(): string {
  return resolveFromAppRoot('settings.json')
}

/** Janus-owned master copy of every skill (%LOCALAPPDATA%\Janus\Skills in an install). */
export function getSkillsStorePath(): string {
  return resolveFromAppRoot('Skills')
}

export function getImportedProjectsPath(): string {
  return resolveFromAppRoot('imported-projects.json')
}

export function getTrashPath(...segments: string[]): string {
  return resolveFromAppRoot('.trash', ...segments)
}


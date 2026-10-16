import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

/** Run tasks with at most `limit` in flight (I/O-bound copies; keeps Windows handles bounded). */
export async function runLimited(tasks: Array<() => Promise<void>>, limit = 8): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) await tasks[next++]()
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

export {
  isMarkdownFile,
  parseFrontmatter,
  skillGroupKey,
  parseSkillGroupKey,
  skillFolderNameFromKey
} from './utils.browser'

export {
  extractResourceMeta,
  ensureResourceMeta,
  formatMetaTimestamp,
  metaTimestampToIso,
  newResourceUuid,
  skillTemplate,
  subAgentTemplate,
  upsertMarkdownMeta,
  serializeMetadataBlock,
  validateSkillStructure,
  validateSubAgentStructure,
  isCompleteResourceMeta,
  type ResourceMeta
} from './resource-meta'

/** True when a path is under the Windows LocalSystem profile (service account). */
export function isSystemProfilePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/systemprofile/') || normalized.includes('/system32/config/systemprofile')
}

function readInstallUserHome(): string | null {
  const envHome = process.env.JANUS_USER_HOME?.trim()
  if (envHome && existsSync(envHome) && !isSystemProfilePath(envHome)) {
    return envHome
  }

  const appRoot = process.env.JANUS_APP_ROOT?.trim()
  const candidates = [
    appRoot ? join(dirname(appRoot), 'install-config.json') : null,
    join('C:\\Program Files\\Janus', 'install-config.json')
  ].filter((p): p is string => Boolean(p))

  for (const configPath of candidates) {
    if (!existsSync(configPath)) continue
    try {
      const raw = readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '')
      const parsed = JSON.parse(raw) as { userHome?: string }
      const userHome = parsed.userHome?.trim()
      if (userHome && existsSync(userHome) && !isSystemProfilePath(userHome)) {
        return userHome
      }
    } catch {
      // ignore invalid install-config
    }
  }

  return null
}

/**
 * Home directory for expanding ~/.cursor etc.
 * Prefer JANUS_USER_HOME / install-config when the process runs as LocalSystem,
 * so platform roots are never the empty systemprofile tree.
 */
export function resolveEffectiveHome(): string {
  const installed = readInstallUserHome()
  if (installed) return installed

  const osHome = homedir()
  if (!isSystemProfilePath(osHome)) return osHome

  return osHome
}

export function expandHome(input: string): string {
  const home = resolveEffectiveHome()
  if (input.startsWith('~/')) {
    return join(home, input.slice(2))
  }
  if (input === '~') {
    return home
  }
  return input
}

export function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

/** Full sha256 hex of SKILL.md text (identity for same-name skill variants). */
export function skillContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? path
}

import { existsSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type {
  AppSettings,
  PlatformId,
  ProjectInfo,
  ProjectMatrixRow,
  ResourceGroupSummary,
  ResourceType,
  ScanResult,
  SkillResource,
  SubAgentResource
} from '../shared/types'
import { CURSOR_ONLY_RESOURCES, GLOBAL_TARGET_KEY } from '../shared/types'
import { isValidResourceName } from '../shared/resource-names'
import {
  parseFrontmatter,
  parseSkillGroupKey,
  skillContentHash,
  skillFolderNameFromKey,
  skillTemplate,
  subAgentTemplate
} from '../shared/utils'
import { fileService, type TrashResourceKind } from './file.service'
import { assignmentService } from './assignment.service'
import { scannerService } from './scanner.service'
import { settingsStore } from './settings-store'
import { repoBankService } from './repo-bank.service'
import { withQuietWatch } from './watcher.service'
import { withSkillSyncPaused } from './skill-sync.service'
import { getAdapter } from '../platforms'
import { agentDebugLog } from './debug-log'
import type { PlatformPaths } from '../platforms/types'

type ScannedResource = SkillResource | SubAgentResource

const ASSIGNMENT_KEY: Record<
  Exclude<ResourceType, 'mcp'>,
  keyof AppSettings['assignments']
> = {
  skill: 'skills',
  subAgent: 'subAgents'
}

const MANDATORY_KEY: Record<
  Exclude<ResourceType, 'mcp'>,
  keyof AppSettings['mandatoryForAllProjects']
> = {
  skill: 'skills',
  subAgent: 'subAgents'
}

function getItems(scan: ScanResult, resourceType: ResourceType): ScannedResource[] {
  switch (resourceType) {
    case 'skill':
      return scan.skills
    case 'subAgent':
      return scan.subAgents
    default:
      return []
  }
}

function isCursorInstance(item: ScannedResource): boolean {
  return item.source.label.includes('Cursor') || item.source.id === 'cursor'
}

function filterItems(items: ScannedResource[], resourceType: ResourceType): ScannedResource[] {
  if (CURSOR_ONLY_RESOURCES.includes(resourceType)) {
    return items.filter(isCursorInstance)
  }
  return items
}

function itemUuid(item: ScannedResource): string {
  if ('uuid' in item && typeof item.uuid === 'string' && item.uuid) return item.uuid
  return item.id
}

function itemLastUpdated(item: ScannedResource): string | null {
  if ('lastUpdatedAt' in item) return (item as { lastUpdatedAt?: string | null }).lastUpdatedAt ?? null
  return null
}

/** Skill identity is the folder name, never metadata UUID or the category path. */
function skillNameKey(name: string): string {
  const folder = skillFolderNameFromKey(name).replace(/\\/g, '/')
  return folder.split('/').filter(Boolean).pop() ?? folder
}

function groupKey(item: ScannedResource, resourceType: ResourceType): string {
  if (resourceType === 'skill') return skillNameKey(item.name)
  return itemUuid(item)
}

function matchesResourceName(
  item: ScannedResource,
  resourceType: ResourceType,
  resourceName: string
): boolean {
  if (resourceType === 'skill') {
    return skillNameKey((item as SkillResource).name) === skillNameKey(resourceName)
  }
  if (itemUuid(item) === resourceName) return true
  return item.name === resourceName
}

function groupByName(
  items: ScannedResource[],
  resourceType: ResourceType
): Map<string, ScannedResource[]> {
  const map = new Map<string, ScannedResource[]>()
  for (const item of items) {
    const key = groupKey(item, resourceType)
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

function pickCanonical(instances: ScannedResource[]): ScannedResource {
  const project = instances.find((i) => i.source.type === 'project')
  if (project) return project
  const local = instances.find((i) => i.source.type === 'local')
  return local ?? instances[0]
}

function collectAssignedProjectIds(instances: ScannedResource[]): string[] {
  const projectIds = new Set<string>()
  for (const item of instances) {
    if (item.source.type === 'project') {
      projectIds.add(item.source.id)
    }
  }
  return [...projectIds]
}

function countProjectsUsing(instances: ScannedResource[]): number {
  const projectIds = new Set<string>()
  for (const item of instances) {
    if (item.source.type === 'project') {
      projectIds.add(item.source.id)
    }
  }
  return projectIds.size
}

function isInGlobal(instances: ScannedResource[]): boolean {
  return instances.some((i) => {
    if (i.source.type !== 'platform' || i.source.id !== 'cursor') return false
    // Skills: only ~/.cursor/skills counts as Global (not skills-cursor)
    if ('skillMdPath' in i) {
      const root = String((i as SkillResource).rootPath ?? '').replace(/\\/g, '/')
      return /\/\.cursor\/skills(\/|$)/i.test(root)
    }
    return true
  })
}

function getAllProjects(settings: AppSettings) {
  return settings.projectRoots.flatMap((r) => r.projects)
}

function trashKind(resourceType: Exclude<ResourceType, 'mcp'>): TrashResourceKind {
  switch (resourceType) {
    case 'skill':
      return 'skills'
    case 'subAgent':
      return 'subAgents'
  }
}

async function withInAppFsOp<T>(fn: () => Promise<T>): Promise<T> {
  return withQuietWatch(() => withSkillSyncPaused(fn))
}

function* iterateProjectPlatformPaths(settings: AppSettings): Generator<{
  project: ProjectInfo
  paths: PlatformPaths
  platformId: string
}> {
  for (const project of getAllProjects(settings)) {
    for (const platform of settings.platforms) {
      if (!platform.enabled) continue
      const adapter = getAdapter(platform.id)
      if (!adapter) continue
      yield {
        project,
        paths: adapter.getProjectPaths(project.path, platform.projectDirName),
        platformId: platform.id
      }
    }
  }
}

async function estimateTokens(item: ScannedResource, resourceType: ResourceType): Promise<number> {
  let path: string | undefined
  switch (resourceType) {
    case 'skill': {
      const s = item as SkillResource
      path = s.skillMdPath
      break
    }
    case 'subAgent':
      path = (item as SubAgentResource).filePath
      break
    default:
      return 0
  }
  if (!path || !existsSync(path)) return 0
  try {
    const text = await fileService.readText(path)
    return Math.ceil(text.length / 4)
  } catch {
    return 0
  }
}

async function getLastUpdated(item: ScannedResource, resourceType: ResourceType): Promise<string | null> {
  let path: string
  switch (resourceType) {
    case 'skill':
      path = (item as SkillResource).rootPath
      break
    case 'subAgent':
      path = (item as SubAgentResource).filePath
      break
    default:
      return null
  }
  try {
    const mtime = await fileService.getMtime(path)
    return mtime ? new Date(mtime).toISOString() : null
  } catch {
    return null
  }
}

/** Frontmatter fields surfaced on list summaries for search (item 14). */
interface ExtractedMeta {
  description: string
  tags: string[] | undefined
  /** Only set when the file actually declares a category — never invented. */
  category: string | undefined
}

async function extractDescription(
  item: ScannedResource,
  resourceType: ResourceType
): Promise<ExtractedMeta> {
  const empty: ExtractedMeta = { description: '', tags: undefined, category: undefined }
  let path: string | undefined
  if (resourceType === 'skill') {
    path = (item as SkillResource).skillMdPath
  } else if (resourceType === 'subAgent') {
    path = (item as SubAgentResource).filePath
  } else {
    return empty
  }
  if (!path || !existsSync(path)) return empty
  try {
    const text = await fileService.readText(path)
    const { frontmatter } = parseFrontmatter(text)
    const description = String(frontmatter.description ?? '').trim()

    const nested =
      frontmatter.metadata && typeof frontmatter.metadata === 'object'
        ? (frontmatter.metadata as Record<string, unknown>)
        : frontmatter

    const rawTags = nested.tags
    let tags: string[] | undefined
    if (Array.isArray(rawTags)) {
      const list = rawTags.map((t) => String(t).trim()).filter(Boolean)
      if (list.length > 0) tags = list
    } else if (typeof rawTags === 'string' && rawTags.trim()) {
      // "[a, b]" or comma list in a scalar field
      tags = rawTags
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      if (tags.length === 0) tags = undefined
    }

    const rawCategory = nested.category ?? frontmatter.category
    const category =
      rawCategory == null ? undefined : String(rawCategory).trim() || undefined

    return { description, tags, category }
  } catch {
    return empty
  }
}

export class ResourceService {
  async getGroupSummaries(
    scan: ScanResult,
    settings: AppSettings,
    resourceType: Exclude<ResourceType, 'mcp'>
  ): Promise<ResourceGroupSummary[]> {
    // #region agent log
    const startedAt = Date.now()
    // #endregion
    const items = filterItems(getItems(scan, resourceType), resourceType)
    const grouped = groupByName(items, resourceType)
    const totalProjects = getAllProjects(settings).length
    const mandatoryKey = MANDATORY_KEY[resourceType]
    const mandatoryMap = settings.mandatoryForAllProjects?.[mandatoryKey] ?? {}

    const summaries: ResourceGroupSummary[] = []

    for (const [key, instances] of grouped) {
      const canonical = pickCanonical(instances)
      const displayName = canonical.name
      const [tokens, meta] = await Promise.all([
        estimateTokens(canonical, resourceType),
        extractDescription(canonical, resourceType)
      ])

      const lastUpdatedAt =
        instances
          .map((i) => itemLastUpdated(i))
          .filter((m): m is string => m !== null)
          .sort()
          .pop() ?? null

      const mandatoryRecord = mandatoryMap as Record<string, boolean>
      const mandatory =
        mandatoryRecord[key] ??
        mandatoryRecord[displayName] ??
        mandatoryRecord[itemUuid(canonical)] ??
        false

      const structureOk = instances.every((i) =>
        'structureOk' in i ? (i as { structureOk?: boolean }).structureOk !== false : true
      )
      const structureWarning = structureOk
        ? undefined
        : instances
            .map((i) => ('structureWarning' in i ? (i as { structureWarning?: string }).structureWarning : undefined))
            .find((w): w is string => Boolean(w))

      summaries.push({
        name: displayName,
        groupKey: key,
        contentHash:
          resourceType === 'skill' ? (canonical as SkillResource).contentHash : undefined,
        usedProjectCount: countProjectsUsing(instances),
        totalProjectCount: totalProjects,
        assignedProjectIds: collectAssignedProjectIds(instances),
        inGlobal: isInGlobal(instances),
        tokenEstimate: tokens,
        lastUpdatedAt,
        mandatory,
        canonicalId: canonical.id,
        description: meta.description,
        tags: meta.tags,
        category: meta.category,
        structureOk,
        structureWarning
      })
    }

    const sorted = summaries.sort((a, b) => a.name.localeCompare(b.name))
    // #region agent log
    const sourceCounts = { project: 0, local: 0, platform: 0, other: 0 }
    for (const item of items) {
      const t = item.source?.type
      if (t === 'project') sourceCounts.project++
      else if (t === 'local') sourceCounts.local++
      else if (t === 'platform') sourceCounts.platform++
      else sourceCounts.other++
    }
    agentDebugLog('A', 'resource.service.ts:getGroupSummaries', 'summaries built', {
      resourceType,
      groupCount: grouped.size,
      itemCount: items.length,
      summaryCount: sorted.length,
      sourceCounts,
      firstNames: sorted.slice(0, 5).map((s) => s.name),
      lastNames: sorted.slice(-5).map((s) => s.name),
      durationMs: Date.now() - startedAt,
      runId: 'post-fix'
    })
    // #endregion
    return sorted
  }

  getProjectMatrix(
    scan: ScanResult,
    settings: AppSettings,
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string
  ): ProjectMatrixRow[] {
    const items = filterItems(getItems(scan, resourceType), resourceType)
    const instances = items.filter((i) => matchesResourceName(i, resourceType, resourceName))
    const assignedProjectIds = new Set(
      instances.filter((i) => i.source.type === 'project').map((i) => i.source.id)
    )

    // IDE/CLI global rows (Skills only): one per platform enabled in Settings; ON when
    // the resource exists in that platform's global folder.
    const platformRows: ProjectMatrixRow[] =
      resourceType === 'skill'
        ? settings.platforms.flatMap((p) => {
            if (!p.enabled) return []
            const adapter = getAdapter(p.id)
            if (!adapter) return []
            return [
              {
                projectId: `platform:${p.id}`,
                projectName: `${adapter.label} (Global)`,
                assigned: instances.some(
                  (i) => i.source.type === 'platform' && i.source.id === p.id
                ),
                platformId: p.id
              }
            ]
          })
        : []

    const projectRows = getAllProjects(settings)
      .map((p) => ({
        projectId: p.id,
        projectName: p.name,
        assigned: assignedProjectIds.has(p.id)
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName))

    return [...platformRows, ...projectRows]
  }

  findCanonicalInstance(
    scan: ScanResult,
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string
  ): ScannedResource | null {
    const items = filterItems(getItems(scan, resourceType), resourceType)
    const instances = items.filter((i) => matchesResourceName(i, resourceType, resourceName))
    if (instances.length === 0) return null
    return pickCanonical(instances)
  }

  async applyProjectAssignment(
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    assignedProjectIds: string[]
  ): Promise<void> {
    const settings = settingsStore.get()
    const scan = await scannerService.scanAll(settings)
    const canonical = this.findCanonicalInstance(scan, resourceType, resourceName)
    if (!canonical) throw new Error(`Resource not found: ${resourceName}`)

    const matrix = this.getProjectMatrix(scan, settings, resourceType, resourceName)
    // Platform ("<Name> (Global)") rows are managed by applyGlobalAssignment, never here.
    const previousAssigned = new Set(
      matrix.filter((r) => !r.platformId && r.assigned).map((r) => r.projectId)
    )
    const nextAssigned = new Set(
      assignedProjectIds.filter((id) => !id.startsWith('platform:'))
    )

    for (const projectId of nextAssigned) {
      if (!previousAssigned.has(projectId)) {
        await assignmentService.assignToProject(canonical, resourceType, projectId)
      }
    }

    for (const projectId of previousAssigned) {
      if (!nextAssigned.has(projectId)) {
        const diskName = resourceType === 'skill' ? (canonical as SkillResource).name : canonical.name
        await assignmentService.unassignFromProject(diskName, resourceType, projectId)
      }
    }
  }

  /** Copy the resource into (or remove it from) an IDE/CLI global folder ("<Name> (Global)" row). */
  async applyGlobalAssignment(
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    platformId: PlatformId,
    assigned: boolean
  ): Promise<void> {
    if (resourceType !== 'skill') {
      throw new Error('Global assignment is only supported for skills')
    }
    const settings = settingsStore.get()
    const platform = settings.platforms.find((p) => p.id === platformId)
    if (!platform?.enabled) throw new Error('IDE/CLI is not enabled')

    const scan = await scannerService.scanAll(settings)
    const canonical = this.findCanonicalInstance(scan, resourceType, resourceName)
    if (!canonical) throw new Error(`Resource not found: ${resourceName}`)

    if (assigned) {
      await assignmentService.assignToPlatformGlobal(canonical, resourceType, platformId)
    } else {
      const diskName = (canonical as SkillResource).name
      await assignmentService.unassignFromPlatformGlobal(diskName, resourceType, platformId)
    }
  }

  async setMandatory(
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    mandatory: boolean
  ): Promise<void> {
    const mandatoryKey = MANDATORY_KEY[resourceType]
    settingsStore.update((s) => ({
      ...s,
      mandatoryForAllProjects: {
        ...s.mandatoryForAllProjects,
        [mandatoryKey]: {
          ...(s.mandatoryForAllProjects?.[mandatoryKey] ?? {}),
          [resourceName]: mandatory
        }
      }
    }))

    if (mandatory) {
      const settings = settingsStore.get()
      const projectIds = getAllProjects(settings).map((p) => p.id)
      await this.applyProjectAssignment(resourceType, resourceName, projectIds)
    }
  }

  async applyAllToAllProjects(resourceType: Exclude<ResourceType, 'mcp'>): Promise<number> {
    const settings = settingsStore.get()
    const scan = await scannerService.scanAll(settings)
    const summaries = await this.getGroupSummaries(scan, settings, resourceType)
    const projectIds = getAllProjects(settings).map((p) => p.id)
    if (projectIds.length === 0) throw new Error('No projects configured')

    for (const summary of summaries) {
      const key = summary.groupKey || summary.name
      await this.applyProjectAssignment(resourceType, key, projectIds)
      await this.setMandatory(resourceType, key, true)
    }
    return summaries.length
  }

  /** Assign every skill to one project, keeping its existing assignments. */
  async applyAllSkillsToProject(projectId: string): Promise<number> {
    const settings = settingsStore.get()
    if (!getAllProjects(settings).some((p) => p.id === projectId)) {
      throw new Error('Project not found')
    }
    const scan = await scannerService.scanAll(settings)
    const summaries = await this.getGroupSummaries(scan, settings, 'skill')

    // ponytail: one rescan per skill (same as applyAllToAllProjects); batch if skill counts grow large.
    let assigned = 0
    for (const summary of summaries) {
      if (summary.assignedProjectIds.includes(projectId)) continue
      const key = summary.groupKey || summary.name
      await this.applyProjectAssignment('skill', key, [...summary.assignedProjectIds, projectId])
      assigned++
    }
    return assigned
  }

  async deleteResource(
    scan: ScanResult,
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string
  ): Promise<void> {
    await withInAppFsOp(async () => {
      const items = filterItems(getItems(scan, resourceType), resourceType)
      const instances = items.filter((i) => matchesResourceName(i, resourceType, resourceName))
      const seen = new Set<string>()
      const kind = trashKind(resourceType)

      for (const item of instances) {
        let path: string
        switch (resourceType) {
          case 'skill':
            path = (item as SkillResource).rootPath
            break
          case 'subAgent':
            path = (item as SubAgentResource).filePath
            break
          default:
            continue
        }
        if (seen.has(path)) continue
        seen.add(path)
        await fileService.moveToTrash(path, kind, item.name, {
          resourceType,
          sourceType: item.source.type,
          sourceId: item.source.id
        })
      }

      const assignKey = ASSIGNMENT_KEY[resourceType]
      settingsStore.update((s) => {
        const nextAssignments = { ...s.assignments[assignKey] }
        for (const item of instances) {
          delete nextAssignments[item.id]
        }
        const nextMandatory = { ...(s.mandatoryForAllProjects?.[MANDATORY_KEY[resourceType]] ?? {}) }
        delete nextMandatory[resourceName]
        if (resourceType === 'skill') {
          delete nextMandatory[skillFolderNameFromKey(resourceName)]
        }

        return {
          ...s,
          assignments: { ...s.assignments, [assignKey]: nextAssignments },
          mandatoryForAllProjects: {
            ...s.mandatoryForAllProjects,
            [MANDATORY_KEY[resourceType]]: nextMandatory
          }
        }
      })
    })
  }

  async createResource(
    resourceType: 'skill' | 'subAgent',
    name: string,
    projectIds: string[]
  ): Promise<void> {
    const settings = settingsStore.get()
    const includeGlobal = projectIds.includes(GLOBAL_TARGET_KEY)
    const projects = getAllProjects(settings).filter((p) => projectIds.includes(p.id))
    if (!includeGlobal && projects.length === 0) {
      throw new Error('Select Global and/or at least one project')
    }

    const safeName = name.trim()
    if (!safeName) throw new Error('Name is required')

    const content = resourceType === 'skill' ? skillTemplate(safeName) : subAgentTemplate(safeName)

    await this.writeRepoBankResource(resourceType, safeName, content)

    if (includeGlobal) {
      await this.seedResourceInGlobal(resourceType, safeName, content)
    }

    for (const project of projects) {
      await this.seedResourceInProject(resourceType, safeName, project, content)
    }
  }

  private async seedResourceInGlobal(
    resourceType: 'skill' | 'subAgent',
    name: string,
    content: string
  ): Promise<void> {
    const settings = settingsStore.get()
    const platform = settings.platforms.find((p) => p.enabled && p.id === 'cursor')
    if (!platform) throw new Error('Cursor platform is not enabled')
    const adapter = getAdapter(platform.id)
    if (!adapter) throw new Error('Cursor adapter not found')
    const paths = adapter.getPlatformPaths(platform.rootPath)

    switch (resourceType) {
      case 'skill':
        // Global skills always live under ~/.cursor/skills
        await fileService.writeText(
          join(platform.rootPath, 'skills', name, 'SKILL.md'),
          content!
        )
        break
      case 'subAgent':
        if (paths.agentsDir) {
          await fileService.writeText(join(paths.agentsDir, `${name}.md`), content)
        }
        break
    }
  }

  private async seedResourceInProject(
    resourceType: 'skill' | 'subAgent',
    name: string,
    project: ProjectInfo,
    content: string
  ): Promise<void> {
    const settings = settingsStore.get()
    const platforms = CURSOR_ONLY_RESOURCES.includes(resourceType)
      ? settings.platforms.filter((p) => p.enabled && p.id === 'cursor')
      : settings.platforms.filter((p) => p.enabled)

    for (const platform of platforms) {
      const adapter = getAdapter(platform.id)
      if (!adapter) continue
      const paths = adapter.getProjectPaths(project.path, platform.projectDirName)

      switch (resourceType) {
        case 'skill':
          await fileService.writeText(
            join(paths.skillsDirs[0], name, 'SKILL.md'),
            content
          )
          break
        case 'subAgent':
          if (paths.agentsDir) {
            await fileService.writeText(join(paths.agentsDir, `${name}.md`), content)
          }
          break
      }
    }
  }

  private async writeRepoBankResource(
    resourceType: 'skill' | 'subAgent',
    name: string,
    content: string
  ): Promise<void> {
    const relativePath = resourceType === 'skill' ? 'SKILL.md' : `${name}.md`
    await repoBankService.writeResourceFile(resourceType, name, relativePath, content)
  }

  async renameResource(
    scan: ScanResult,
    resourceType: 'skill' | 'subAgent',
    oldName: string,
    newName: string
  ): Promise<void> {
    const trimmed = newName.trim()
    if (!isValidResourceName(trimmed)) {
      throw new Error('Invalid resource name')
    }

    const skillParsed = resourceType === 'skill' ? parseSkillGroupKey(oldName) : null
    const items = filterItems(getItems(scan, resourceType), resourceType)
    const matchedForName = items.filter((i) => matchesResourceName(i, resourceType, oldName))
    const resolvedDiskName =
      matchedForName[0]?.name ??
      skillParsed?.name ??
      oldName
    const folderOld =
      resourceType === 'skill'
        ? skillFolderNameFromKey(resolvedDiskName)
        : resolvedDiskName
    const targetContentHash =
      skillParsed?.contentHash ??
      (resourceType === 'skill' ? (matchedForName[0] as SkillResource | undefined)?.contentHash : undefined)
    if (trimmed === folderOld) return

    const existing = groupByName(items, resourceType)
    if (resourceType === 'skill') {
      if (items.some((i) => skillNameKey(i.name) === trimmed && !matchedForName.includes(i))) {
        throw new Error(`A resource named "${trimmed}" already exists`)
      }
    } else if ([...existing.values()].some((group) => group[0]?.name === trimmed && itemUuid(group[0]) !== (matchedForName[0] ? itemUuid(matchedForName[0]) : ''))) {
      throw new Error(`A resource named "${trimmed}" already exists`)
    }

    const settings = settingsStore.get()
    if (this.nameExistsOnDisk(settings, resourceType, trimmed)) {
      // Allow rename onto same folder only when it's this resource's instances
      const conflictIsSelf =
        resourceType === 'skill'
          ? matchedForName.some((i) => skillNameKey(i.name) === trimmed)
          : matchedForName.some((i) => i.name === trimmed)
      if (!conflictIsSelf) {
        throw new Error(`A resource named "${trimmed}" already exists`)
      }
    }

    const seen = new Set<string>()

    await withInAppFsOp(async () => {
      // Primary: walk every imported project root so rename never depends on a stale scan.
      for (const { paths, platformId } of iterateProjectPlatformPaths(settings)) {
        if (CURSOR_ONLY_RESOURCES.includes(resourceType) && platformId !== 'cursor') continue

        switch (resourceType) {
          case 'skill':
            for (const skillsDir of paths.skillsDirs) {
              const oldRoot = join(skillsDir, ...folderOld.split(/[/\\]/).filter(Boolean))
              if (!existsSync(oldRoot)) continue
              if (targetContentHash) {
                const skillMd = join(oldRoot, 'SKILL.md')
                if (!existsSync(skillMd)) continue
                const folderLeaf = basename(oldRoot)
                const identityLeaf = skillNameKey(resolvedDiskName)
                // Editor may save a new `name:` before rename; folder leaf still identifies the skill.
                if (folderLeaf !== identityLeaf) {
                  const text = await fileService.readText(skillMd)
                  if (skillContentHash(text) !== targetContentHash) continue
                }
              }
              await this.renameSkillAtRoot(oldRoot, trimmed, seen)
            }
            break
          case 'subAgent': {
            if (!paths.agentsDir) break
            const oldPath = join(paths.agentsDir, `${folderOld}.md`)
            if (!existsSync(oldPath)) continue
            await this.renameSubAgentAtPath(oldPath, trimmed, seen)
            break
          }
        }
      }

      // Fallback: any non-project (local/platform) scan instances not already renamed.
      const instances = matchedForName
      for (const item of instances) {
        switch (resourceType) {
          case 'skill':
            await this.renameSkillAtRoot((item as SkillResource).rootPath, trimmed, seen)
            break
          case 'subAgent':
            await this.renameSubAgentAtPath((item as SubAgentResource).filePath, trimmed, seen)
            break
        }
      }

      if (seen.size === 0) {
        throw new Error(`Resource not found: ${folderOld}`)
      }

      // UUID identity is stable across rename; migrate any legacy name-based settings keys.
      if (folderOld !== trimmed) {
        this.migrateSettingsKeys(resourceType, folderOld, trimmed)
      }
    })
  }

  private nameExistsOnDisk(
    settings: AppSettings,
    resourceType: 'skill' | 'subAgent',
    name: string
  ): boolean {
    for (const { paths, platformId } of iterateProjectPlatformPaths(settings)) {
      if (CURSOR_ONLY_RESOURCES.includes(resourceType) && platformId !== 'cursor') continue
      switch (resourceType) {
        case 'skill':
          for (const skillsDir of paths.skillsDirs) {
            if (existsSync(join(skillsDir, name))) return true
          }
          break
        case 'subAgent':
          if (paths.agentsDir && existsSync(join(paths.agentsDir, `${name}.md`))) return true
          break
      }
    }
    return false
  }

  private async renameSkillAtRoot(
    oldRoot: string,
    newName: string,
    seen: Set<string>
  ): Promise<void> {
    if (seen.has(oldRoot)) return
    seen.add(oldRoot)
    if (!existsSync(oldRoot)) return

    const parent = dirname(oldRoot)
    const leafName = basename(newName.replace(/\\/g, '/'))
    const newRoot = join(parent, leafName)
    if (resolve(oldRoot) === resolve(newRoot)) return
    await fileService.renamePath(oldRoot, newRoot)

    const skillMd = join(newRoot, 'SKILL.md')
    if (existsSync(skillMd)) {
      const text = await fileService.readText(skillMd)
      const { frontmatter, body } = parseFrontmatter(text)
      frontmatter.name = leafName
      const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`)
      await fileService.writeText(skillMd, `---\n${fmLines.join('\n')}\n---\n${body}`)
    }
  }

  private async renameSubAgentAtPath(
    filePath: string,
    newName: string,
    seen: Set<string>
  ): Promise<void> {
    if (seen.has(filePath)) return
    seen.add(filePath)
    if (!existsSync(filePath)) return

    const dir = dirname(filePath)
    const newPath = join(dir, `${newName}.md`)
    await fileService.renamePath(filePath, newPath)

    if (existsSync(newPath)) {
      const text = await fileService.readText(newPath)
      const { frontmatter, body } = parseFrontmatter(text)
      frontmatter.name = newName
      const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`)
      await fileService.writeText(newPath, `---\n${fmLines.join('\n')}\n---\n${body}`)
    }
  }

  private migrateSettingsKeys(
    resourceType: 'skill' | 'subAgent',
    oldName: string,
    newName: string
  ): void {
    const mandatoryKey = MANDATORY_KEY[resourceType]
    settingsStore.update((s) => {
      const mandatory = { ...(s.mandatoryForAllProjects?.[mandatoryKey] ?? {}) }
      if (mandatory[oldName] !== undefined) {
        mandatory[newName] = mandatory[oldName]
        delete mandatory[oldName]
      }

      return {
        ...s,
        mandatoryForAllProjects: {
          ...s.mandatoryForAllProjects,
          [mandatoryKey]: mandatory
        }
      }
    })
  }

  async syncMandatoryForNewProjects(newProjectIds: string[]): Promise<void> {
    if (newProjectIds.length === 0) return
    const settings = settingsStore.get()
    const scan = await scannerService.scanAll(settings)
    const mandatory = settings.mandatoryForAllProjects ?? {
      skills: {},
      subAgents: {}
    }

    const types: Array<Exclude<ResourceType, 'mcp'>> = ['skill', 'subAgent']

    for (const resourceType of types) {
      const key = MANDATORY_KEY[resourceType]
      const names = Object.entries(mandatory[key] ?? {})
        .filter(([, v]) => v)
        .map(([name]) => name)

      for (const name of names) {
        const canonical = this.findCanonicalInstance(scan, resourceType, name)
        if (!canonical) continue
        for (const projectId of newProjectIds) {
          await assignmentService.assignToProject(canonical, resourceType, projectId)
        }
      }
    }
  }
}

export const resourceService = new ResourceService()

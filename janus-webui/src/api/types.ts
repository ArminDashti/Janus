import type {
  AppSettings,
  AssignTarget,
  McpProbeResult,
  PlatformId,
  ProjectMatrixRow,
  ResourceGroupSummary,
  ResourceType,
  ScanResult,
  SkillResource,
  SubAgentResource,
  UpdateApplyResult,
  UpdateCheckResult
} from '@shared/types'

export interface AgentManagerApi {
  getAppRoot: () => Promise<string>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  resetSettings: () => Promise<AppSettings>
  checkForUpdates: () => Promise<UpdateCheckResult>
  applyUpdate: () => Promise<UpdateApplyResult>
  scanAll: (options?: { probeMcps?: boolean }) => Promise<ScanResult>
  syncNow: () => Promise<ScanResult>
  discoverProjects: (scanPath: string) => Promise<ScanResult['skills']>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<boolean>
  listDir: (path: string) => Promise<string[]>
  listEntries: (path: string) => Promise<{ path: string; name: string; isDirectory: boolean }[]>
  openDirectory: () => Promise<string | null>
  openDirectories: () => Promise<string[]>
  getAssignTargets: (resourceType: ResourceType) => Promise<AssignTarget[]>
  getResourceStats: (resourceType: Exclude<ResourceType, 'mcp'>) => Promise<ResourceGroupSummary[]>
  getProjectMatrix: (
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string
  ) => Promise<ProjectMatrixRow[]>
  applyProjectAssignment: (
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    assignedProjectIds: string[]
  ) => Promise<boolean>
  setGlobalAssignment: (
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    platformId: PlatformId,
    assigned: boolean
  ) => Promise<boolean>
  applyAllToAllProjects: (resourceType: Exclude<ResourceType, 'mcp'>) => Promise<number>
  assignAllSkillsToProject: (projectId: string) => Promise<number>
  setMandatory: (
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string,
    mandatory: boolean
  ) => Promise<boolean>
  renameResource: (
    resourceType: 'skill' | 'subAgent',
    oldName: string,
    newName: string
  ) => Promise<boolean>
  deleteResource: (resourceType: Exclude<ResourceType, 'mcp'>, resourceName: string) => Promise<boolean>
  createResource: (
    resourceType: 'skill' | 'subAgent',
    name: string,
    projectIds: string[]
  ) => Promise<boolean>
  getCanonicalResource: (
    resourceType: Exclude<ResourceType, 'mcp'>,
    resourceName: string
  ) => Promise<SkillResource | SubAgentResource | null>
  deleteMcp: (name: string, configPath: string) => Promise<boolean>
  addMcp: (name: string, params: Record<string, unknown>) => Promise<string>
  testMcp: (name: string, params: Record<string, unknown>) => Promise<McpProbeResult>
  addPlatform: (id: PlatformId, rootPath: string, projectDirName?: string) => Promise<AppSettings>
  addProjectRoot: (scanPath: string) => Promise<{ id: string; projects: unknown[] }>
  importProjects: (paths: string[]) => Promise<{ imported: number; projects: unknown[] }>
  removeProject: (projectId: string) => Promise<boolean>
  getLogoPath: (platformId: string) => Promise<string | null>
  getBrandingPath: (name: 'janus-icon' | 'janus-logo') => Promise<string | null>
  purgePlatformsFromProjects: (platformIds: PlatformId[]) => Promise<{
    projectsAffected: number
    foldersRemoved: string[]
    errors: string[]
  }>
  minimizeWindow: () => Promise<boolean>
  maximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<boolean>
  isWindowMaximized: () => Promise<boolean>
  debugLog: (
    hypothesisId: string,
    location: string,
    message: string,
    data?: Record<string, unknown>
  ) => Promise<boolean>
  writeSkillMd: (
    filePath: string,
    content: string,
    currentResourceName: string
  ) => Promise<{ filePath: string }>
  apiRefactor: (params: {
    resourceType: string
    content: string
    userPrompt: string
  }) => Promise<{ content: string }>
  hubSources: () => Promise<HubSource[]>
  hubSkills: (sourceId: string) => Promise<HubSkill[]>
  importHubSkill: (sourceId: string, skillPath: string) => Promise<string>
}

export interface HubSource {
  id: string
  label: string
  owner: string
  repo: string
  branch: string
  path: string
}

export interface HubSkill {
  path: string
  name: string
}

declare global {
  interface Window {
    agentManager: AgentManagerApi
  }
}

export {}

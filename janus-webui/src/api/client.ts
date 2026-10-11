import type { AgentManagerApi, HubSkill, HubSource } from './types'
import type { AppSettings, PlatformId, ScanResult, UpdateApplyResult, UpdateCheckResult } from '@shared/types'

function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const { hostname, protocol, port } = window.location
    if (hostname === 'janus.local') {
      if (!port || port === '80') {
        return `${protocol}//janus-api.local`
      }
      if (port === '8006') {
        return `${protocol}//janus-api.local:47911`
      }
      if (port === '7071') {
        return `${protocol}//janus-api.local:7070`
      }
      return `${protocol}//janus-api.local:${port}`
    }
  }
  return import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:47911'
}

export function getApiBaseUrl(): string {
  return getApiBase()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || response.statusText)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }

  return response.text() as Promise<T>
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value)
}

export const agentManagerClient: AgentManagerApi = {
  getAppRoot: () => request<string>('/api/app/root'),

  getSettings: () => request<AppSettings>('/api/settings'),

  saveSettings: (settings) =>
    request<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),

  resetSettings: () =>
    request<AppSettings>('/api/settings/reset', {
      method: 'POST'
    }),

  checkForUpdates: () => request<UpdateCheckResult>('/api/updates/check'),

  applyUpdate: () =>
    request<UpdateApplyResult>('/api/updates/apply', {
      method: 'POST'
    }),

  scanAll: (options) => {
    const probe = options?.probeMcps ? 'true' : 'false'
    return request(`/api/scan?probeMcps=${probe}`)
  },

  syncNow: () =>
    request<ScanResult>('/api/sync', {
      method: 'POST'
    }),

  discoverProjects: (scanPath) =>
    request(`/api/scan/projects?path=${encodeQuery(scanPath)}`),

  readFile: (path) => request<string>(`/api/files?path=${encodeQuery(path)}`),

  writeFile: (path, content) =>
    request<boolean>('/api/files', {
      method: 'PUT',
      body: JSON.stringify({ path, content })
    }),

  listDir: (path) => request<string[]>(`/api/files/list?path=${encodeQuery(path)}`),

  listEntries: (path) =>
    request(`/api/files/entries?path=${encodeQuery(path)}`),

  openDirectory: async () => null,

  openDirectories: async () => [],

  getAssignTargets: (resourceType) =>
    request(`/api/resources/${resourceType}/targets`),

  getResourceStats: (resourceType) =>
    request(`/api/resources/${resourceType}/stats`),

  getProjectMatrix: (resourceType, resourceName) =>
    request(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}/matrix`),

  applyProjectAssignment: (resourceType, resourceName, assignedProjectIds) =>
    request<boolean>(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignedProjectIds })
    }),

  setGlobalAssignment: (resourceType, resourceName, platformId, assigned) =>
    request<boolean>(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}/global-assign`, {
      method: 'POST',
      body: JSON.stringify({ platformId, assigned })
    }),

  applyAllToAllProjects: (resourceType) =>
    request<number>(`/api/resources/${resourceType}/assign-all`, {
      method: 'POST'
    }),

  assignAllSkillsToProject: (projectId) =>
    request<number>(`/api/projects/${encodeURIComponent(projectId)}/assign-all-skills`, {
      method: 'POST'
    }),

  setMandatory: (resourceType, resourceName, mandatory) =>
    request<boolean>(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}/mandatory`, {
      method: 'POST',
      body: JSON.stringify({ mandatory })
    }),

  renameResource: (resourceType, oldName, newName) =>
    request<boolean>(`/api/resources/${resourceType}/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldName, newName })
    }),

  deleteResource: (resourceType, resourceName) =>
    request<boolean>(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}`, {
      method: 'DELETE'
    }),

  createResource: (resourceType, name, projectIds) =>
    request<boolean>(`/api/resources/${resourceType}`, {
      method: 'POST',
      body: JSON.stringify({ name, projectIds })
    }),

  getCanonicalResource: (resourceType, resourceName) =>
    request(`/api/resources/${resourceType}/${encodeURIComponent(resourceName)}/canonical`),

  deleteMcp: (name, configPath) =>
    request<boolean>(`/api/mcps/${encodeURIComponent(name)}?configPath=${encodeQuery(configPath)}`, {
      method: 'DELETE'
    }),

  addMcp: (name, params) =>
    request<string>('/api/mcps', {
      method: 'POST',
      body: JSON.stringify({ name, params })
    }),

  testMcp: (name, params) =>
    request('/api/mcps/test', {
      method: 'POST',
      body: JSON.stringify({ name, params })
    }),

  addPlatform: (id, rootPath, projectDirName) =>
    request<AppSettings>('/api/platforms', {
      method: 'POST',
      body: JSON.stringify({ id, rootPath, projectDirName })
    }),

  addProjectRoot: (scanPath) =>
    request('/api/projects/roots', {
      method: 'POST',
      body: JSON.stringify({ scanPath })
    }),

  importProjects: (paths) =>
    request('/api/projects/import', {
      method: 'POST',
      body: JSON.stringify({ paths })
    }),

  removeProject: (projectId) =>
    request<boolean>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    }),

  getLogoPath: async (platformId) => `/logos/${platformId}.svg`,

  getBrandingPath: async (name) => `/branding/${name}.png`,

  purgePlatformsFromProjects: (platformIds) =>
    request('/api/platforms/purge', {
      method: 'POST',
      body: JSON.stringify({ platformIds })
    }),

  minimizeWindow: async () => false,

  maximizeWindow: async () => false,

  closeWindow: async () => false,

  isWindowMaximized: async () => false,

  debugLog: async (hypothesisId, location, message, data) => {
    try {
      await request<boolean>('/api/debug/log', {
        method: 'POST',
        body: JSON.stringify({ hypothesisId, location, message, data: data ?? {} })
      })
      return true
    } catch {
      return false
    }
  },

  writeSkillMd: (filePath, content, currentResourceName) =>
    request<{ filePath: string }>('/api/files/skill-md', {
      method: 'PUT',
      body: JSON.stringify({ filePath, content, currentResourceName })
    }),

  apiRefactor: (params) =>
    request<{ content: string }>('/api/refactor', {
      method: 'POST',
      body: JSON.stringify(params)
    }),

  hubSources: () => request<HubSource[]>('/api/hub/sources'),

  hubSkills: (sourceId) =>
    request<HubSkill[]>(`/api/hub/sources/${encodeURIComponent(sourceId)}/skills`),

  importHubSkill: (sourceId, skillPath) =>
    request<string>('/api/hub/import', {
      method: 'POST',
      body: JSON.stringify({ sourceId, skillPath })
    })
}

export function connectScanEvents(): EventSource {
  const source = new EventSource(`${getApiBase()}/api/events`)
  source.onmessage = () => {
    window.dispatchEvent(new Event('scan-changed'))
  }
  return source
}

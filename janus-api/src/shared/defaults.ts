import type { AppSettings, PlatformConfig, PlatformId } from './types'
import { DEFAULT_PLATFORM_PROJECT_DIRS, DEFAULT_PLATFORM_ROOTS, PLATFORM_IDS } from './types'
import { expandHome } from './utils'

export function createDefaultSettings(): AppSettings {
  const platforms: PlatformConfig[] = PLATFORM_IDS.map((id) => ({
    id,
    enabled: id === 'cursor',
    rootPath: expandHome(DEFAULT_PLATFORM_ROOTS[id]),
    projectDirName: DEFAULT_PLATFORM_PROJECT_DIRS[id]
  }))

  return {
    window: { maximized: true },
    startup: { runOnLogin: false },
    theme: 'vscode-dark',
    font: 'Inter',
    dataPath: './data',
    platforms,
    projectRoots: [],
    activeApiProvider: 'openRouter',
    providers: {
      openAi: { apiKey: '', model: 'gpt-4o-mini', baseUrl: '' },
      anthropic: { apiKey: '', model: 'claude-3-5-haiku-latest', baseUrl: '' },
      opencodeGo: { apiKey: '', model: '', baseUrl: '' },
      opencodeZen: { apiKey: '', model: '', baseUrl: '' },
      openRouter: { apiKey: '', model: 'openai/gpt-4o-mini', baseUrl: '' },
      openAiCompatible: { apiKey: '', model: '', baseUrl: '' }
    },
    assignments: {
      skills: {},
      mcps: {},
      subAgents: {}
    },
    mandatoryForAllProjects: {
      skills: {},
      subAgents: {}
    },
    hiddenSkills: [],
    showHiddenSkills: false,
    updates: { checkOnStartup: true },
    uiFilters: {}
  }
}

export function getPlatformConfig(
  settings: AppSettings,
  platformId: PlatformId
): PlatformConfig | undefined {
  return settings.platforms.find((p) => p.id === platformId)
}

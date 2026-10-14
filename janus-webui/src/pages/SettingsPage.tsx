import { useEffect, useState } from 'react'
import { DownloadCloud, FolderCog, KeyRound, Layers, Settings2, SlidersHorizontal, Terminal, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/appStore'
import { GeneralTab } from '@renderer/components/settings/GeneralTab'
import { AppearanceTab } from '@renderer/components/settings/AppearanceTab'
import { PlatformsTab } from '@renderer/components/settings/PlatformsTab'
import { ProjectImportSection } from '@renderer/components/settings/ProjectImportSection'
import { ProvidersTab } from '@renderer/components/settings/ProvidersTab'
import { UpdatesTab } from '@renderer/components/settings/UpdatesTab'

type SettingsTab = 'general' | 'appearance' | 'platforms' | 'providers' | 'projects' | 'updates'

interface TabDef {
  id: SettingsTab
  label: string
  icon: LucideIcon
  heading: string
  description: string
}

const TABS: TabDef[] = [
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    heading: 'General',
    description: 'Configure startup and application-wide preferences.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Layers,
    heading: 'Appearance',
    description: 'Choose a theme and font. Changes apply instantly and are saved automatically.'
  },
  {
    id: 'platforms',
    label: 'IDE / CLI',
    icon: Terminal,
    heading: 'IDE / CLI',
    description: 'Enable AI platforms and set where their skills and rules folders live.'
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: KeyRound,
    heading: 'Providers',
    description: 'Add API keys and choose the provider and model that edit your skills.'
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderCog,
    heading: 'Projects',
    description: 'Import repositories or parent folders to make them available in your workspace.'
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: DownloadCloud,
    heading: 'Updates',
    description: 'Check for new Janus builds on GitHub and install them on this machine.'
  }
]

interface SettingsPageProps {
  /** When true, omit page title (shown in modal chrome). */
  embedded?: boolean
  onClose?: () => void
}

export function SettingsPage({ embedded = false, onClose }: SettingsPageProps) {
  const { settings, loadSettings } = useAppStore()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (settings) setLocalSettings(settings)
  }, [settings])

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  if (!localSettings) {
    return (
      <div className={cn('text-zinc-500 text-sm', embedded ? 'p-5' : 'p-6')}>
        Loading settings…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-zinc-800 flex flex-col min-h-0">
        <div className="flex items-center gap-2.5 px-4 h-16 shrink-0">
          <span className="text-blue-400">
            <Settings2 size={22} />
          </span>
          <span className="text-lg font-semibold text-zinc-100">Settings</span>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
          {TABS.map((t) => {
            const selected = t.id === tab
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  selected
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                )}
              >
                <t.icon size={16} className="shrink-0" />
                {t.label}
              </button>
            )
          })}
        </nav>

        <div className="p-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
            <p className="text-xs font-medium text-zinc-200">Need help?</p>
            <a
              href="https://github.com/ArminDashti/janus#readme"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1"
            >
              Learn about managing projects
              <span aria-hidden>↗</span>
            </a>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold text-zinc-100">{active.heading}</h2>
            <p className="text-sm text-zinc-500 mt-1">{active.description}</p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close settings"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
          {tab === 'general' && (
            <GeneralTab settings={localSettings} onChange={setLocalSettings} />
          )}
          {tab === 'appearance' && (
            <AppearanceTab settings={localSettings} onChange={setLocalSettings} />
          )}
          {tab === 'platforms' && (
            <PlatformsTab settings={localSettings} onChange={setLocalSettings} />
          )}
          {tab === 'providers' && (
            <ProvidersTab settings={localSettings} onChange={setLocalSettings} />
          )}
          {tab === 'projects' && (
            <ProjectImportSection settings={localSettings} onChange={setLocalSettings} />
          )}
          {tab === 'updates' && (
            <UpdatesTab settings={localSettings} onChange={setLocalSettings} />
          )}
        </div>
      </main>
    </div>
  )
}

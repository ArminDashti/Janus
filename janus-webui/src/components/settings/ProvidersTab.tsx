import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import {
  API_PROVIDER_IDS,
  API_PROVIDER_LABELS,
  type ApiProviderConfig,
  type ApiProviderId,
  type AppSettings
} from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { showMessage } from '@renderer/stores/messageStore'
import { SettingsSection } from '@renderer/components/settings/SettingsSection'

interface ProvidersTabProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}

const INPUT_CLASS =
  'w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-200'

export function ProvidersTab({ settings, onChange }: ProvidersTabProps) {
  const { loadSettings } = useAppStore()
  const [providers, setProviders] = useState(settings.providers)
  const [activeProvider, setActiveProvider] = useState(settings.activeApiProvider)

  useEffect(() => {
    setProviders(settings.providers)
    setActiveProvider(settings.activeApiProvider)
  }, [settings])

  const updateProvider = (id: ApiProviderId, patch: Partial<ApiProviderConfig>) => {
    setProviders((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const saveProviders = async () => {
    const confirmed = await showMessage({
      message: 'Save provider settings?',
      confirm: true
    })
    if (!confirmed) return

    const next: AppSettings = {
      ...settings,
      activeApiProvider: activeProvider,
      providers
    }
    await window.agentManager.saveSettings(next)
    onChange(next)
    await loadSettings()
    await showMessage({ message: 'Provider settings saved', type: 'success' })
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={KeyRound}
        title="Skill editing model"
        description="Choose which configured provider and model edit your skills."
      >
        <label className="flex flex-col gap-1 max-w-md">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Provider</span>
          <select
            value={activeProvider}
            onChange={(e) => setActiveProvider(e.target.value as ApiProviderId)}
            className={INPUT_CLASS}
          >
            {API_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {API_PROVIDER_LABELS[id]} · {providers[id].model || 'no model set'}
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {API_PROVIDER_IDS.map((id) => (
          <div key={id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <span className="text-sm font-medium text-zinc-100">{API_PROVIDER_LABELS[id]}</span>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">API key</span>
              <input
                type="password"
                autoComplete="off"
                value={providers[id].apiKey}
                onChange={(e) => updateProvider(id, { apiKey: e.target.value })}
                placeholder="Paste API key"
                className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Model</span>
              <input
                value={providers[id].model}
                onChange={(e) => updateProvider(id, { model: e.target.value })}
                placeholder="Model id"
                className={INPUT_CLASS}
              />
            </label>

            {id === 'openAiCompatible' && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Base URL</span>
                <input
                  value={providers[id].baseUrl}
                  onChange={(e) => updateProvider(id, { baseUrl: e.target.value })}
                  placeholder="https://host/v1"
                  className={INPUT_CLASS}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => void saveProviders()}
          className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded-lg"
        >
          Save provider settings
        </button>
      </div>
    </div>
  )
}

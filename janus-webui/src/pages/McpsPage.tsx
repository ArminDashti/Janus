import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Loader2, Pencil, Plus, RefreshCw, Search, Server, SlidersHorizontal, Trash } from 'lucide-react'
import { JsonEditor } from '@renderer/components/JsonEditor'
import { McpToolsModal } from '@renderer/components/mcp/McpToolsModal'
import { ResourceSubViewHeader } from '@renderer/components/resources/ResourceListView'
import { Toggle } from '@renderer/components/Toggle'
import { useAppStore } from '@renderer/stores/appStore'
import { showMessage } from '@renderer/stores/messageStore'
import { cn } from '@renderer/lib/utils'
import type { McpProbeResult, McpResource } from '@shared/types'

type ViewMode = 'list' | 'edit'
type LayoutMode = 'grid' | 'list'
type StatusFilter = 'all' | 'active' | 'disabled' | 'error'

function statusBadgeClass(
  enabled: boolean,
  status: McpResource['status']
): string {
  if (!enabled) return 'bg-zinc-800 text-zinc-400 border-zinc-700'
  switch (status) {
    case 'connected':
      return 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
    case 'configured':
    case 'unknown':
      return 'bg-amber-950/60 text-amber-400 border-amber-800/50'
    case 'error':
    case 'disconnected':
      return 'bg-red-950/60 text-red-400 border-red-800/50'
    default:
      return 'bg-zinc-800 text-zinc-400 border-zinc-700'
  }
}

function statusLabel(enabled: boolean, status: McpResource['status']): string {
  if (!enabled) return 'Disabled'
  if (status === 'connected') return 'Connected'
  if (status === 'configured') return 'Configured'
  if (status === 'unknown') return 'Unknown'
  if (status === 'disconnected') return 'Disconnected'
  if (status === 'error') return 'Error'
  return status
}

/** Directory containing the MCP config file (mcp.json). */
function configDir(configPath: string): string {
  const normalized = configPath.replace(/[\\/]+$/, '')
  const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return idx > 0 ? normalized.slice(0, idx) : normalized
}

interface McpCardProps {
  mcp: McpResource
  enabled: boolean
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenTools: () => void
  onToggle: () => void
}

function McpCard({ mcp, enabled, testing, onTest, onEdit, onDelete, onOpenTools, onToggle }: McpCardProps) {
  return (
    <div className="flex flex-col gap-3 min-w-0 rounded-xl border border-surface-border bg-surface-raised p-4 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-100 truncate">{mcp.name}</p>
          <div className="flex items-center gap-0.5 mt-1">
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400 disabled:opacity-50"
              title="Test connection"
            >
              {testing ? (
                <Loader2 size={15} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <FlaskConical size={15} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
              title="Edit"
            >
              <Pencil size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400"
              title="Delete"
            >
              <Trash size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'text-xs px-2.5 py-0.5 rounded-full border',
              statusBadgeClass(enabled, mcp.status)
            )}
          >
            {statusLabel(enabled, mcp.status)}
          </span>
          <Toggle
            checked={enabled}
            onChange={onToggle}
            title={enabled ? `Disable ${mcp.name}` : `Enable ${mcp.name}`}
            ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${mcp.name}`}
          />
        </div>
      </div>

      <button type="button" onClick={onOpenTools} className="flex items-baseline gap-2 text-left" title="Open tools">
        <span className="text-3xl font-semibold text-zinc-100 tabular-nums leading-none">
          {mcp.tools.length}
        </span>
        <span className="text-sm text-zinc-400">Tools</span>
      </button>

      <p className="font-mono text-xs text-zinc-500 truncate" title={mcp.configPath}>
        {configDir(mcp.configPath)}
      </p>

      {mcp.error && enabled && (
        <p className="text-[11px] text-red-400 line-clamp-2" title={mcp.error}>
          {mcp.error}
        </p>
      )}
    </div>
  )
}

export function McpsPage() {
  const { scan, refreshScan, settings, loadSettings } = useAppStore()
  const [view, setView] = useState<ViewMode>('list')
  const [selected, setSelected] = useState<McpResource | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addJson, setAddJson] = useState('{\n  "command": "npx",\n  "args": ["-y", "some-mcp-server"]\n}')
  const [addName, setAddName] = useState('')
  const [paramsJson, setParamsJson] = useState('')
  const [toolsFor, setToolsFor] = useState<
    Pick<McpResource, 'name' | 'status' | 'tools' | 'error'> | null
  >(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, McpProbeResult>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [directoryFilter, setDirectoryFilter] = useState('all')
  const [layout, setLayout] = useState<LayoutMode>('grid')

  useEffect(() => {
    void refreshScan({ probeMcps: true })
  }, [refreshScan])

  const mcps = useMemo(() => {
    const map = new Map<string, McpResource>()
    for (const m of scan?.mcps ?? []) {
      const existing = map.get(m.name)
      if (existing) {
        existing.platforms = [...new Set([...existing.platforms, ...m.platforms])]
      } else {
        map.set(m.name, { ...m, platforms: [...m.platforms] })
      }
    }
    const merged = [...map.values()].map((m) =>
      testResults[m.name] ? { ...m, ...testResults[m.name] } : m
    )
    return merged.sort((a, b) => a.name.localeCompare(b.name))
  }, [scan, testResults])

  const isEnabled = (mcp: McpResource) =>
    settings?.mcpEnabled?.[mcp.name] ?? mcp.enabled ?? true

  const directories = useMemo(() => {
    const dirs = new Set<string>()
    for (const m of mcps) dirs.add(configDir(m.configPath))
    return [...dirs].sort((a, b) => a.localeCompare(b))
  }, [mcps])

  const filteredMcps = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mcps.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false
      const on = isEnabled(m)
      if (statusFilter === 'disabled' && on) return false
      if (statusFilter === 'active' && (!on || m.status !== 'connected')) return false
      if (
        statusFilter === 'error' &&
        on &&
        m.status !== 'error' &&
        m.status !== 'disconnected'
      ) {
        return false
      }
      if (statusFilter === 'error' && !on) return false
      if (directoryFilter !== 'all' && configDir(m.configPath) !== directoryFilter) return false
      return true
    })
  }, [mcps, search, statusFilter, directoryFilter, settings])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshScan({ probeMcps: true })
    } finally {
      setRefreshing(false)
    }
  }

  const openEdit = (mcp: McpResource) => {
    setSelected(mcp)
    setParamsJson(JSON.stringify(mcp.params, null, 2))
    setView('edit')
  }

  const handleToggleEnabled = async (mcp: McpResource) => {
    if (!settings) return
    const enabled = isEnabled(mcp)
    try {
      await window.agentManager.saveSettings({
        ...settings,
        mcpEnabled: { ...(settings.mcpEnabled ?? {}), [mcp.name]: !enabled }
      })
      await loadSettings()
      await refreshScan({ probeMcps: true })
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Save failed',
        type: 'error'
      })
    }
  }

  const handleDelete = async (mcp: McpResource) => {
    const confirmed = await showMessage({
      message: `Remove MCP "${mcp.name}" from configuration?`,
      confirm: true,
      type: 'error',
      title: 'Remove MCP'
    })
    if (!confirmed) return
    await window.agentManager.deleteMcp(mcp.name, mcp.configPath)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[mcp.name]
      return next
    })
    await refreshScan({ probeMcps: true })
  }

  const handleTest = async (mcp: McpResource) => {
    setTesting(mcp.name)
    try {
      const result = await window.agentManager.testMcp(mcp.name, mcp.params)
      setTestResults((prev) => ({ ...prev, [mcp.name]: result }))
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [mcp.name]: {
          status: 'error',
          tools: [],
          error: e instanceof Error ? e.message : 'Test failed'
        }
      }))
    } finally {
      setTesting(null)
    }
  }

  const handleAdd = async () => {
    if (!addName.trim()) {
      await showMessage({ message: 'Name is required', type: 'error' })
      return
    }
    try {
      const params = JSON.parse(addJson) as Record<string, unknown>
      await window.agentManager.addMcp(addName.trim(), params)
      setAddOpen(false)
      setAddName('')
      await refreshScan({ probeMcps: true })
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Invalid JSON',
        type: 'error'
      })
    }
  }

  const saveParams = async (jsonOverride?: string) => {
    if (!selected) return
    const confirmed = await showMessage({
      message: `Save changes to ${selected.name}?`,
      confirm: true
    })
    if (!confirmed) return
    try {
      const raw = jsonOverride ?? paramsJson
      const toSave = JSON.parse(raw) as Record<string, unknown>
      const config = JSON.parse(await window.agentManager.readFile(selected.configPath))
      config.mcpServers ??= {}
      config.mcpServers[selected.name] = toSave
      await window.agentManager.writeFile(selected.configPath, JSON.stringify(config, null, 2))
      setParamsJson(JSON.stringify(toSave, null, 2))
      await refreshScan({ probeMcps: true })
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Invalid JSON',
        type: 'error'
      })
    }
  }

  if (view === 'edit' && selected) {
    const displayed = testResults[selected.name]
      ? { ...selected, ...testResults[selected.name] }
      : selected
    return (
      <div className="flex flex-col h-full">
        <ResourceSubViewHeader
          title={`Edit: ${selected.name}`}
          onBack={() => {
            setView('list')
            setSelected(null)
          }}
        />
        <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
          <div className="space-y-1 shrink-0">
            <p className="text-sm text-zinc-500">IDE/CLI: {selected.platforms.join(', ')}</p>
            <p className="text-xs font-mono text-zinc-600 truncate" title={selected.configPath}>
              {selected.configPath}
            </p>
            {displayed.error && (
              <p className="text-xs text-red-400" title={displayed.error}>
                {displayed.error}
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <JsonEditor
              value={paramsJson}
              onChange={setParamsJson}
              onSave={async (v) => {
                setParamsJson(v)
                await saveParams(v)
              }}
            />
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() =>
                setToolsFor({
                  name: displayed.name,
                  status: displayed.status,
                  tools: displayed.tools,
                  error: displayed.error
                })
              }
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded"
            >
              Open tools ({displayed.tools.length})
            </button>
          </div>
        </div>
        {toolsFor && <McpToolsModal mcp={toolsFor} onClose={() => setToolsFor(null)} />}
      </div>
    )
  }

  const showEmpty = mcps.length === 0
  const showNoMatches = !showEmpty && filteredMcps.length === 0

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto">
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">MCPs</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border bg-surface-raised text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} />
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              <Plus size={16} strokeWidth={2} />
              Add MCP
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search MCPs by name..."
              className="w-full rounded-lg border border-surface-border bg-surface-input pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-600/50"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-sm text-zinc-300 cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="all">All Status</option>
            <option value="active">Connected</option>
            <option value="disabled">Disabled</option>
            <option value="error">Error</option>
          </select>
          <select
            value={directoryFilter}
            onChange={(e) => setDirectoryFilter(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-sm text-zinc-300 cursor-pointer max-w-[14rem] truncate"
            aria-label="Filter by directory"
          >
            <option value="all">All Directories</option>
            {directories.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={layout}
            onChange={(e) => setLayout(e.target.value as LayoutMode)}
            className="rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-sm text-zinc-300 cursor-pointer"
            aria-label="Change view"
          >
            <option value="grid">Grid View</option>
            <option value="list">List View</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setStatusFilter('all')
              setDirectoryFilter('all')
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
            title="Reset filters"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6">
        {showEmpty ? (
          <div className="flex flex-col items-center text-center max-w-sm mx-auto py-16">
            <div className="mb-5 text-zinc-600">
              <Server size={48} strokeWidth={1.25} />
            </div>
            <p className="text-base font-medium text-zinc-200">No MCP servers configured</p>
            <p className="text-sm text-zinc-500 mt-2">
              Get started by adding your first MCP server.
            </p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              <Plus size={16} />
              Add Your First MCP
            </button>
          </div>
        ) : showNoMatches ? (
          <p className="py-12 text-center text-zinc-500">No MCPs match your filters.</p>
        ) : (
          <div
            className={cn(
              layout === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                : 'flex flex-col gap-3'
            )}
          >
            {filteredMcps.map((row) => (
              <McpCard
                key={row.name}
                mcp={row}
                enabled={isEnabled(row)}
                testing={testing === row.name}
                onTest={() => void handleTest(row)}
                onEdit={() => openEdit(row)}
                onDelete={() => void handleDelete(row)}
                onOpenTools={() =>
                  setToolsFor({ name: row.name, status: row.status, tools: row.tools, error: row.error })
                }
                onToggle={() => void handleToggleEnabled(row)}
              />
            ))}
          </div>
        )}
      </div>

      {toolsFor && <McpToolsModal mcp={toolsFor} onClose={() => setToolsFor(null)} />}

      {addOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-[520px] max-h-[80vh] flex flex-col shadow-xl">
            <h3 className="font-medium text-lg mb-4">Add MCP Server</h3>
            <label className="text-sm text-zinc-400 mb-1 block">Server name</label>
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="my-mcp-server"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <label className="text-sm text-zinc-400 mb-1 block">Configuration (JSON)</label>
            <textarea
              value={addJson}
              onChange={(e) => setAddJson(e.target.value)}
              rows={10}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono flex-1 min-h-[200px]"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="px-4 py-2 text-sm bg-zinc-800 rounded-lg hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                className="px-4 py-2 text-sm bg-blue-600 rounded-lg hover:bg-blue-500"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

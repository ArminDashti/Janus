import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Boxes,
  CircleOff,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  Trash,
  Wrench
} from 'lucide-react'
import { JsonEditor } from '@renderer/components/JsonEditor'
import { McpToolsModal } from '@renderer/components/mcp/McpToolsModal'
import { ResourceSubViewHeader } from '@renderer/components/resources/ResourceListView'
import { Toggle } from '@renderer/components/Toggle'
import { useAppStore } from '@renderer/stores/appStore'
import { showMessage } from '@renderer/stores/messageStore'
import { cn } from '@renderer/lib/utils'
import type { McpProbeResult, McpResource } from '@shared/types'

type ViewMode = 'list' | 'edit'
type StatusFilter = 'all' | 'active' | 'disabled' | 'error'
type SortKey = 'name' | 'directory'

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

interface StatCardProps {
  title: string
  value: number
  hint: string
  icon: typeof Boxes
  iconClass: string
  iconWrapClass: string
}

function StatCard({ title, value, hint, icon: Icon, iconClass, iconWrapClass }: StatCardProps) {
  return (
    <div className="flex gap-4 rounded-xl border border-surface-border bg-surface-raised p-5 min-w-0">
      <div
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border',
          iconWrapClass
        )}
      >
        <Icon size={20} className={iconClass} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-400">{title}</p>
        <p className="text-3xl font-semibold text-zinc-100 tabular-nums leading-tight mt-0.5">
          {value}
        </p>
        <p className="text-xs text-zinc-500 mt-2 truncate">{hint}</p>
      </div>
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-medium hover:text-zinc-200 transition-colors"
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp size={14} className="text-zinc-400" />
        ) : (
          <ArrowDown size={14} className="text-zinc-400" />
        )
      ) : (
        <ArrowUpDown size={14} className="text-zinc-600" />
      )}
    </button>
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
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const stats = useMemo(() => {
    let enabled = 0
    let disabled = 0
    let tools = 0
    for (const m of mcps) {
      const on = isEnabled(m)
      if (on) enabled += 1
      else disabled += 1
      tools += m.tools.length
    }
    return { total: mcps.length, enabled, disabled, tools }
  }, [mcps, settings])

  const directories = useMemo(() => {
    const dirs = new Set<string>()
    for (const m of mcps) dirs.add(configDir(m.configPath))
    return [...dirs].sort((a, b) => a.localeCompare(b))
  }, [mcps])

  const filteredMcps = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = mcps.filter((m) => {
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
    const dir = sortDir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name)
      return dir * configDir(a.configPath).localeCompare(configDir(b.configPath))
    })
    return rows
  }, [mcps, search, statusFilter, directoryFilter, sortKey, sortDir, settings])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">MCPs</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Manage your MCP servers and their configurations
            </p>
          </div>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
          <StatCard
            title="Total MCPs"
            value={stats.total}
            hint="All configured servers"
            icon={Boxes}
            iconClass="text-blue-400"
            iconWrapClass="bg-blue-950/40 border-blue-900/50"
          />
          <StatCard
            title="Enabled"
            value={stats.enabled}
            hint="Active and running"
            icon={Sparkles}
            iconClass="text-emerald-400"
            iconWrapClass="bg-emerald-950/40 border-emerald-900/50"
          />
          <StatCard
            title="Disabled"
            value={stats.disabled}
            hint="Currently disabled"
            icon={CircleOff}
            iconClass="text-amber-400"
            iconWrapClass="bg-amber-950/40 border-amber-900/50"
          />
          <StatCard
            title="Tools Available"
            value={stats.tools}
            hint="Across all MCPs"
            icon={Wrench}
            iconClass="text-violet-400"
            iconWrapClass="bg-violet-950/40 border-violet-900/50"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col">
        <div
          className="flex flex-col flex-1 min-h-0 rounded-xl border border-surface-border bg-surface-raised overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-surface-border">
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

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-surface-raised z-10">
                <tr className="border-b border-surface-border text-left text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">
                    <SortHeader
                      label="MCP"
                      active={sortKey === 'name'}
                      dir={sortDir}
                      onClick={() => toggleSort('name')}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Tools</th>
                  <th className="px-4 py-3">
                    <SortHeader
                      label="Installed path"
                      active={sortKey === 'directory'}
                      dir={sortDir}
                      onClick={() => toggleSort('directory')}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {showEmpty ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-16">
                      <div className="flex flex-col items-center text-center max-w-sm mx-auto">
                        <div className="relative mb-5 text-zinc-600">
                          <Server size={48} strokeWidth={1.25} />
                          <span
                            className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white"
                          >
                            <Plus size={14} strokeWidth={2.5} />
                          </span>
                        </div>
                        <p className="text-base font-medium text-zinc-200">
                          No MCP servers configured
                        </p>
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
                    </td>
                  </tr>
                ) : showNoMatches ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-zinc-500">
                      No MCPs match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredMcps.map((row) => {
                    const isTesting = testing === row.name
                    const enabled = isEnabled(row)
                    return (
                      <Fragment key={row.name}>
                        <tr className="border-b border-zinc-900/80 hover:bg-zinc-900/40 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="text-zinc-100 font-medium">{row.name}</div>
                            <div className="flex items-center gap-0.5 mt-1">
                              <button
                                type="button"
                                onClick={() => void handleTest(row)}
                                disabled={isTesting}
                                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400 disabled:opacity-50"
                                title="Test connection"
                              >
                                {isTesting ? (
                                  <Loader2 size={15} strokeWidth={1.75} className="animate-spin" />
                                ) : (
                                  <FlaskConical size={15} strokeWidth={1.75} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEdit(row)}
                                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
                                title="Edit"
                              >
                                <Pencil size={15} strokeWidth={1.75} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(row)}
                                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400"
                                title="Delete"
                              >
                                <Trash size={15} strokeWidth={1.75} />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <button
                              type="button"
                              onClick={() =>
                                setToolsFor({
                                  name: row.name,
                                  status: row.status,
                                  tools: row.tools,
                                  error: row.error
                                })
                              }
                              className="text-zinc-300 hover:text-zinc-100 tabular-nums"
                              title="Open tools"
                            >
                              {row.tools.length}
                            </button>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className="font-mono text-xs text-zinc-500 max-w-[280px] truncate block"
                              title={row.configPath}
                            >
                              {configDir(row.configPath)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={cn(
                                  'text-xs px-2.5 py-0.5 rounded-full border capitalize',
                                  statusBadgeClass(enabled, row.status)
                                )}
                              >
                                {statusLabel(enabled, row.status)}
                              </span>
                              <Toggle
                                checked={enabled}
                                onChange={() => void handleToggleEnabled(row)}
                                title={enabled ? `Disable ${row.name}` : `Enable ${row.name}`}
                                ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${row.name}`}
                              />
                            </div>
                            {row.error && enabled && (
                              <p
                                className="text-[11px] text-red-400 max-w-[280px] line-clamp-2 mt-1"
                                title={row.error}
                              >
                                {row.error}
                              </p>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
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

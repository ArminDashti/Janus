import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
  FolderSymlink,
  Import,
  Info,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  Trash2
} from 'lucide-react'
import type { AppSettings, ProjectInfo } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { showMessage } from '@renderer/stores/messageStore'
import { FolderPickerModal } from '@renderer/components/FolderPickerModal'
import { SettingsSection } from '@renderer/components/settings/SettingsSection'
import { cn } from '@renderer/lib/utils'

interface ProjectImportSectionProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}

type ViewMode = 'list' | 'grid'

function parsePaths(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function ProjectRowMenu({ project, onRemove }: { project: ProjectInfo; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${project.name}`}
        aria-expanded={open}
        className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void navigator.clipboard?.writeText(project.path)
              void showMessage({ message: 'Path copied to clipboard', type: 'success' })
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Copy path
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-800"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

export function ProjectImportSection({ settings, onChange }: ProjectImportSectionProps) {
  const { loadSettings, refreshScan } = useAppStore()
  const [pathInput, setPathInput] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('list')

  const projects = useMemo(
    () => settings.projectRoots.flatMap((r) => r.projects).sort((a, b) => a.name.localeCompare(b.name)),
    [settings]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    )
  }, [projects, search])

  const importProjects = async () => {
    const paths = parsePaths(pathInput)
    if (paths.length === 0) {
      await showMessage({
        message: 'Enter one or more project paths (one per line).',
        type: 'error'
      })
      return
    }

    try {
      const result = await window.agentManager.importProjects(paths)
      await loadSettings()
      const updated = await window.agentManager.getSettings()
      onChange(updated)
      await refreshScan()
      setPathInput('')
      await showMessage({
        message: `Imported ${result.imported} project(s)`,
        type: 'success'
      })
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Import failed',
        type: 'error'
      })
    }
  }

  const removeProject = async (project: ProjectInfo) => {
    const confirmed = await showMessage({
      message: `Remove "${project.name}" from configured projects?`,
      confirm: true,
      type: 'error',
      title: 'Remove project'
    })
    if (!confirmed) return
    await window.agentManager.removeProject(project.id)
    await loadSettings()
    const updated = await window.agentManager.getSettings()
    onChange(updated)
    await refreshScan()
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={Import}
        title="Import projects"
        aside={
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 text-zinc-200"
          >
            <FolderOpen size={15} /> Browse…
          </button>
        }
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void importProjects()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg font-medium"
          >
            <Import size={15} /> Import projects
          </button>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Info size={13} /> One path per line
          </span>
        </div>
      </SettingsSection>

      <FolderPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          setPathInput((prev) => {
            const base = prev.replace(/\s+$/, '')
            return base ? `${base}\n${picked}` : picked
          })
          setPickerOpen(false)
        }}
      />

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-visible">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2.5">
            Imported projects
            <span className="rounded-full bg-zinc-800 text-zinc-300 text-xs font-normal px-2 py-0.5">
              {projects.length}
            </span>
          </h3>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="w-64 bg-zinc-950 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
              {(
                [
                  { id: 'list', icon: List, label: 'List view' },
                  { id: 'grid', icon: LayoutGrid, label: 'Grid view' }
                ] as Array<{ id: ViewMode; icon: typeof List; label: string }>
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setView(option.id)}
                  aria-label={option.label}
                  aria-pressed={view === option.id}
                  className={cn(
                    'p-1.5',
                    view === option.id
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  )}
                >
                  <option.icon size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">No projects imported yet.</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            No projects match “{search}”.
          </p>
        ) : view === 'list' ? (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 text-xs">
              <tr>
                <th className="px-5 py-2.5 font-medium w-1/3">Name</th>
                <th className="px-5 py-2.5 font-medium">Path</th>
                <th className="px-2 py-2.5 w-20 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr key={project.id} className="border-t border-zinc-800/70 hover:bg-zinc-800/30">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2.5 text-zinc-100 font-medium">
                      <FolderSymlink size={16} className="text-blue-400 shrink-0" />
                      <span className="truncate max-w-[16rem]">{project.name}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-500 font-mono text-xs truncate max-w-lg">
                    {project.path}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ProjectRowMenu
                        project={project}
                        onRemove={() => void removeProject(project)}
                      />
                      <button
                        type="button"
                        onClick={() => void removeProject(project)}
                        className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                        title="Remove"
                        aria-label={`Remove ${project.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 flex items-start gap-3 hover:border-zinc-600 transition-colors"
              >
                <span className="h-9 w-9 shrink-0 rounded-lg bg-blue-600/15 text-blue-400 flex items-center justify-center">
                  <FolderSymlink size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-100 truncate">{project.name}</p>
                  <p className="text-xs text-zinc-500 font-mono truncate" title={project.path}>
                    {project.path}
                  </p>
                </div>
                <ProjectRowMenu project={project} onRemove={() => void removeProject(project)} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

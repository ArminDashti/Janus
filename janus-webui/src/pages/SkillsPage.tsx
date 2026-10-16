import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Eye, EyeOff, File, FileCode, FileJson, FileText, Trash } from 'lucide-react'
import type { AppSettings, ResourceGroupSummary, SkillResource, UiSearchField } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { MarkdownEditor } from '@renderer/components/MarkdownEditor'
import { ProjectPanel } from '@renderer/components/resources/ProjectPanel'
import { BrowserColumn, browserRowClass } from '@renderer/components/layout/BrowserColumn'
import { ThreePanelLayout } from '@renderer/components/layout/ThreePanelLayout'
import { useAppStore } from '@renderer/stores/appStore'
import { showMessage } from '@renderer/stores/messageStore'
import { isMarkdownFile } from '@shared/utils.browser'

// ─── helpers ────────────────────────────────────────────────────────────────

function skillDisplayName(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? name
}

function fileBaseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh', 'bash', 'zsh', 'ps1',
  'yaml', 'yml', 'toml', 'jsonc', 'css', 'scss', 'html', 'sql', 'rb', 'go', 'rs'
])

/** Icon for a skill file based on its extension. */
function fileIcon(path: string): typeof File {
  const ext = fileBaseName(path).split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'mdx') return FileText
  if (ext === 'json') return FileJson
  if (CODE_EXTENSIONS.has(ext)) return FileCode
  return File
}

// ─── Left: skill list ───────────────────────────────────────────────────────

interface SkillListProps {
  skills: ResourceGroupSummary[]
  loading: boolean
  selectedName: string | null
  onSelect: (name: string) => void
  onDelete: (row: ResourceGroupSummary) => void
  hiddenSkills: string[]
  onToggleHidden: (row: ResourceGroupSummary) => void
  hiddenCount: number
  showHidden: boolean
  onShowHiddenChange: (show: boolean) => void
  search: string
  onSearch: (v: string) => void
  searchField: UiSearchField
  onSearchFieldChange: (f: UiSearchField) => void
  collapseToggle?: ReactNode
}

function SkillList({
  skills,
  loading,
  selectedName,
  onSelect,
  onDelete,
  hiddenSkills,
  onToggleHidden,
  hiddenCount,
  showHidden,
  onShowHiddenChange,
  search,
  onSearch,
  searchField,
  onSearchFieldChange,
  collapseToggle
}: SkillListProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const shown = sortDir === 'asc' ? skills : [...skills].reverse()

  return (
    <BrowserColumn
      title="Skills"
      countLabel={String(skills.length)}
      actions={
        <>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => onShowHiddenChange(!showHidden)}
              aria-pressed={showHidden}
              title={showHidden ? 'Hide hidden skills' : `Show hidden skills (${hiddenCount})`}
              className="p-1.5 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          {collapseToggle}
        </>
      }
      search={search}
      onSearch={onSearch}
      searchPlaceholder="Search skills..."
      nameHeader={{
        searchField,
        onSearchFieldChange,
        sortDir,
        onToggleSort: () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      }}
    >
      {loading && skills.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500 text-center">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500 text-center">No skills found</p>
      ) : (
        shown.map((s) => {
          const key = skillDisplayName(s.name)
          const isSelected = key === selectedName
          const isHidden = hiddenSkills.includes(key)
          return (
            <div key={key} className={cn(browserRowClass(isSelected), isHidden && 'opacity-50')}>
              <button
                type="button"
                onClick={() => onSelect(key)}
                className="flex-1 min-w-0 text-left px-2.5 py-1.5 text-[13px] truncate"
                title={s.name}
              >
                {skillDisplayName(s.name)}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleHidden(s)
                }}
                className={cn(
                  'p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                  isSelected
                    ? 'text-white/70 hover:text-white hover:bg-white/10'
                    : 'text-zinc-600 hover:text-zinc-200 hover:bg-zinc-700/60'
                )}
                title={isHidden ? `Unhide ${key}` : `Hide ${key}`}
              >
                {isHidden ? <Eye size={12} strokeWidth={1.75} /> : <EyeOff size={12} strokeWidth={1.75} />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(s)
                }}
                className={cn(
                  'p-1.5 mr-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                  isSelected
                    ? 'text-white/70 hover:text-white hover:bg-white/10'
                    : 'text-zinc-600 hover:text-red-400 hover:bg-zinc-700/60'
                )}
                title={`Delete ${skillDisplayName(s.name)}`}
              >
                <Trash size={12} strokeWidth={1.75} />
              </button>
            </div>
          )
        })
      )}
    </BrowserColumn>
  )
}

// ─── Skill file state (shared by the Files panel and the content view) ─────

/** Loads one skill and tracks which of its files is open. */
function useSkillFile(skillName: string | null) {
  const [resource, setResource] = useState<SkillResource | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async (name: string) => {
    setLoading(true)
    setNotFound(false)
    try {
      const canonical = await window.agentManager.getCanonicalResource('skill', name)
      if (!canonical) {
        setResource(null)
        setNotFound(true)
        return
      }
      const skill = canonical as SkillResource
      setResource(skill)
      const file = skill.skillMdPath || skill.files[0] || ''
      setSelectedFile(file || null)
      setContent(file ? await window.agentManager.readFile(file) : '')
    } catch {
      setResource(null)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (skillName) void load(skillName)
    else {
      setResource(null)
      setSelectedFile(null)
      setContent('')
      setNotFound(false)
    }
  }, [skillName, load])

  const openFile = async (path: string) => {
    setSelectedFile(path)
    setContent(await window.agentManager.readFile(path))
  }

  const removeFile = async (path: string) => {
    if (!skillName) return
    await window.agentManager.deleteSkillFile(skillName, path)
    await load(skillName)
  }

  const saveFile = async (filePath: string, value: string) => {
    const confirmed = await showMessage({
      message: `Save changes to ${fileBaseName(filePath)}?`,
      confirm: true
    })
    if (!confirmed) return
    const isSkillMd = fileBaseName(filePath) === 'SKILL.md'
    if (isSkillMd && skillName) {
      const { filePath: savedPath } = await window.agentManager.writeSkillMd(
        filePath,
        value,
        skillName
      )
      if (savedPath !== filePath) setSelectedFile(savedPath)
    } else {
      await window.agentManager.writeFile(filePath, value)
    }
  }

  return {
    resource,
    selectedFile,
    content,
    setContent,
    loading,
    notFound,
    openFile,
    saveFile,
    removeFile
  }
}

type SkillFileState = ReturnType<typeof useSkillFile>

// ─── Files panel: one row per file in the selected skill ───────────────────

interface SkillFilesProps {
  files: string[]
  selectedFile: string | null
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  collapseToggle?: ReactNode
}

function SkillFiles({ files, selectedFile, onSelect, onDelete, collapseToggle }: SkillFilesProps) {
  return (
    <aside className="w-full h-full flex flex-col bg-surface">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-zinc-100">Files</h2>
        <span className="text-[11px] leading-none px-1.5 py-1 rounded-md bg-zinc-800 text-zinc-400 tabular-nums">
          {files.length}
        </span>
        {collapseToggle && <div className="ml-auto flex items-center gap-0.5">{collapseToggle}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {files.map((f) => {
          const Icon = fileIcon(f)
          const isSelected = f === selectedFile
          const isSkillMd = fileBaseName(f) === 'SKILL.md'
          return (
            <div key={f} className={browserRowClass(isSelected)}>
              <button
                type="button"
                onClick={() => onSelect(f)}
                title={f}
                className="flex-1 min-w-0 flex items-center gap-2 text-left px-2.5 py-1.5 text-[13px]"
              >
                <Icon size={12} className="shrink-0" />
                <span className="truncate">{fileBaseName(f)}</span>
              </button>
              {!isSkillMd && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(f)
                  }}
                  className={cn(
                    'p-1.5 mr-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                    isSelected
                      ? 'text-white/70 hover:text-white hover:bg-white/10'
                      : 'text-zinc-600 hover:text-red-400 hover:bg-zinc-700/60'
                  )}
                  title={`Delete ${fileBaseName(f)}`}
                >
                  <Trash size={12} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

// ─── Content: the open file ─────────────────────────────────────────────────

/** Tab strip of a skill's files, used where no Files panel exists. */
function SkillFileTabs({ file }: { file: SkillFileState }) {
  const files = file.resource?.files ?? []
  if (files.length <= 1) return null
  return (
    <div className="flex gap-1 px-2 py-1.5 border-b border-surface-border overflow-x-auto shrink-0 bg-surface">
      {files.map((f) => {
        const Icon = fileIcon(f)
        return (
          <button
            key={f}
            type="button"
            onClick={() => void file.openFile(f)}
            title={f}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-[13px] rounded whitespace-nowrap transition-colors',
              f === file.selectedFile
                ? 'bg-blue-600/20 text-blue-300'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            )}
          >
            <Icon size={12} className="shrink-0" />
            {fileBaseName(f)}
          </button>
        )
      })}
    </div>
  )
}

function SkillFileView({ skillName, file }: { skillName: string | null; file: SkillFileState }) {
  if (!skillName) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
        <FileText size={24} className="text-zinc-600" />
        <p className="text-sm text-zinc-500">Select a skill to view its content</p>
      </div>
    )
  }

  if (file.loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Loading skill content…
      </div>
    )
  }

  if (file.notFound || !file.resource) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Skill content not found
      </div>
    )
  }

  const { selectedFile, content } = file
  const editable =
    selectedFile != null && (isMarkdownFile(selectedFile) || selectedFile.endsWith('.py'))

  return (
    <div className="h-full min-h-0 overflow-hidden">
      {!selectedFile ? (
        <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
          Select a file
        </div>
      ) : editable ? (
        <MarkdownEditor
          key={selectedFile}
          filePath={selectedFile}
          value={content}
          onChange={file.setContent}
          onSave={(v) => file.saveFile(selectedFile, v)}
        />
      ) : (
        <pre className="h-full overflow-auto text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg p-3 whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  )
}

interface SkillDocumentProps {
  skillName: string | null
  file: SkillFileState
  collapseToggle?: ReactNode
  /** Optional strip rendered above the file content. */
  children?: ReactNode
}

function SkillDocument({ skillName, file, collapseToggle, children }: SkillDocumentProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex justify-end px-2 py-1.5 border-b border-surface-border shrink-0 bg-surface">
        {collapseToggle}
      </div>
      {children}
      <div className="flex-1 min-h-0">
        <SkillFileView skillName={skillName} file={file} />
      </div>
    </div>
  )
}

/** Right panel used by the Projects page: skill content with its file tabs. */
export function SkillContent({
  skillName,
  collapseToggle
}: {
  skillName: string | null
  collapseToggle?: ReactNode
}) {
  const file = useSkillFile(skillName)
  return (
    <SkillDocument skillName={skillName} file={file} collapseToggle={collapseToggle}>
      <SkillFileTabs file={file} />
    </SkillDocument>
  )
}

// ─── Main SkillsPage: three-pane layout (+ Files panel when a skill has files) ─

export function SkillsPage() {
  const { refreshScan, settings, loadSettings } = useAppStore()
  const hiddenSkills = settings?.hiddenSkills ?? []
  const showHiddenSkills = settings?.showHiddenSkills ?? false
  const [skills, setSkills] = useState<ResourceGroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchField, setSearchField] = useState<UiSearchField>('name')
  const skillFile = useSkillFile(selected)
  const files = skillFile.resource?.files ?? []
  const showFiles = files.length > 1

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft && skills.length > 0
    if (!soft) setLoading(true)
    try {
      const stats = await window.agentManager.getResourceStats('skill')
      setSkills(stats)
      // Auto-select first skill on initial load
      if (!soft && stats.length > 0) {
        setSelected((prev) => prev ?? skillDisplayName(stats[0].name))
      }
    } finally {
      if (!soft) setLoading(false)
    }
  }, [skills.length])

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => void load({ soft: true })
    window.addEventListener('scan-changed', handler)
    return () => window.removeEventListener('scan-changed', handler)
  }, [load])

  const hiddenCount = skills.filter((s) => hiddenSkills.includes(skillDisplayName(s.name))).length

  const saveHiddenSettings = (patch: Partial<AppSettings>) => {
    if (!settings) return
    void window.agentManager.saveSettings({ ...settings, ...patch }).then(() => loadSettings())
  }

  const toggleHidden = (row: ResourceGroupSummary) => {
    const key = skillDisplayName(row.name)
    const next = hiddenSkills.includes(key)
      ? hiddenSkills.filter((n) => n !== key)
      : [...hiddenSkills, key]
    saveHiddenSettings({ hiddenSkills: next })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const visible = showHiddenSkills
      ? skills
      : skills.filter((s) => !hiddenSkills.includes(skillDisplayName(s.name)))
    const list = q
      ? visible.filter((s) => {
          const haystack =
            searchField === 'tags'
              ? (s.tags ?? []).join(' ')
              : searchField === 'category'
                ? (s.category ?? '')
                : `${s.name} ${s.description}`
          return haystack.toLowerCase().includes(q)
        })
      : visible
    return [...list].sort((a, b) =>
      skillDisplayName(a.name).localeCompare(skillDisplayName(b.name))
    )
  }, [skills, search, searchField, showHiddenSkills, hiddenSkills])

  const handleDelete = useCallback(
    async (row: ResourceGroupSummary) => {
      const key = skillDisplayName(row.name)
      const confirmed = await showMessage({
        message: `Delete "${skillDisplayName(row.name)}" from all locations? Items are kept under .trash.`,
        confirm: true,
        type: 'error',
        title: 'Delete skill'
      })
      if (!confirmed) return
      try {
        await window.agentManager.deleteResource('skill', key)
        if (key === selected) setSelected(null)
        await load({ soft: true })
        refreshScan()
      } catch (e) {
        await showMessage({
          message: e instanceof Error ? e.message : 'Delete failed',
          type: 'error'
        })
      }
    },
    [selected, load, refreshScan]
  )

  const handleDeleteFile = async (path: string) => {
    const confirmed = await showMessage({
      message: `Delete "${fileBaseName(path)}"? It is kept under .trash.`,
      confirm: true,
      type: 'error',
      title: 'Delete file'
    })
    if (!confirmed) return
    try {
      await skillFile.removeFile(path)
      refreshScan()
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Delete failed',
        type: 'error'
      })
    }
  }

  // Separate key and autosave id: the panel set differs, so layouts must not be shared.
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ThreePanelLayout
        key={showFiles ? 'with-files' : 'without-files'}
        autoSaveId={showFiles ? 'skills-files-three-panel-v1' : 'skills-three-panel-v2'}
        defaultLeftSize={22}
        defaultMiddleSize={24}
        titles={{ left: 'Skills', middle: 'Projects', files: 'Files', right: 'Skill' }}
        left={(collapseToggle) => (
          <SkillList
            skills={filtered}
            loading={loading}
            selectedName={selected}
            onSelect={setSelected}
            onDelete={(row) => void handleDelete(row)}
            hiddenSkills={hiddenSkills}
            onToggleHidden={toggleHidden}
            hiddenCount={hiddenCount}
            showHidden={showHiddenSkills}
            onShowHiddenChange={(show) => saveHiddenSettings({ showHiddenSkills: show })}
            search={search}
            onSearch={setSearch}
            searchField={searchField}
            onSearchFieldChange={setSearchField}
            collapseToggle={collapseToggle}
          />
        )}
        middle={(collapseToggle) => (
          <ProjectPanel
            resourceType="skill"
            resourceName={selected}
            resourceLabel="skill"
            onRefresh={() => void refreshScan()}
            onRemovedFromAllProjects={() => {
              setSelected(null)
              void load({ soft: true })
            }}
            collapseToggle={collapseToggle}
          />
        )}
        files={
          showFiles
            ? (collapseToggle) => (
                <SkillFiles
                  files={files}
                  selectedFile={skillFile.selectedFile}
                  onSelect={(path) => void skillFile.openFile(path)}
                  onDelete={(path) => void handleDeleteFile(path)}
                  collapseToggle={collapseToggle}
                />
              )
            : undefined
        }
        right={(collapseToggle) => (
          <SkillDocument
            skillName={selected}
            file={skillFile}
            collapseToggle={collapseToggle}
          />
        )}
      />
    </div>
  )
}

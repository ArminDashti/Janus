import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderGit2 } from 'lucide-react'
import type { ProjectInfo, ResourceGroupSummary, UiSearchField } from '@shared/types'
import { BrowserColumn, browserRowClass } from '@renderer/components/layout/BrowserColumn'
import { ThreePanelLayout } from '@renderer/components/layout/ThreePanelLayout'
import { SkillPanel } from '@renderer/components/resources/SkillPanel'
import { SkillContent } from '@renderer/pages/SkillsPage'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'

// ─── Left: project list ─────────────────────────────────────────────────────

interface ProjectListProps {
  projects: ProjectInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearch: (v: string) => void
  collapseToggle?: ReactNode
}

function ProjectList({
  projects,
  selectedId,
  onSelect,
  search,
  onSearch,
  collapseToggle
}: ProjectListProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    const list = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
        )
      : projects
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [projects, q])
  const shown = sortDir === 'asc' ? filtered : [...filtered].reverse()

  return (
    <BrowserColumn
      title="Projects"
      countLabel={String(projects.length)}
      actions={collapseToggle}
      search={search}
      onSearch={onSearch}
      searchPlaceholder="Search projects..."
      nameHeader={{
        searchField: 'name' as UiSearchField,
        onSearchFieldChange: () => {},
        sortDir,
        onToggleSort: () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      }}
    >
      {projects.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500 text-center">No projects found</p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500 text-center">No projects match search</p>
      ) : (
        shown.map((p) => {
          const isSelected = p.id === selectedId
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              title={p.path}
              className={cn(browserRowClass(isSelected), 'w-full text-left px-2.5 py-1.5 text-[13px] truncate')}
            >
              {p.name}
            </button>
          )
        })
      )}
    </BrowserColumn>
  )
}

// ─── Main ProjectsPage: three-pane (mirror of SkillsPage, swapped axes) ─────

export function ProjectsPage() {
  const { settings, setPage, refreshScan } = useAppStore()
  const [skills, setSkills] = useState<ResourceGroupSummary[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const projects = useMemo(
    () =>
      settings?.projectRoots
        .flatMap((r) => r.projects)
        .sort((a, b) => a.name.localeCompare(b.name)) ?? [],
    [settings]
  )

  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  const loadSkills = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft && skills.length > 0
    if (!soft) setSkillsLoading(true)
    try {
      const stats = await window.agentManager.getResourceStats('skill')
      setSkills(stats)
    } finally {
      if (!soft) setSkillsLoading(false)
    }
  }, [skills.length])

  useEffect(() => {
    void loadSkills()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => void loadSkills({ soft: true })
    window.addEventListener('scan-changed', handler)
    return () => window.removeEventListener('scan-changed', handler)
  }, [loadSkills])

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null)
      return
    }
    if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId || skills.length === 0) return
    setSelectedSkill((prev) => {
      if (prev) return prev
      const first = skills[0].name.replace(/\\/g, '/').split('/').filter(Boolean).pop()
      return first ?? null
    })
  }, [selectedProjectId, skills])

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <FolderGit2 size={32} className="text-zinc-600" />
        <p className="text-zinc-300 font-medium">No projects imported</p>
        <p className="text-sm text-zinc-500 max-w-sm">
          Import projects under Settings → Projects, then return here to assign skills per
          project.
        </p>
        <button
          type="button"
          onClick={() => setPage('settings')}
          className="mt-2 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded"
        >
          Open Settings
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ThreePanelLayout
        autoSaveId="projects-three-panel-v1"
        defaultLeftSize={22}
        defaultMiddleSize={24}
        titles={{ left: 'Projects', middle: 'Skills', right: 'Skill' }}
        left={(collapseToggle) => (
          <ProjectList
            projects={projects}
            selectedId={selectedProjectId}
            onSelect={setSelectedProjectId}
            search={search}
            onSearch={setSearch}
            collapseToggle={collapseToggle}
          />
        )}
        middle={(collapseToggle) => (
          <SkillPanel
            projectId={selectedProjectId}
            projectLabel={selectedProject?.name ?? 'project'}
            skills={skills}
            loading={skillsLoading}
            selectedSkillName={selectedSkill}
            onSelectSkill={setSelectedSkill}
            onSkillsChange={() => void loadSkills({ soft: true })}
            onRefresh={() => void refreshScan()}
            collapseToggle={collapseToggle}
          />
        )}
        right={(collapseToggle) => (
          <SkillContent skillName={selectedSkill} collapseToggle={collapseToggle} />
        )}
      />
    </div>
  )
}

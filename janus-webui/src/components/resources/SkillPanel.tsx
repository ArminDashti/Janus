import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, EyeOff, FileText, Search } from 'lucide-react'
import type { ResourceGroupSummary } from '@shared/types'
import { Toggle } from '@renderer/components/Toggle'
import { cn } from '@renderer/lib/utils'
import { showMessage } from '@renderer/stores/messageStore'
import { useAppStore } from '@renderer/stores/appStore'

function skillDisplayName(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? name
}

interface SkillPanelProps {
  projectId: string | null
  projectLabel: string
  skills: ResourceGroupSummary[]
  loading: boolean
  selectedSkillName: string | null
  onSelectSkill: (name: string) => void
  onSkillsChange: () => void
  onRefresh?: () => void
  /** Panel collapse toggle, rendered at the end of the header row. */
  collapseToggle?: ReactNode
}

/**
 * Middle panel: per-skill assignment toggles for one project (inverse of ProjectPanel).
 */
export function SkillPanel({
  projectId,
  projectLabel,
  skills,
  loading,
  selectedSkillName,
  onSelectSkill,
  onSkillsChange,
  onRefresh,
  collapseToggle
}: SkillPanelProps) {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [skillSearch, setSkillSearch] = useState('')
  const [assigningAll, setAssigningAll] = useState(false)
  const { settings, loadSettings } = useAppStore()
  const hiddenSkills = settings?.hiddenSkills ?? []
  const showHiddenSkills = settings?.showHiddenSkills ?? false
  const hiddenCount = skills.filter((s) => hiddenSkills.includes(skillDisplayName(s.name))).length
  const listedSkills = useMemo(
    () =>
      showHiddenSkills
        ? skills
        : skills.filter((s) => !hiddenSkills.includes(skillDisplayName(s.name))),
    [skills, hiddenSkills, showHiddenSkills]
  )

  const toggleShowHidden = () => {
    if (!settings) return
    void window.agentManager
      .saveSettings({ ...settings, showHiddenSkills: !showHiddenSkills })
      .then(() => loadSettings())
  }

  useEffect(() => {
    setSkillSearch('')
    setPending({})
  }, [projectId])

  const effectiveAssigned = useMemo(() => {
    const base: Record<string, boolean> = {}
    for (const s of skills) {
      const key = skillDisplayName(s.name)
      base[key] = projectId ? s.assignedProjectIds.includes(projectId) : false
    }
    for (const [key, val] of Object.entries(pending)) base[key] = val
    return base
  }, [skills, projectId, pending])

  const assignedCount = useMemo(
    () => listedSkills.filter((s) => effectiveAssigned[skillDisplayName(s.name)]).length,
    [listedSkills, effectiveAssigned]
  )

  const toggle = async (skill: ResourceGroupSummary) => {
    if (!projectId) return
    const resourceName = skillDisplayName(skill.name)
    const next = !effectiveAssigned[resourceName]
    const clearPending = () =>
      setPending((p) => {
        const n = { ...p }
        delete n[resourceName]
        return n
      })

    // Optimistic: flip the switch before any await so it reacts instantly.
    setPending((p) => ({ ...p, [resourceName]: next }))
    try {
      const matrix = await window.agentManager.getProjectMatrix('skill', resourceName)
      const projectRows = matrix.filter((r) => !r.platformId)

      const nextAssigned: Record<string, boolean> = {}
      for (const r of projectRows) {
        nextAssigned[r.projectId] =
          r.projectId === projectId ? next : skill.assignedProjectIds.includes(r.projectId)
      }

      if (!next && !Object.values(nextAssigned).some(Boolean)) {
        const confirmed = await showMessage({
          title: 'Remove skill',
          message: `This is the only project using "${resourceName}". Unassigning it removes the skill from all projects and it will disappear from the list.`,
          confirm: true,
          type: 'error'
        })
        if (!confirmed) {
          clearPending()
          return
        }
      }

      const assignedIds = Object.entries(nextAssigned)
        .filter(([, v]) => v)
        .map(([k]) => k)
      await window.agentManager.applyProjectAssignment('skill', resourceName, assignedIds)
      const mandatory =
        projectRows.length > 0 && projectRows.every((r) => nextAssigned[r.projectId])
      await window.agentManager.setMandatory('skill', resourceName, mandatory)
      onRefresh?.()
      onSkillsChange()
      clearPending()
    } catch (e) {
      clearPending()
      await showMessage({
        message: e instanceof Error ? e.message : 'Save failed',
        type: 'error'
      })
    }
  }

  const setAllAssigned = async (next: boolean) => {
    if (!projectId) return
    const assignedSkills = skills.filter((s) => s.assignedProjectIds.includes(projectId))
    if (!next) {
      const confirmed = await showMessage({
        title: 'Remove skills',
        message: `Unassigning every skill from this project. Skills used only by this project will disappear from the list.`,
        confirm: true,
        type: 'error'
      })
      if (!confirmed) return
    }
    setAssigningAll(true)
    try {
      if (next) {
        await window.agentManager.assignAllSkillsToProject(projectId)
      } else {
        for (const skill of assignedSkills) {
          const name = skillDisplayName(skill.name)
          const remaining = skill.assignedProjectIds.filter((id) => id !== projectId)
          await window.agentManager.applyProjectAssignment('skill', name, remaining)
          await window.agentManager.setMandatory('skill', name, false)
        }
      }
      onRefresh?.()
      onSkillsChange()
    } catch (e) {
      await showMessage({
        message: e instanceof Error ? e.message : 'Assign all failed',
        type: 'error'
      })
    } finally {
      setAssigningAll(false)
    }
  }

  const visibleSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase()
    const sorted = [...listedSkills].sort((a, b) =>
      skillDisplayName(a.name).localeCompare(skillDisplayName(b.name))
    )
    if (!q) return sorted
    return sorted.filter((s) => {
      const haystack = `${s.name} ${s.description} ${(s.tags ?? []).join(' ')}`
      return haystack.toLowerCase().includes(q)
    })
  }, [listedSkills, skillSearch])

  return (
    <aside className="w-full h-full flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-zinc-400">
            Skills · {assignedCount}/{listedSkills.length}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              {assigningAll ? 'Saving…' : 'Assign all'}
            </span>
            <Toggle
              checked={skills.length > 0 && assignedCount === skills.length}
              onChange={(next) => void setAllAssigned(next)}
              disabled={!projectId || assigningAll || skills.length === 0}
              ariaLabel="Assign all skills"
              title={`Assign every skill to ${projectLabel}`}
            />
            {collapseToggle}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1 min-w-0">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              placeholder="Filter skills…"
              disabled={!projectId}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 pl-6 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            />
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={toggleShowHidden}
              aria-pressed={showHiddenSkills}
              title={showHiddenSkills ? 'Hide hidden skills' : `Show hidden skills (${hiddenCount})`}
              className="shrink-0 p-1.5 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {showHiddenSkills ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {!projectId ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
            <FileText size={20} className="text-zinc-600" />
            <p className="text-xs text-zinc-500">
              Select a {projectLabel} to choose which skills it uses
            </p>
          </div>
        ) : loading ? (
          <p className="px-3 py-4 text-xs text-zinc-500 text-center">Loading skills…</p>
        ) : skills.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-500 text-center">No skills found</p>
        ) : visibleSkills.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-500 text-center">No skills match filter</p>
        ) : (
          visibleSkills.map((skill) => {
            const key = skillDisplayName(skill.name)
            const assigned = effectiveAssigned[key] ?? false
            const isSelected = key === selectedSkillName
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center justify-between gap-2 px-2 py-1 mx-1 rounded-md transition-colors',
                  isSelected ? 'bg-blue-600/15' : assigned ? 'bg-zinc-900' : 'hover:bg-zinc-800/60'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectSkill(key)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left px-1 py-1"
                  title={skill.name}
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      assigned ? 'bg-emerald-500' : 'bg-zinc-600'
                    )}
                  />
                  <span
                    className={cn(
                      'text-xs truncate',
                      isSelected ? 'text-blue-300' : 'text-zinc-200'
                    )}
                  >
                    {key}
                  </span>
                </button>
                <Toggle
                  checked={assigned}
                  onChange={() => void toggle(skill)}
                  title={
                    assigned ? `Remove skill from ${projectLabel}` : `Use skill for ${projectLabel}`
                  }
                />
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { FileText, RefreshCw, Search } from 'lucide-react'
import type { ResourceGroupSummary } from '@shared/types'
import { Toggle } from '@renderer/components/Toggle'
import { cn } from '@renderer/lib/utils'
import { showMessage } from '@renderer/stores/messageStore'

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
  onRefresh
}: SkillPanelProps) {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [skillSearch, setSkillSearch] = useState('')
  const [assigningAll, setAssigningAll] = useState(false)

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
    () => Object.values(effectiveAssigned).filter(Boolean).length,
    [effectiveAssigned]
  )

  const toggle = async (skill: ResourceGroupSummary) => {
    if (!projectId) return
    const resourceName = skillDisplayName(skill.name)
    const next = !effectiveAssigned[resourceName]

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
      if (!confirmed) return
    }

    setPending((p) => ({ ...p, [resourceName]: next }))
    setSaving(resourceName)
    try {
      const assignedIds = Object.entries(nextAssigned)
        .filter(([, v]) => v)
        .map(([k]) => k)
      await window.agentManager.applyProjectAssignment('skill', resourceName, assignedIds)
      const mandatory =
        projectRows.length > 0 && projectRows.every((r) => nextAssigned[r.projectId])
      await window.agentManager.setMandatory('skill', resourceName, mandatory)
      onRefresh?.()
      onSkillsChange()
      setPending((p) => {
        const n = { ...p }
        delete n[resourceName]
        return n
      })
    } catch (e) {
      setPending((p) => {
        const n = { ...p }
        delete n[resourceName]
        return n
      })
      await showMessage({
        message: e instanceof Error ? e.message : 'Save failed',
        type: 'error'
      })
    } finally {
      setSaving(null)
    }
  }

  const assignAll = async () => {
    if (!projectId) return
    setAssigningAll(true)
    try {
      await window.agentManager.assignAllSkillsToProject(projectId)
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
    const sorted = [...skills].sort((a, b) =>
      skillDisplayName(a.name).localeCompare(skillDisplayName(b.name))
    )
    if (!q) return sorted
    return sorted.filter((s) => {
      const haystack = `${s.name} ${s.description} ${(s.tags ?? []).join(' ')}`
      return haystack.toLowerCase().includes(q)
    })
  }, [skills, skillSearch])

  return (
    <aside className="w-full h-full flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-zinc-400">
            Skills · {assignedCount}/{skills.length}
          </h2>
          <button
            type="button"
            onClick={() => void assignAll()}
            disabled={!projectId || assigningAll || assignedCount === skills.length}
            title={`Assign every skill to ${projectLabel}`}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {assigningAll ? 'Assigning…' : 'Assign all'}
          </button>
        </div>
        <div className="relative mt-2">
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
            const isSaving = saving === key
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
                {isSaving ? (
                  <RefreshCw size={14} className="animate-spin text-zinc-500 shrink-0" />
                ) : (
                  <Toggle
                    checked={assigned}
                    onChange={() => void toggle(skill)}
                    title={
                      assigned
                        ? `Remove skill from ${projectLabel}`
                        : `Use skill for ${projectLabel}`
                    }
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

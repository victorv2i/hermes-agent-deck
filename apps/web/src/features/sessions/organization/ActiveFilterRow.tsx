import { X } from 'lucide-react'
import type { Project } from '@agent-deck/protocol'
import { ProjectDot } from './ProjectDot'
import type { OrganizationFilter } from './organizationFilter'

/**
 * The active-filter summary row: small pills naming the current Project and/or
 * #tag, each individually clearable, plus a "Clear all" affordance. Renders
 * NOTHING when no filter is active, so the rail stays clean by default. Sits
 * just above the list so it's always clear WHY the list is scoped.
 */
export function ActiveFilterRow({
  filter,
  projects,
  onClearProject,
  onClearTag,
  onClearAll,
}: {
  filter: OrganizationFilter
  projects: Project[]
  onClearProject: () => void
  onClearTag: () => void
  onClearAll: () => void
}) {
  const project = filter.projectId
    ? (projects.find((p) => p.id === filter.projectId) ?? null)
    : null
  const hasProject = filter.projectId !== null
  const hasTag = filter.tag !== null
  if (!hasProject && !hasTag) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5" aria-label="Active filters">
      {hasProject && (
        <FilterPill onClear={onClearProject} clearLabel="Clear folder filter">
          {project && <ProjectDot color={project.color} />}
          <span className="truncate">{project ? project.name : 'Unknown folder'}</span>
        </FilterPill>
      )}
      {hasTag && (
        <FilterPill onClear={onClearTag} clearLabel={`Clear tag filter #${filter.tag}`}>
          <span className="truncate">#{filter.tag}</span>
        </FilterPill>
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-0.5 rounded px-1 py-0.5 text-[11px] text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
      >
        Clear all
      </button>
    </div>
  )
}

/** One removable filter pill: content + a small × clear control. */
function FilterPill({
  children,
  onClear,
  clearLabel,
}: {
  children: React.ReactNode
  onClear: () => void
  clearLabel: string
}) {
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1 rounded-md border border-border bg-surface-2/60 py-0.5 pr-0.5 pl-1.5 text-[11px] text-foreground/90">
      <span className="flex min-w-0 items-center gap-1">{children}</span>
      <button
        type="button"
        aria-label={clearLabel}
        title={clearLabel}
        onClick={onClear}
        className="rounded p-0.5 text-foreground-tertiary transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ad-focus"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )
}

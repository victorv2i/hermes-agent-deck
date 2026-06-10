import { useState } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Project } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { ProjectDot } from './ProjectDot'
import { NewProjectForm } from './NewProjectForm'

/**
 * The collapsible PROJECTS section at the top of the sessions pane. It's a
 * single-select filter — a real `radiogroup` of "All sessions" (the default) +
 * each project (colored dot · name · count). Selecting a project filters the
 * rail to its sessions; "All sessions" clears the project filter. A quiet
 * "+ New project" opens a popover with the name + curated-palette color form.
 *
 * Color = the categorical project hue (a `var(--cat-…)` dot), never amber — that
 * is the project's own identity, not a selection signal. The SELECTED row reuses
 * the canonical amber active-row treatment (a faint amber tint + a 3px amber
 * leading accent bar + bold label), exactly matching the Sidebar nav and the
 * session rows, so "which row is active" reads identically everywhere.
 */
export interface ProjectsSectionProps {
  projects: Project[]
  /** The active project filter (null = "All sessions"). */
  selectedProjectId: string | null
  /** Select a project to filter by, or null for "All sessions". */
  onSelectProject: (projectId: string | null) => void
  /** Per-project loaded-session counts (absent = 0). Read-only here. */
  counts: ReadonlyMap<string, number>
  /** Total loaded sessions (the "All sessions" count). */
  totalCount: number
  /** Create a project; resolves when the mutation settles (closes the popover). */
  onCreateProject: (input: { name: string; color: string }) => Promise<void>
  /**
   * Phase 2 — drag-to-organize. When wired, each folder row becomes a native
   * drop target: dragging a session row onto a folder assigns it (the "All
   * sessions" row removes it from any folder, projectId = null). The keyboard +
   * screen-reader path stays the row's "Move to folder" menu; drag is a
   * pointer-only accelerator. Omitted ⇒ the rows are not drop targets.
   */
  onDropSession?: (projectId: string | null, sessionId: string) => void
}

/** The dataTransfer MIME type carrying a dragged session id, so only Agent Deck
 * session drags (not arbitrary text/files) are accepted as folder drops. */
export const SESSION_DRAG_TYPE = 'application/x-agent-deck-session'

export function ProjectsSection({
  projects,
  selectedProjectId,
  onSelectProject,
  counts,
  totalCount,
  onCreateProject,
  onDropSession,
}: ProjectsSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(input: { name: string; color: string }) {
    setBusy(true)
    setError(null)
    try {
      await onCreateProject(input)
      setCreating(false)
    } catch {
      setError("Couldn't create the folder. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Folders" className="flex flex-col">
      <div className="flex items-center justify-between pr-1">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="ad-section-label flex items-center gap-1 rounded px-2 py-1.5 text-left transition-colors hover:text-foreground focus-visible:ad-focus"
        >
          {collapsed ? (
            <ChevronRight className="size-3" aria-hidden />
          ) : (
            <ChevronDown className="size-3" aria-hidden />
          )}
          Folders
        </button>

        <Popover.Root
          open={creating}
          onOpenChange={(next) => {
            setCreating(next)
            if (!next) setError(null)
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="New folder"
              title="New folder"
              className="rounded-md p-1 text-foreground-tertiary transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ad-focus"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              side="bottom"
              sideOffset={6}
              className="ad-surface z-50 w-60 rounded-xl bg-popover p-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              <NewProjectForm
                onCreate={handleCreate}
                onCancel={() => setCreating(false)}
                busy={busy}
                error={error}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {!collapsed && (
        <div role="radiogroup" aria-label="Filter sessions by folder" className="flex flex-col">
          <ProjectFilterRow
            label="All sessions"
            count={totalCount}
            selected={selectedProjectId === null}
            onSelect={() => onSelectProject(null)}
            // Dropping a session on "All sessions" removes it from any folder.
            onDropSession={onDropSession ? (id) => onDropSession(null, id) : undefined}
          />
          {projects.map((project) => (
            <ProjectFilterRow
              key={project.id}
              label={project.name}
              color={project.color}
              count={counts.get(project.id) ?? 0}
              selected={selectedProjectId === project.id}
              onSelect={() => onSelectProject(project.id)}
              onDropSession={onDropSession ? (id) => onDropSession(project.id, id) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** One selectable project filter (an ARIA `radio`). "All sessions" omits the dot.
 * When `onDropSession` is wired the row also accepts a dragged session as a native
 * drop target (Phase 2), showing a border-strong ring while a session hovers. */
function ProjectFilterRow({
  label,
  color,
  count,
  selected,
  onSelect,
  onDropSession,
}: {
  label: string
  color?: string
  count: number
  selected: boolean
  onSelect: () => void
  /** Assign the dropped session id to this row's folder. Omitted ⇒ not a drop target. */
  onDropSession?: (sessionId: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const dropProps = onDropSession
    ? {
        onDragOver: (e: React.DragEvent) => {
          // Only react to a session drag (not text/files); accept = preventDefault.
          if (!e.dataTransfer.types.includes(SESSION_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!dragOver) setDragOver(true)
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          const sessionId = e.dataTransfer.getData(SESSION_DRAG_TYPE)
          setDragOver(false)
          if (!sessionId) return
          e.preventDefault()
          onDropSession(sessionId)
        },
      }
    : {}
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      {...dropProps}
      className={cn(
        'group/proj relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
        'hover:bg-primary/[0.06] focus-visible:ad-focus',
        'before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:opacity-0 before:transition-opacity',
        selected && 'bg-primary/10 before:opacity-100',
        // Drop affordance: a border-strong ring (identity/selection, never accent
        // per the design spine) while a dragged session hovers this folder.
        dragOver && 'ring-1 ring-border-strong',
      )}
    >
      {color ? (
        <ProjectDot color={color} />
      ) : (
        // "All sessions" gets a neutral hollow marker so rows align.
        <span className="size-2 shrink-0 rounded-full border border-border-strong" aria-hidden />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          selected ? 'font-medium text-foreground' : 'text-foreground/90',
        )}
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-foreground-tertiary">{count}</span>
    </button>
  )
}

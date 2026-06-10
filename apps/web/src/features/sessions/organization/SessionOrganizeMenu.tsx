import { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, FolderPlus, Plus, Tag, X } from 'lucide-react'
import type { Project } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { ProjectDot } from './ProjectDot'
import { NewProjectForm } from './NewProjectForm'
import { TAG_MAX_LENGTH } from '@agent-deck/protocol'

/**
 * The per-session organization controls, designed to drop INTO an existing
 * overflow popover (the History `⋯` menu and the SessionList row menu) alongside
 * Copy ID / Pin / Delete. Self-contained: a small in-popover view stack — a root
 * pair of entries ("Move to project ▸" · "Tags…"), a project picker (the
 * projects list + "New project"), and a tags editor (chips with remove +
 * free-text add with existing-tag suggestions). Each change fires
 * `onSetOrganization` with the FULL desired `{ projectId, tags }` (the parent
 * mutation PUTs it; the server normalizes tags).
 *
 * It is embeddable rather than its own popover so both call sites keep ONE menu
 * surface (no popover-in-popover). The host renders these as `menuitem`s.
 */

export interface SessionOrganizeMenuProps {
  /** The session being organized. */
  sessionId: string
  /** Its current project membership (null = none). */
  projectId: string | null
  /** Its current tags (normalized lowercase). */
  tags: string[]
  /** All projects (the "Move to project" choices). */
  projects: Project[]
  /** The tag universe (existing-tag suggestions for the editor). */
  tagSuggestions: string[]
  /** Apply a new full organization for the session. */
  onSetOrganization: (input: { projectId: string | null; tags: string[] }) => void
  /** Create a new project; resolves to the created project (then assign it). */
  onCreateProject: (input: { name: string; color: string }) => Promise<Project>
  /** Close the host popover (e.g. after picking a project). */
  onClose: () => void
}

type View = 'root' | 'projects' | 'newProject' | 'tags'

export function SessionOrganizeMenu(props: SessionOrganizeMenuProps) {
  const [view, setView] = useState<View>('root')

  if (view === 'projects') {
    return (
      <ProjectPicker
        {...props}
        onNewProject={() => setView('newProject')}
        onBack={() => setView('root')}
      />
    )
  }
  if (view === 'newProject') {
    return <NewProjectView {...props} onBack={() => setView('projects')} />
  }
  if (view === 'tags') {
    return <TagsEditor {...props} onBack={() => setView('root')} />
  }
  return (
    <div role="group" aria-label="Organize" className="flex flex-col gap-0.5">
      <RowButton icon={FolderPlus} onClick={() => setView('projects')}>
        <span className="flex-1">Move to folder</span>
        <ChevronRight className="size-3.5 text-foreground-tertiary" aria-hidden />
      </RowButton>
      <RowButton icon={Tag} onClick={() => setView('tags')}>
        <span className="flex-1">Tags</span>
        {props.tags.length > 0 && (
          <span className="text-[11px] tabular-nums text-foreground-tertiary">
            {props.tags.length}
          </span>
        )}
      </RowButton>
    </div>
  )
}

/** The "Move to project" view: choose a project, clear it, or add a new one. */
function ProjectPicker({
  projectId,
  tags,
  projects,
  onSetOrganization,
  onNewProject,
  onBack,
  onClose,
}: SessionOrganizeMenuProps & { onNewProject: () => void; onBack: () => void }) {
  function choose(nextProjectId: string | null) {
    onSetOrganization({ projectId: nextProjectId, tags })
    onClose()
  }
  return (
    <div className="flex flex-col gap-0.5">
      <ViewHeader title="Move to folder" onBack={onBack} />
      <div
        role="group"
        aria-label="Folders"
        className="flex max-h-60 flex-col gap-0.5 overflow-y-auto"
      >
        <RowButton onClick={() => choose(null)}>
          <span className="size-2 shrink-0 rounded-full border border-border-strong" aria-hidden />
          <span className="flex-1">No folder</span>
          {projectId === null && <Check className="size-3.5 text-foreground" aria-hidden />}
        </RowButton>
        {projects.map((project) => (
          <RowButton key={project.id} onClick={() => choose(project.id)}>
            <ProjectDot color={project.color} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {projectId === project.id && <Check className="size-3.5 text-foreground" aria-hidden />}
          </RowButton>
        ))}
      </div>
      <div className="my-0.5 h-px bg-border" />
      <RowButton icon={Plus} onClick={onNewProject}>
        New folder
      </RowButton>
    </div>
  )
}

/** Create-and-assign: make a project, then immediately move the session into it. */
function NewProjectView({
  tags,
  onCreateProject,
  onSetOrganization,
  onBack,
  onClose,
}: SessionOrganizeMenuProps & { onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(input: { name: string; color: string }) {
    setBusy(true)
    setError(null)
    try {
      const project = await onCreateProject(input)
      onSetOrganization({ projectId: project.id, tags })
      onClose()
    } catch {
      setError("Couldn't create the folder. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <ViewHeader title="New folder" onBack={onBack} />
      <NewProjectForm onCreate={handleCreate} onCancel={onBack} busy={busy} error={error} />
    </div>
  )
}

/** The tags editor: current tags (removable) + a free-text add with suggestions. */
function TagsEditor({
  projectId,
  tags,
  tagSuggestions,
  onSetOrganization,
  onBack,
}: SessionOrganizeMenuProps & { onBack: () => void }) {
  const [draft, setDraft] = useState('')

  // Normalize the draft the same way the server will, so the local view matches
  // what gets stored (and dedupe checks are honest).
  const normalized = draft.trim().toLowerCase().slice(0, TAG_MAX_LENGTH)

  // Suggest existing tags that aren't already on the session and match the draft.
  const suggestions = useMemo(() => {
    const own = new Set(tags)
    return tagSuggestions
      .filter((t) => !own.has(t) && (normalized === '' || t.includes(normalized)))
      .slice(0, 6)
  }, [tagSuggestions, tags, normalized])

  function commit(nextTags: string[]) {
    onSetOrganization({ projectId, tags: nextTags })
  }

  function addTag(tag: string) {
    const value = tag.trim().toLowerCase().slice(0, TAG_MAX_LENGTH)
    if (value === '' || tags.includes(value)) {
      setDraft('')
      return
    }
    commit([...tags, value])
    setDraft('')
  }

  function removeTag(tag: string) {
    commit(tags.filter((t) => t !== tag))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ViewHeader title="Tags" onBack={onBack} />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1" aria-label="Current tags">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-[20px] items-center gap-0.5 rounded-[5px] bg-muted pr-0.5 pl-1.5 text-[11px] font-medium text-muted-foreground"
            >
              #{tag}
              <button
                type="button"
                aria-label={`Remove tag #${tag}`}
                onClick={() => removeTag(tag)}
                className="rounded p-0.5 text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="px-1">
        <input
          type="text"
          aria-label="Add a tag"
          placeholder="Add a tag…"
          value={draft}
          autoFocus
          maxLength={TAG_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag(draft)
            }
          }}
          className={cn(
            'w-full rounded-[8px] border border-border bg-surface-2/50 px-2.5 py-1.5 text-[13px]',
            'text-foreground placeholder:text-foreground-tertiary',
            'focus-visible:border-ring focus-visible:ad-focus',
          )}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-0.5" aria-label="Tag suggestions">
          {suggestions.map((tag) => (
            <RowButton key={tag} onClick={() => addTag(tag)}>
              <Tag className="size-3 text-foreground-tertiary" aria-hidden />
              <span className="flex-1">#{tag}</span>
              <Plus className="size-3 text-foreground-tertiary" aria-hidden />
            </RowButton>
          ))}
        </div>
      )}
    </div>
  )
}

/** A back-arrow header for the sub-views, so a popover keeps one navigable surface. */
function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 pb-0.5">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="rounded-md p-1 text-foreground-tertiary transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ad-focus"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
      </button>
      <span className="ad-section-label">{title}</span>
    </div>
  )
}

/** A menu-style row button matching the overflow menu's items. */
function RowButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon?: typeof Tag
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus"
    >
      {Icon && <Icon className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />}
      {children}
    </button>
  )
}

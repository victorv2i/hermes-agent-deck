import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Loader2, Pencil, Plus, RotateCcw, ServerCog, Sparkles, Trash2 } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useSkills, useDeleteSkill } from '@/features/skills/useSkills'
import { SkillsHubPanel } from '@/features/skills/SkillsHubPanel'
import { NewSkillDialog } from '@/features/skills/NewSkillDialog'
import { SkillEditorDialog } from '@/features/skills/SkillEditorDialog'
import type { StudioSkill } from '../data/api'

/**
 * SkillsSection: the per-agent Skills control in the Studio workbench. It lists +
 * toggles the SELECTED agent's skills through Hermes's profile-scoped API (the
 * route threads `?profile=`), so ANY agent's skills can be enabled/disabled
 * without first switching to it. A toggle writes that agent's `skills.disabled`
 * list; the change applies on the agent's NEXT session, so the honest "restart to
 * apply" note rides the header.
 *
 * Authoring (browse the hub + install, create / edit / delete on disk) is also
 * managed here, NOT on a separate surface. Honest scope (load-bearing): stock
 * Hermes scopes skill CRUD + the hub to the ACTIVE profile only, so those
 * affordances appear ONLY when the selected agent IS the active one. For a
 * non-active agent the list still toggles (that route is profile-scoped) but the
 * create / edit / delete + hub controls are hidden behind a plain note telling
 * the user to switch to this agent first. All of this reuses the
 * `features/skills` components + data layer verbatim.
 *
 * Presentational for the list: the skill list / loading / error + the `onToggle`
 * write arrive as props (the panel runs the scoped GET/PUT). The "on" switch is
 * the single sky-blue accent; click a row to reveal its description.
 */
export interface SkillsSectionProps {
  /** The selected agent (a Hermes profile name); scopes the on-disk skill paths. */
  agent: string
  /** Whether the selected agent is the active profile (gates authoring + hub). */
  isActive: boolean
  skills: StudioSkill[] | undefined
  isLoading: boolean
  error: string | null
  /** Enable/disable a skill by name for the selected agent. */
  onToggle: (name: string, enabled: boolean) => void | Promise<void>
  /** Skill names with a toggle currently in flight (locks just those switches). */
  pending?: ReadonlySet<string>
}

export function SkillsSection(props: SkillsSectionProps) {
  // Authoring + hub are active-profile only. When this agent is active, mount the
  // management surface (it owns the local/hub switch + create/edit/delete and the
  // active-profile skill query that backs edit/delete paths). Otherwise render the
  // honest toggle-only list (no on-disk reads for a non-active agent).
  if (props.isActive) return <ActiveSkillsManagement {...props} />
  return <SkillsToggleList {...props} editPaths={null} onNew={null} onEdit={null} onDelete={null} />
}

/**
 * The active-agent surface: the local/hub view switch + the toggle list with
 * on-disk create / edit / delete. The `features/skills` data layer (active-profile
 * scoped) backs the hub and the edit/delete paths.
 */
function ActiveSkillsManagement(props: SkillsSectionProps) {
  const [view, setView] = useState<'local' | 'hub'>('local')

  // The on-disk skill list (active-profile) resolves each skill's relative path,
  // which edit/delete act on. The Studio list (props.skills) has no path, so we
  // map name -> path from this list; a skill whose path can't be resolved gets no
  // edit/delete (honestly unavailable).
  const onDisk = useSkills()
  const editPaths = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of onDisk.data?.skills ?? []) {
      if (s.path) map.set(s.name, s.path)
    }
    return map
  }, [onDisk.data])

  // CRUD dialog state: the skill being edited, a pending delete, and "new skill".
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ path: string; name: string } | null>(null)
  const [creating, setCreating] = useState(false)

  const del = useDeleteSkill()
  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await del.mutateAsync(deleting.path)
      setDeleting(null)
    } catch {
      toast.error(`Couldn't delete ${deleting.name}`, {
        description: 'The skill was not removed. Try again.',
      })
    }
  }, [del, deleting])

  return (
    <div className="flex flex-col gap-3">
      {/* Local vs hub switch. aria-pressed toggle buttons so the workbench tab
          strip above stays the only tablist on the surface. */}
      <div
        role="group"
        aria-label="Skills source"
        className="ad-surface inline-flex self-start rounded-md bg-surface-1 p-1"
      >
        <ViewButton selected={view === 'local'} onClick={() => setView('local')}>
          Your skills
        </ViewButton>
        <ViewButton selected={view === 'hub'} onClick={() => setView('hub')}>
          Browse hub
        </ViewButton>
      </div>

      {view === 'hub' ? (
        <SkillsHubPanel />
      ) : (
        <SkillsToggleList
          {...props}
          editPaths={editPaths}
          onNew={() => setCreating(true)}
          onEdit={(name) => {
            const path = editPaths.get(name)
            if (path) setEditing({ path, name })
          }}
          onDelete={(name) => {
            const path = editPaths.get(name)
            if (path) setDeleting({ path, name })
          }}
        />
      )}

      {editing && (
        <SkillEditorDialog
          open
          path={editing.path}
          name={editing.name}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}

      <NewSkillDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(path, name) => setEditing({ path, name })}
      />

      <DeleteSkillDialog
        skill={deleting}
        busy={del.isPending}
        onCancel={() => !del.isPending && setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

/** One segment of the local/hub switch, styled like the workbench tab strip. */
function ViewButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-[7px] px-3.5 py-1.5 text-13 font-medium transition-colors',
        'focus-visible:ad-focus',
        selected ? 'bg-primary/12 text-primary-hover' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The toggle list itself. The list / loading / error + toggle stay presentational
 * (props from the profile-scoped panel). When authoring is enabled (active agent),
 * the New skill + per-row edit/delete handlers are passed in; when null, the list
 * is toggle-only with the honest "switch to this agent" note.
 */
function SkillsToggleList({
  skills,
  isLoading,
  error,
  onToggle,
  pending,
  editPaths,
  onNew,
  onEdit,
  onDelete,
}: Pick<SkillsSectionProps, 'skills' | 'isLoading' | 'error' | 'onToggle' | 'pending'> & {
  /** name -> on-disk path, when resolvable (active agent). null = no authoring. */
  editPaths: ReadonlyMap<string, string> | null
  onNew: (() => void) | null
  onEdit: ((name: string) => void) | null
  onDelete: ((name: string) => void) | null
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const onExpand = (name: string) =>
    setExpanded((prev) => {
      const copy = new Set(prev)
      if (copy.has(name)) copy.delete(name)
      else copy.add(name)
      return copy
    })

  const enabledCount = useMemo(
    () => (skills ? skills.filter((s) => s.enabled).length : 0),
    [skills],
  )

  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load skills"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !skills) return <SkillsSkeleton />

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No skills yet"
        description="Skills are extra tools your agent can use. Create one here, or drop a SKILL.md into your Hermes skills directory."
        action={
          onNew ? (
            <Button onClick={onNew}>
              <Plus />
              New skill
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-foreground-tertiary">
          <span className="font-medium text-foreground">{enabledCount}</span> of{' '}
          <span className="font-medium text-foreground">{skills.length}</span> skills enabled for
          this agent.
        </p>
        <div className="flex items-center gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
            <RotateCcw className="size-3 shrink-0" aria-hidden />
            Restart your agent to apply skill changes.
          </p>
          {onNew && (
            <Button size="sm" variant="outline" onClick={onNew} className="shrink-0">
              <Plus />
              New skill
            </Button>
          )}
        </div>
      </div>

      {/* Honest note when authoring is off: the create / edit / delete + hub are
          active-profile only in stock Hermes. The toggle still works (its route is
          profile-scoped), so we say what is and isn't available here. */}
      {!onNew && (
        <p
          role="note"
          className="ad-surface rounded-md bg-surface-1/40 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-tertiary"
        >
          You can enable or disable skills for this agent here. Switch to this agent to install or
          edit its skills.
        </p>
      )}

      <ul className="flex flex-col gap-1.5" aria-label="Skills this agent can use">
        {skills.map((s) => (
          <SkillRow
            key={s.name}
            skill={s}
            expanded={expanded.has(s.name)}
            pending={pending?.has(s.name) ?? false}
            // Edit/delete are surfaced only when authoring is enabled AND a path
            // resolved for this skill (a skill outside our managed dir has none).
            canEdit={Boolean(onEdit && editPaths?.has(s.name))}
            canDelete={Boolean(onDelete && editPaths?.has(s.name))}
            onToggle={onToggle}
            onExpand={() => onExpand(s.name)}
            onEdit={onEdit ? () => onEdit(s.name) : undefined}
            onDelete={onDelete ? () => onDelete(s.name) : undefined}
          />
        ))}
      </ul>
    </div>
  )
}

function SkillRow({
  skill,
  expanded,
  pending,
  canEdit,
  canDelete,
  onToggle,
  onExpand,
  onEdit,
  onDelete,
}: {
  skill: StudioSkill
  expanded: boolean
  pending: boolean
  canEdit: boolean
  canDelete: boolean
  onToggle: (name: string, enabled: boolean) => void | Promise<void>
  onExpand: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const panelId = `studio-skill-detail-${skill.name}`
  // Authoring (active agent) shows edit/delete; they're disabled when no on-disk
  // path resolved for the skill (managed outside our skills dir).
  const authoring = onEdit !== undefined || onDelete !== undefined
  return (
    <li
      data-testid={`studio-skill-row-${skill.name}`}
      data-enabled={skill.enabled ? 'true' : 'false'}
      className={cn('ad-surface rounded-md bg-card', !skill.enabled && 'opacity-80')}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onExpand}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:ad-focus"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-foreground-tertiary transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className="truncate font-mono text-sm text-foreground">{skill.name}</span>
          {skill.category && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
              {skill.category}
            </span>
          )}
        </button>
        <ToggleSwitch
          name={skill.name}
          enabled={skill.enabled}
          pending={pending}
          onChange={(next) => void onToggle(skill.name, next)}
        />
      </div>
      {expanded && (
        <div id={panelId} className="border-t border-border px-3 py-2.5 pl-[34px]">
          {skill.description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
          ) : (
            <p className="text-xs italic leading-relaxed text-foreground-tertiary">
              No description provided for this skill.
            </p>
          )}
          {/* On-disk actions (active agent only): edit the SKILL.md body, or delete. */}
          {authoring && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={onEdit}
                disabled={!canEdit}
                title={canEdit ? undefined : 'This skill is not editable here.'}
                className="relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
              >
                <Pencil />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={!canDelete}
                title={canDelete ? undefined : 'This skill is not deletable here.'}
                className="relative text-destructive hover:text-destructive before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
              >
                <Trash2 />
                Delete
              </Button>
              {!canEdit && (
                <span className="text-[11px] text-foreground-tertiary">
                  Managed outside this folder. Edit in Files.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Confirm-gated delete (the destructive action is never one click). */
function DeleteSkillDialog({
  skill,
  busy,
  onCancel,
  onConfirm,
}: {
  skill: { path: string; name: string } | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={skill !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete skill?</DialogTitle>
          <DialogDescription>
            {skill ? (
              <>
                "<span className="font-mono">{skill.name}</span>" and its files will be permanently
                deleted from disk. This can't be undone.
              </>
            ) : (
              <>This skill will be permanently deleted.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** An accessible sky-blue-accented enable/disable switch. Sky-blue = the live "on" state. */
function ToggleSwitch({
  name,
  enabled,
  pending,
  onChange,
}: {
  name: string
  enabled: boolean
  pending: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ad-focus disabled:opacity-60',
        pending && 'disabled:cursor-progress',
        enabled ? 'bg-primary' : 'bg-foreground/20',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function SkillsSkeleton() {
  return (
    <div data-testid="studio-skills-skeleton" className="flex flex-col gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[46px] animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border"
        />
      ))}
    </div>
  )
}

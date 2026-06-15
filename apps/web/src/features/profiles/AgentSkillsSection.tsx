import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Loader2, Pencil, Plus, ServerCog, Sparkles, Trash2 } from 'lucide-react'
import { ErrorState, EmptyState } from '@/components/ui/state'
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
import { useSkills, useToggleSkill, useDeleteSkill } from '@/features/skills/useSkills'
import type { Skill } from '@/features/skills/types'
import { SkillEditorDialog } from '@/features/skills/SkillEditorDialog'
import { NewSkillDialog } from '@/features/skills/NewSkillDialog'
import { SkillsHubPanel } from '@/features/skills/SkillsHubPanel'

/**
 * AgentSkillsSection — the Skills tab of the per-agent hub. Two views behind a
 * small segmented switch: "Your skills" (the local list, primary + default) and
 * "Browse hub" (the hermes skills hub browser, {@link SkillsHubPanel}). The hub
 * view is ADDITIVE: it searches/installs hub skills; the local list stays the
 * enable/disable + CRUD surface.
 *
 * HONEST SCOPE (load-bearing): the dashboard `/api/skills` + toggle act on the
 * ACTIVE profile only — stock hermes exposes no per-profile skill set. So the
 * copy says so plainly, and when THIS agent is not the active one the toggles are
 * HONESTLY DISABLED (no control that can only mislead) with a "switch to this
 * agent first" note. Reuses the `features/skills` data layer verbatim. The hub
 * panel carries its own honest states (real errors, "restart to apply" after
 * install, linking to System for the gateway restart).
 *
 * Design: warm-void rows, the single amber `--primary` accent reserved for the
 * live "enabled" switch (the one action/state); identity/metadata stay neutral.
 */
export function AgentSkillsSection({ isActive }: { isActive: boolean }) {
  const [view, setView] = useState<'local' | 'hub'>('local')
  return (
    <div className="flex flex-col gap-3">
      {/* Local vs hub switch. aria-pressed toggle buttons (not a nested tablist)
          so the hub tab strip above stays the only tablist on the surface. */}
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
      {view === 'hub' ? <SkillsHubPanel /> : <LocalSkillsView isActive={isActive} />}
    </div>
  )
}

/** One segment of the local/hub switch, styled like the hub tab strip's tabs. */
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
        'inline-flex min-h-11 items-center justify-center rounded-[7px] px-3.5 py-1.5 text-13 font-medium transition-colors sm:min-h-0',
        'focus-visible:ad-focus',
        selected ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** The local view: this agent's skill list with enable/disable + on-disk CRUD. */
function LocalSkillsView({ isActive }: { isActive: boolean }) {
  const query = useSkills()
  const toggle = useToggleSkill()
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // CRUD dialog state: the skill being edited, a pending delete, and "new skill".
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  const [creating, setCreating] = useState(false)

  const onToggle = useCallback(
    (skill: Skill, next: boolean) => {
      setPending((prev) => new Set(prev).add(skill.name))
      toggle.mutate(
        { name: skill.name, enabled: next },
        {
          onError: () => {
            toast.error(`Couldn’t ${next ? 'enable' : 'disable'} ${skill.name}`, {
              description: 'The change was reverted. The hermes dashboard may be offline.',
            })
          },
          onSettled: () => {
            setPending((prev) => {
              const copy = new Set(prev)
              copy.delete(skill.name)
              return copy
            })
          },
        },
      )
    },
    [toggle],
  )

  const onExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const copy = new Set(prev)
      if (copy.has(name)) copy.delete(name)
      else copy.add(name)
      return copy
    })
  }, [])

  const del = useDeleteSkill()
  const confirmDelete = useCallback(async () => {
    if (!deleting?.path) return
    try {
      await del.mutateAsync(deleting.path)
      setDeleting(null)
    } catch {
      toast.error(`Couldn’t delete ${deleting.name}`, {
        description: 'The skill was not removed. Try again.',
      })
    }
  }, [del, deleting])

  if (query.status === 'pending') return <SkillsSkeleton />
  if (query.status === 'error') {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn’t load skills"
        description="The hermes dashboard may be offline. The skill list lives there."
        onRetry={() => void query.refetch()}
        retryLabel="Try again"
      />
    )
  }

  const skills = query.data?.skills ?? []
  return (
    <>
      <Loaded
        skills={skills}
        isActive={isActive}
        pending={pending}
        expanded={expanded}
        onToggle={onToggle}
        onExpand={onExpand}
        onNew={() => setCreating(true)}
        onEdit={(s) => s.path && setEditing({ path: s.path, name: s.name })}
        onDelete={(s) => setDeleting(s)}
      />

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
    </>
  )
}

/** Confirm-gated delete (the destructive action is never one click). */
function DeleteSkillDialog({
  skill,
  busy,
  onCancel,
  onConfirm,
}: {
  skill: Skill | null
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
                “<span className="font-mono">{skill.name}</span>” and its files will be permanently
                deleted from disk. This can’t be undone.
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

function Loaded({
  skills,
  isActive,
  pending,
  expanded,
  onToggle,
  onExpand,
  onNew,
  onEdit,
  onDelete,
}: {
  skills: Skill[]
  isActive: boolean
  pending: ReadonlySet<string>
  expanded: ReadonlySet<string>
  onToggle: (skill: Skill, next: boolean) => void
  onExpand: (name: string) => void
  onNew: () => void
  onEdit: (skill: Skill) => void
  onDelete: (skill: Skill) => void
}) {
  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills])

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No skills yet"
        description="Skills are extra tools your agent can use. Create one here, or drop a SKILL.md into your hermes skills directory."
        action={
          <Button onClick={onNew}>
            <Plus />
            New skill
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header: the honest scope note + the New skill action. */}
      <div className="flex items-start gap-3">
        {/* Honest scope: toggles act on the ACTIVE agent (stock hermes has no
            per-profile skill set). When this agent is active, say so; when not,
            explain the toggles are disabled until you switch. */}
        <div
          role="note"
          className="ad-surface flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-1/40 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-tertiary"
        >
          {isActive ? (
            <span>
              <span className="font-medium text-foreground">{enabledCount}</span> of{' '}
              <span className="font-medium text-foreground">{skills.length}</span> skills enabled
              for the <span className="text-foreground">active agent</span>. Toggling here changes
              the active agent’s skills.
            </span>
          ) : (
            <span>
              These are the <span className="text-foreground">active agent’s</span> skills. Hermes
              tracks one shared skill set, not one per agent. Switch to this agent first to change
              which skills it uses.
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={onNew} className="shrink-0">
          <Plus />
          New skill
        </Button>
      </div>

      <ul className="flex flex-col gap-1.5">
        {skills.map((s) => (
          <SkillRow
            key={s.name}
            skill={s}
            expanded={expanded.has(s.name)}
            pending={pending.has(s.name)}
            toggleDisabled={!isActive}
            onToggle={onToggle}
            onExpand={() => onExpand(s.name)}
            onEdit={() => onEdit(s)}
            onDelete={() => onDelete(s)}
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
  toggleDisabled,
  onToggle,
  onExpand,
  onEdit,
  onDelete,
}: {
  skill: Skill
  expanded: boolean
  pending: boolean
  toggleDisabled: boolean
  onToggle: (skill: Skill, next: boolean) => void
  onExpand: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const panelId = `skill-detail-${skill.name}`
  // Edit/Delete act on the on-disk dir; honestly unavailable when its path could
  // not be resolved (e.g. a skill from an external dir we don't manage).
  const fsAvailable = skill.path !== null
  return (
    <li
      data-testid={`agent-skill-row-${skill.name}`}
      data-enabled={skill.enabled ? 'true' : 'false'}
      className={cn('ad-surface rounded-md bg-card', !skill.enabled && 'opacity-80')}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* The whole header is the expand/collapse control (click-to-expand). */}
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
          disabled={toggleDisabled}
          onChange={(next) => onToggle(skill, next)}
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
          {/* On-disk actions: edit the SKILL.md body, or delete the skill. */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onEdit}
              disabled={!fsAvailable}
              title={fsAvailable ? undefined : 'This skill is not editable here.'}
              className="relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
            >
              <Pencil />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={!fsAvailable}
              className="relative text-destructive hover:text-destructive before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
              title={fsAvailable ? undefined : 'This skill is not deletable here.'}
            >
              <Trash2 />
              Delete
            </Button>
            {!fsAvailable && (
              <span className="text-[11px] text-foreground-tertiary">
                Managed outside this folder. Edit in Files.
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/** An accessible amber-accented enable/disable switch. Amber = the live "on" state. */
function ToggleSwitch({
  name,
  enabled,
  pending,
  disabled,
  onChange,
}: {
  name: string
  enabled: boolean
  pending: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      aria-busy={pending || undefined}
      disabled={pending || disabled}
      title={disabled ? 'Switch to this agent first to change its skills.' : undefined}
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ad-focus',
        'disabled:opacity-60',
        pending ? 'disabled:cursor-progress' : disabled && 'disabled:cursor-not-allowed',
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
    <div data-testid="agent-skills-skeleton" className="flex flex-col gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[46px] animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border"
        />
      ))}
    </div>
  )
}

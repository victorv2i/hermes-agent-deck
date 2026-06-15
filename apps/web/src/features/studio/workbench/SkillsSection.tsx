import { useMemo, useState } from 'react'
import { ChevronRight, RotateCcw, ServerCog, Sparkles } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'
import type { StudioSkill } from '../data/api'

/**
 * SkillsSection: the per-agent Skills control in the Studio workbench. Unlike
 * the active-profile-only Skills surface, this lists + toggles the SELECTED
 * agent's skills through hermes's profile-scoped API (the route threads
 * `?profile=`), so ANY agent's skills can be toggled without first switching to
 * it. A toggle writes that agent's `skills.disabled` list; the change applies on
 * the agent's NEXT session, so the honest "restart to apply" note rides the header.
 *
 * Presentational: the skill list / loading / error + the `onToggle` write arrive
 * as props (the panel runs the scoped GET/PUT). The "on" switch is the single
 * amber accent; click a row to reveal its description. v1 is enable/disable only
 * (on-disk skill CRUD + the hub browser stay on the dedicated Skills surface,
 * which hermes does not scope per profile).
 */
export interface SkillsSectionProps {
  skills: StudioSkill[] | undefined
  isLoading: boolean
  error: string | null
  /** Enable/disable a skill by name for the selected agent. */
  onToggle: (name: string, enabled: boolean) => void | Promise<void>
  /** Skill names with a toggle currently in flight (locks just those switches). */
  pending?: ReadonlySet<string>
}

export function SkillsSection({
  skills,
  isLoading,
  error,
  onToggle,
  pending,
}: SkillsSectionProps) {
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
        description="Skills are extra tools your agent can use. Drop a SKILL.md into your Hermes skills directory, or add one from the Skills surface."
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
        <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
          <RotateCcw className="size-3 shrink-0" aria-hidden />
          Restart your agent to apply skill changes.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5" aria-label="Skills this agent can use">
        {skills.map((s) => (
          <SkillRow
            key={s.name}
            skill={s}
            expanded={expanded.has(s.name)}
            pending={pending?.has(s.name) ?? false}
            onToggle={onToggle}
            onExpand={() => onExpand(s.name)}
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
  onToggle,
  onExpand,
}: {
  skill: StudioSkill
  expanded: boolean
  pending: boolean
  onToggle: (name: string, enabled: boolean) => void | Promise<void>
  onExpand: () => void
}) {
  const panelId = `studio-skill-detail-${skill.name}`
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

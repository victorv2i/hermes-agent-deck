import { Copy, CircleDot, IdCard, Plus, Star, Upload } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/state'
import { cn } from '@/lib/utils'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import type { ProfileSummary } from '@/features/profiles/types'

/**
 * StudioRoster — the agent roster in the Studio (the "pick an agent" master
 * column). Each card is an avatar + display name + model + Active/Default badges;
 * selecting one opens its workbench. "New agent" opens the existing Hatch dialog
 * (wired by the route) and "Clone" duplicates the selected agent (create+clone).
 *
 * Presentational: the roster + selection + the action callbacks arrive as props,
 * so the route owns the data + the dialogs. The active card's identity uses the
 * governed identity pattern (strong border + surface tint), never the sky-blue
 * action accent (identity is never the accent).
 */
export interface StudioRosterProps {
  profiles: ProfileSummary[]
  /** The currently-open agent (its card reads as current), or null. */
  selected: string | null
  onSelect: (name: string) => void
  /** Open the Hatch (new agent) dialog. */
  onNewAgent: () => void
  /** Clone the given agent (the route runs create+clone, then opens the new one). */
  onCloneSelected: (sourceName: string) => void
  /** Open the Import dialog (bring an exported `.tar.gz` agent back as a new one). */
  onImport: () => void
}

export function StudioRoster({
  profiles,
  selected,
  onSelect,
  onNewAgent,
  onCloneSelected,
  onImport,
}: StudioRosterProps) {
  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={IdCard}
        title="No agents yet"
        description="Hatch your first agent: give it a name and a face, and it gets its own model, skills, and memory."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={onNewAgent}>
              <Plus aria-hidden />
              New agent
            </Button>
            <Button type="button" variant="outline" onClick={onImport}>
              <Upload aria-hidden />
              Import
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h2 className="ad-section-label">Agents</h2>
        <div className="flex items-center gap-1.5">
          {selected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onCloneSelected(selected)}
              className="text-foreground-tertiary"
            >
              <Copy aria-hidden />
              Clone
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onImport}
            className="text-foreground-tertiary"
          >
            <Upload aria-hidden />
            Import
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onNewAgent}>
            <Plus aria-hidden />
            New agent
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {profiles.map((profile) => (
          <li key={profile.name}>
            <RosterCard
              profile={profile}
              isSelected={profile.name === selected}
              onSelect={() => onSelect(profile.name)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function RosterCard({
  profile,
  isSelected,
  onSelect,
}: {
  profile: ProfileSummary
  isSelected: boolean
  onSelect: () => void
}) {
  const friendlyName = profile.displayName?.trim() || profile.name
  return (
    <button
      type="button"
      data-testid={`studio-roster-card-${profile.name}`}
      aria-current={isSelected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'ad-surface ad-raised flex w-full items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150',
        'focus-visible:ad-focus',
        // Selected: a restrained current state — the elevated surface step plus a
        // quiet accent edge (a thin --primary ring at low alpha, the sanctioned
        // accent use), so the open agent reads as current without shouting.
        isSelected
          ? 'border-[var(--border-strong)] bg-surface-elevated ring-1 ring-[color-mix(in_oklch,var(--primary)_32%,transparent)]'
          : 'hover:border-[var(--border-strong)] hover:bg-surface-1',
      )}
    >
      <Avatar avatarId={resolveAvatar(profile)} name={profile.name} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-heading text-sm font-semibold text-foreground">
            {friendlyName}
          </span>
          {profile.isDefault && (
            <Badge variant="outline" className="gap-1">
              <Star className="size-3" aria-hidden />
              Default
            </Badge>
          )}
          {profile.isActive && (
            <Badge variant="outline" className="gap-1">
              <CircleDot className="size-3" aria-hidden />
              Active
            </Badge>
          )}
        </span>
        <span className="truncate font-mono text-[11px] text-foreground-tertiary">
          {profile.model ?? 'model unknown'}
        </span>
      </div>
    </button>
  )
}

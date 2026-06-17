import { RotateCcw, ServerCog, Wrench } from 'lucide-react'
import type { StudioConfigSubset, StudioConfigWriteRequest } from '@agent-deck/protocol'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'

/**
 * ToolsSection — the per-agent toolset control in the Studio workbench. Hermes
 * models toolsets with two config keys: a top-level `toolsets:` ENABLED list and
 * an `agent.disabled_toolsets:` blocklist applied on top. A toolset is EFFECTIVE
 * when it is in `toolsets` AND not in `disabled_toolsets`.
 *
 * Toggling writes ONLY `agent.disabled_toolsets` (the blocklist): turning a
 * toolset off adds it to the blocklist, turning it back on removes it. The full
 * intended list is sent (Hermes replaces the key), never a fake instant state.
 *
 * Presentational: config/loading/error + the `onToggle` config-write arrive as
 * props (the route runs the scoped GET/PUT). The "on" switch is the single sky-blue
 * accent. Config applies on the agent's NEXT session, so a restart note rides the
 * header.
 */
export interface ToolsSectionProps {
  config: StudioConfigSubset | undefined
  isLoading: boolean
  error: string | null
  /** Write a partial config patch (here: the new `agent.disabled_toolsets`). */
  onToggle: (patch: StudioConfigWriteRequest['config']) => void | Promise<void>
  /** True while a toggle write is in flight (locks the switches). */
  isSaving?: boolean
}

export function ToolsSection({
  config,
  isLoading,
  error,
  onToggle,
  isSaving = false,
}: ToolsSectionProps) {
  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load tools"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !config) return <ToolsSkeleton />

  const enabled = config.toolsets ?? []
  const disabled = config.agent?.disabled_toolsets ?? []

  if (enabled.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No toolsets enabled"
        description="This agent has no toolsets enabled in its config. Enabling them is a one-time setup step in your Hermes config."
      />
    )
  }

  const onChange = (name: string, on: boolean) => {
    // Toggling OFF adds to the blocklist; toggling ON removes from it. Send the
    // full intended list (Hermes replaces the key), so the write is deterministic.
    const next = on ? disabled.filter((n) => n !== name) : [...disabled, name]
    void onToggle({ agent: { disabled_toolsets: next } })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
        <RotateCcw className="size-3 shrink-0" aria-hidden />
        Restart your agent to apply tool changes.
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="Toolsets your agent can use">
        {enabled.map((name) => {
          const on = !disabled.includes(name)
          return (
            <li
              key={name}
              data-testid={`studio-toolset-row-${name}`}
              data-enabled={on ? 'true' : 'false'}
              className={cn('ad-surface flex items-center gap-3 rounded-md bg-card px-3 py-2.5', !on && 'opacity-80')}
            >
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{name}</code>
              <ToggleSwitch name={name} enabled={on} disabled={isSaving} onChange={(next) => onChange(name, next)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** An accessible sky-blue-accented enable/disable switch. Sky-blue = the live "on" state. */
function ToggleSwitch({
  name,
  enabled,
  disabled,
  onChange,
}: {
  name: string
  enabled: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ad-focus disabled:opacity-60',
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

function ToolsSkeleton() {
  return (
    <div data-testid="studio-tools-skeleton" className="flex flex-col gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[46px] animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border" />
      ))}
    </div>
  )
}

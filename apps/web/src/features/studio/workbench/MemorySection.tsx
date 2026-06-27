import { useId } from 'react'
import { Check, Loader2, RotateCcw, ServerCog } from 'lucide-react'
import type {
  MemoryStatus,
  StudioConfigWriteRequest,
  StudioMemoryConfig,
} from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'

/**
 * MemorySection — the per-agent Memory controls in the Studio workbench. Two
 * parts, both honest:
 *
 *  1. The `memory.*` config block, authored PER PROFILE via
 *     `GET/PUT /api/config?profile=`: whether memory / the user profile are
 *     enabled, their character budgets, and the write-approval mode.
 *  2. The memory PROVIDER selector (`/api/memory`), which stock Hermes tracks for
 *     ONE active agent at a time, so its controls are honestly disabled (with a
 *     note) when this is not the active agent.
 *
 * Installed Hermes (v29) has NO flat MEMORY.md / USER.md files in a profile, so
 * there is NO flat-file editor or reset here (the prior file-based editor is
 * retired): memory is provider + config only.
 *
 * Presentational: config/loading/error + the writes arrive as props.
 */
export interface MemorySectionProps {
  memory: StudioMemoryConfig | undefined
  isLoading: boolean
  error: string | null
  /** Write a partial `memory.*` config patch (the route runs the scoped PUT). */
  onChangeConfig: (patch: StudioConfigWriteRequest['config']) => void | Promise<void>
  /** True while a config write is in flight. */
  isSavingConfig?: boolean
  /** The active provider + catalog (`/api/memory`), or null when unavailable. */
  providerStatus: MemoryStatus | null
  /** Whether THIS agent is the active profile (provider controls are active-scoped). */
  isActiveAgent: boolean
  /** Switch the memory provider (active agent only). Empty string = built-in. */
  onSwitchProvider: (provider: string) => void
  /** True while a provider switch is in flight. */
  isSwitchingProvider?: boolean
  /** The honest restart-required state after a provider switch. */
  providerSwitchRestartRequired?: boolean
}

export function MemorySection({
  memory,
  isLoading,
  error,
  onChangeConfig,
  isSavingConfig = false,
  providerStatus,
  isActiveAgent,
  onSwitchProvider,
  isSwitchingProvider = false,
  providerSwitchRestartRequired = false,
}: MemorySectionProps) {
  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load memory settings"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !memory) return <MemorySkeleton />

  const patchMemory = (patch: StudioMemoryConfig) => void onChangeConfig({ memory: patch })

  return (
    <div className="flex flex-col gap-5">
      {/* ── memory.* config (per-profile) ─────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Agent memory"
          description="Let the agent keep long-term memories across conversations."
          checked={memory.memory_enabled ?? false}
          disabled={isSavingConfig}
          onChange={(next) => patchMemory({ memory_enabled: next })}
        />
        <ToggleRow
          label="User profile"
          description="Let the agent maintain a profile of what it learns about you."
          checked={memory.user_profile_enabled ?? false}
          disabled={isSavingConfig}
          onChange={(next) => patchMemory({ user_profile_enabled: next })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CharLimitField
            label="Memory budget"
            value={memory.memory_char_limit}
            disabled={isSavingConfig}
            onCommit={(v) => patchMemory({ memory_char_limit: v })}
          />
          <CharLimitField
            label="User profile budget"
            value={memory.user_char_limit}
            disabled={isSavingConfig}
            onCommit={(v) => patchMemory({ user_char_limit: v })}
          />
        </div>
        <WriteApprovalField
          value={memory.write_approval ?? false}
          disabled={isSavingConfig}
          onChange={(next) => patchMemory({ write_approval: next })}
        />
        <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
          <RotateCcw className="size-3 shrink-0" aria-hidden />
          Restart your agent to apply memory changes.
        </p>
      </div>

      {/* ── provider selector (active agent scoped) ───────────────────────── */}
      {providerStatus && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <p className="text-13 font-medium text-foreground">Memory provider</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-tertiary">
              Where the agent stores long-term memories. "Configured" means the plugin is set up,
              not necessarily connected.
            </p>
            {!isActiveAgent && (
              <p
                role="note"
                className="mt-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] leading-relaxed text-foreground-tertiary"
              >
                The provider shown is the active agent's, since Hermes tracks one memory provider at
                a time, not one per agent. Switch to this agent to change it.
              </p>
            )}
          </div>

          <div data-testid="studio-memory-active-provider" className="flex items-center gap-2.5">
            <span className="text-13 text-foreground-tertiary">Active:</span>
            <span className="text-13 font-medium text-foreground">
              {providerStatus.active ? providerStatus.active : 'Built-in'}
            </span>
            {providerSwitchRestartRequired && <Badge variant="warning">Restart to apply</Badge>}
          </div>

          <ul className="flex flex-col gap-1.5">
            <ProviderOption
              label="Built-in"
              description="Hermes's built-in memory store."
              configured
              isActive={!providerStatus.active}
              isSwitching={isSwitchingProvider}
              controlsDisabled={!isActiveAgent}
              onSelect={() => onSwitchProvider('')}
            />
            {providerStatus.providers.map((p) => (
              <ProviderOption
                key={p.name}
                label={p.name}
                description={p.description}
                configured={p.configured}
                isActive={providerStatus.active === p.name}
                isSwitching={isSwitchingProvider}
                controlsDisabled={!isActiveAgent}
                onSelect={() => onSwitchProvider(p.name)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="ad-surface flex items-center gap-3 rounded-md bg-card px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-13 font-medium text-foreground">{label}</p>
        <p className="text-[12px] leading-relaxed text-foreground-tertiary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${checked ? 'Disable' : 'Enable'} ${label}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:ad-focus disabled:opacity-60',
          checked ? 'bg-primary' : 'bg-foreground/20',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/** A character-budget field that commits the parsed integer on blur (or Enter). */
function CharLimitField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number | undefined
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const id = useId()
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    // Only commit a real, non-negative change (NaN/blank/unchanged are no-ops).
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed !== value) onCommit(parsed)
  }
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="ad-section-label">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={0}
        step={100}
        defaultValue={value ?? ''}
        disabled={disabled}
        placeholder="default"
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}

/**
 * The memory write-approval control. Hermes types `memory.write_approval` as a
 * boolean: `false` applies writes automatically, `true` waits for approval. The
 * two-button toggle maps Automatic = false and Ask first = true.
 */
function WriteApprovalField({
  value,
  disabled,
  onChange,
}: {
  value: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  const OPTIONS = [
    { approval: false, label: 'Automatic' },
    { approval: true, label: 'Ask first' },
  ] as const
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="ad-section-label">Memory writes</span>
      <div
        role="group"
        aria-label="Memory write approval"
        className="ad-surface inline-flex rounded-md bg-surface-1 p-1"
      >
        {OPTIONS.map((opt) => {
          const selected = value === opt.approval
          return (
            <button
              key={opt.label}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(opt.approval)}
              className={cn(
                'inline-flex min-h-9 items-center rounded-[7px] px-3 py-1 text-13 font-medium transition-colors',
                'focus-visible:ad-focus disabled:opacity-60',
                selected
                  ? 'bg-primary/12 text-primary-hover'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProviderOption({
  label,
  description,
  configured,
  isActive,
  isSwitching,
  controlsDisabled,
  onSelect,
}: {
  label: string
  description: string
  configured: boolean
  isActive: boolean
  isSwitching: boolean
  controlsDisabled: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={controlsDisabled || isActive || isSwitching || !configured}
        aria-pressed={isActive}
        className={cn(
          'ad-surface flex w-full min-h-[44px] items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
          'focus-visible:ad-focus',
          isActive
            ? 'border-border-strong bg-surface-1'
            : 'border-border hover:bg-muted/40 disabled:cursor-default',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
            isActive ? 'border-primary' : 'border-border-strong',
          )}
        >
          {isActive ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-13 font-medium text-foreground">
            {label}
            {isActive && <Check className="size-3.5 text-success" aria-label="Active" />}
            {!configured && (
              <Badge variant="muted" className="text-[10px]">
                Not configured
              </Badge>
            )}
          </span>
          <span className="text-[11px] leading-relaxed text-muted-foreground">{description}</span>
        </span>
        {isSwitching && !isActive && (
          <Loader2
            className="ml-auto mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </button>
    </li>
  )
}

function MemorySkeleton() {
  return (
    <div data-testid="studio-memory-skeleton" className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border"
        />
      ))}
    </div>
  )
}

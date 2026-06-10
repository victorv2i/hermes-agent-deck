/**
 * MemoryProviderSection — memory-provider section in the agent character sheet.
 *
 * Shows:
 *   - Active provider (name or "Built-in") with the configured state
 *   - Provider catalog (switch affordance)
 *   - Built-in memory file sizes (MEMORY.md / USER.md) with a destructive
 *     "Reset built-in memory" that names exactly what will be erased
 *
 * HONESTY boundaries (verbatim in UI copy):
 *   - "configured" means the plugin is set up, NOT that it is connected.
 *   - Switching the provider takes effect when the agent restarts — the UI
 *     says so and does NOT pretend the switch is live until a restart happens.
 *   - Reset is IRREVERSIBLE — the confirm dialog names the target files.
 *
 * This component is presentational. The parent (AgentMemoryTabs "Provider" tab
 * or a dedicated route) wires the data + mutations.
 */
import { useState } from 'react'
import { Check, ChevronDown, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { MemoryStatus } from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'empty'
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`
  return `${Math.round(bytes / 1024)} KiB`
}

export interface MemoryProviderSectionProps {
  /** Whether this panel is for the active agent. Provider controls are active-profile scoped. */
  isActiveAgent?: boolean
  memoryStatus: MemoryStatus | null
  isLoading: boolean
  error: string | null
  /** Whether a provider switch is in flight. */
  isSwitching: boolean
  /** Whether a reset is in flight. */
  isResetting: boolean
  /** The restart-required note to show after switching. */
  switchResult: { active: string; restart_required: boolean } | null
  onSwitchProvider: (provider: string) => void
  onResetMemory: (target: 'all' | 'memory' | 'user') => void
}

export function MemoryProviderSection({
  isActiveAgent = true,
  memoryStatus,
  isLoading,
  error,
  isSwitching,
  isResetting,
  switchResult,
  onSwitchProvider,
  onResetMemory,
}: MemoryProviderSectionProps) {
  const [showCatalog, setShowCatalog] = useState(false)
  const [resetTarget, setResetTarget] = useState<'all' | 'memory' | 'user' | null>(null)

  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div>
        <p className="text-[13px] font-medium text-foreground">Memory provider</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-tertiary">
          Controls where the active agent stores long-term memories. "Configured" means the plugin
          is set up, not necessarily connected. Switching takes effect when your agent restarts.
        </p>
        {!isActiveAgent && (
          <p
            role="note"
            className="mt-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] leading-relaxed text-foreground-tertiary"
          >
            These controls act on the active agent only. Switch to this agent before changing
            providers or resetting built-in memory.
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-label="Loading" />
          Loading memory status...
        </div>
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      {memoryStatus && (
        <>
          {/* Active provider chip */}
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] text-foreground-tertiary">Active:</span>
            <span className="text-[13px] font-medium text-foreground">
              {memoryStatus.active ? memoryStatus.active : 'Built-in'}
            </span>
            {switchResult?.restart_required && <Badge variant="warning">Restart to apply</Badge>}
          </div>

          {/* Provider catalog (collapsible) */}
          {memoryStatus.providers.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowCatalog((v) => !v)}
                aria-expanded={showCatalog}
                className={cn(
                  'flex items-center gap-2 rounded-lg py-1 text-left text-[13px]',
                  'focus-visible:ad-focus',
                )}
              >
                <ChevronDown
                  className={cn(
                    'size-4 text-foreground-tertiary transition-transform',
                    showCatalog && 'rotate-180',
                  )}
                  aria-hidden
                />
                <span className="text-muted-foreground">
                  {showCatalog
                    ? 'Hide providers'
                    : `${memoryStatus.providers.length} provider${memoryStatus.providers.length === 1 ? '' : 's'} available`}
                </span>
              </button>
              {showCatalog && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {/* Built-in option */}
                  <ProviderOption
                    name=""
                    label="Built-in"
                    description="Hermes writes to MEMORY.md / USER.md in the profile directory."
                    configured
                    isActive={!memoryStatus.active}
                    isSwitching={isSwitching}
                    controlsDisabled={!isActiveAgent}
                    onSelect={() => onSwitchProvider('')}
                  />
                  {memoryStatus.providers.map((p) => (
                    <ProviderOption
                      key={p.name}
                      name={p.name}
                      label={p.name}
                      description={p.description}
                      configured={p.configured}
                      isActive={memoryStatus.active === p.name}
                      isSwitching={isSwitching}
                      controlsDisabled={!isActiveAgent}
                      onSelect={() => onSwitchProvider(p.name)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Built-in file sizes + reset */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-[12px] font-medium text-foreground-tertiary">
              Built-in memory files
            </p>
            <div className="flex gap-3">
              <FileSizeChip label="MEMORY.md" bytes={memoryStatus.builtin_files.memory} />
              <FileSizeChip label="USER.md" bytes={memoryStatus.builtin_files.user} />
            </div>
            <div className="mt-1 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={
                  !isActiveAgent ||
                  isResetting ||
                  (memoryStatus.builtin_files.memory === 0 && memoryStatus.builtin_files.user === 0)
                }
                onClick={() => setResetTarget('all')}
              >
                <Trash2 aria-hidden />
                Reset all memory
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Reset confirm dialog */}
      <ResetDialog
        target={resetTarget}
        isResetting={isResetting}
        builtinFiles={memoryStatus?.builtin_files ?? { memory: 0, user: 0 }}
        onClose={() => setResetTarget(null)}
        onConfirm={(target) => {
          setResetTarget(null)
          onResetMemory(target)
        }}
      />
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
  name: string
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
        disabled={controlsDisabled || isActive || isSwitching}
        className={cn(
          'ad-surface flex w-full min-h-[44px] items-start gap-3 rounded-lg border px-3 py-2 text-left',
          'transition-colors focus-visible:ad-focus',
          isActive
            ? 'border-border-strong bg-surface-1'
            : 'border-border hover:bg-muted/40 disabled:cursor-default',
        )}
        aria-pressed={isActive}
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
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
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

function FileSizeChip({ label, bytes }: { label: string; bytes: number }) {
  return (
    <div className="ad-surface flex flex-col gap-0.5 rounded-lg bg-surface-1 px-2.5 py-2">
      <span className="font-mono text-[11px] text-foreground-tertiary">{label}</span>
      <span className="text-[12px] font-medium text-foreground">{formatBytes(bytes)}</span>
    </div>
  )
}

function ResetDialog({
  target,
  isResetting,
  builtinFiles,
  onClose,
  onConfirm,
}: {
  target: 'all' | 'memory' | 'user' | null
  isResetting: boolean
  builtinFiles: { memory: number; user: number }
  onClose: () => void
  onConfirm: (target: 'all' | 'memory' | 'user') => void
}) {
  if (!target) return null

  const willDelete =
    target === 'all'
      ? ['MEMORY.md', 'USER.md'].filter((_, i) =>
          i === 0 ? builtinFiles.memory > 0 : builtinFiles.user > 0,
        )
      : target === 'memory'
        ? builtinFiles.memory > 0
          ? ['MEMORY.md']
          : []
        : builtinFiles.user > 0
          ? ['USER.md']
          : []

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset built-in memory?</DialogTitle>
          <DialogDescription>
            This permanently deletes{' '}
            {willDelete.length > 0 ? (
              <>
                <strong>{willDelete.join(' and ')}</strong>: the files that store what the agent
                remembers.
              </>
            ) : (
              'the selected memory files (none exist yet, so nothing will change).'
            )}{' '}
            This cannot be undone and does not affect an external provider.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={isResetting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(target)} disabled={isResetting}>
            {isResetting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Resetting...
              </>
            ) : (
              <>
                <RefreshCw aria-hidden />
                Reset memory
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

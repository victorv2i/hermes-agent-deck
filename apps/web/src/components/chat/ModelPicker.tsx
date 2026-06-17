import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, ChevronDown, Lock } from 'lucide-react'
import { ProviderBrandIcon } from '@/features/models/providerBrandIcons'
import { cn } from '@/lib/utils'
import type { ModelEntry } from '@/features/models/types'

/**
 * The composer's model-selector chip → popover (design language §6: "model-
 * selector chip"). Replaces the dead "default" chip with a real picker over the
 * gateway's model list (`useModels`). The chosen model's `qualifiedId` is
 * threaded through `onSelect` so the host can switch providers (T1.2) before the
 * run.
 *
 * KEY + SELECT by `qualifiedId` (`<provider>/<id>`), NOT the bare `id`: the same
 * model id collides across providers (e.g. `gpt-5.4` under both `openai-codex`
 * and `copilot`), so keying by `id` dropped a duplicate row and made a cross-
 * provider pick a silent no-op. The qualified id is unique across the list.
 *
 * A NON-usable model (its provider isn't logged in) is rendered DISABLED with an
 * honest hint ("Connect <provider> to use") instead of being offered as a switch
 * that can only fail (HONEST UI — no fake states).
 *
 * The accent is governed (action/active only), so the trigger reads as a quiet
 * muted chip; the active/selected model is marked with a semantic "current" check
 * (success hue), never an accent fill. The popover rows are native buttons in a
 * labelled listbox — each is Tab-focusable and Enter/Space-activatable, and Radix
 * Popover manages focus/escape/outside-dismiss. Renders nothing when no models
 * are available.
 *
 * SCANNABILITY: the trigger chip and each list row show the vendor's brand mark
 * (via ProviderBrandIcon) — logos make models instantly identifiable without
 * reading the text. The mark is decorative (aria-hidden); the label carries meaning.
 */
export function ModelPicker({
  models,
  value,
  onSelect,
  className,
}: {
  /** The gateway's model list (from `useModels`). */
  models: ModelEntry[]
  /** The currently-selected model's `qualifiedId`, or null before one resolves. */
  value: string | null
  /** Commit a model's `qualifiedId` (the host resolves provider+model + switches). */
  onSelect: (qualifiedId: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (models.length === 0) return null

  const selected = models.find((m) => m.qualifiedId === value) ?? null
  // Strip the redundant `provider/` prefix (the brand mark already carries the
  // vendor) so the chip + rows show the model NAME, not a clipped qualified id.
  const triggerLabel = selected
    ? shortId(labelFor(selected) ?? selected.id)
    : value
      ? shortId(value)
      : 'Model'
  // The trigger chip's brand mark: infer vendor from the selected model id
  const triggerVendor = selected ? vendorFromModel(selected.id) : ''

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="model-picker-trigger"
          aria-label={`Model: ${triggerLabel}. Change model`}
          className={cn(
            'inline-flex h-11 max-w-[200px] items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:ad-focus aria-expanded:text-foreground sm:h-10',
            className,
          )}
        >
          {/* Brand mark for the active model — identity mark, decorative */}
          {triggerVendor && (
            <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
              <ProviderBrandIcon provider={triggerVendor} size={13} />
            </span>
          )}
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={8}
          className="ad-surface z-50 max-h-[min(60vh,320px)] w-max min-w-[220px] max-w-[min(92vw,440px)] overflow-y-auto rounded-xl bg-popover p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="listbox" aria-label="Select a model" className="flex flex-col gap-0.5">
            {models.map((m) => {
              const isSelected = m.qualifiedId === value
              const locked = !m.usable
              const hint = locked ? `Connect ${m.provider} to use` : null
              const vendor = vendorFromModel(m.id)
              return (
                <button
                  key={m.qualifiedId}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  // A non-usable model can only fail to switch — disable it
                  // honestly rather than offer a silent no-op (HONEST UI).
                  disabled={locked}
                  aria-disabled={locked || undefined}
                  title={hint ?? undefined}
                  onClick={() => {
                    if (locked) return
                    onSelect(m.qualifiedId)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:ad-focus sm:min-h-10',
                    locked
                      ? 'cursor-not-allowed text-foreground-tertiary'
                      : isSelected
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center">
                    {isSelected && <Check className="size-3.5 text-success" aria-hidden />}
                    {locked && <Lock className="size-3 text-foreground-tertiary" aria-hidden />}
                  </span>
                  {/* Brand mark per row — identity, decorative, calmer at dense scale */}
                  <span
                    className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
                    aria-hidden
                  >
                    <ProviderBrandIcon provider={vendor} size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{shortId(labelFor(m) ?? m.id)}</span>
                  {hint ? (
                    <span className="shrink-0 text-[11px] text-foreground-tertiary">{hint}</span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-foreground-tertiary">
                      {m.provider}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A model's display label, or null when it has none (fall back to the id). */
function labelFor(model: ModelEntry | null): string | null {
  if (!model) return null
  const label = model.label.trim()
  return label.length > 0 ? label : null
}

/** Trim a provider-qualified id (`anthropic/claude-opus-4` → `claude-opus-4`). */
function shortId(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

/**
 * Derive the vendor slug from a model id. A qualified id like `anthropic/claude-opus-4`
 * → `anthropic`. An unqualified id uses common prefix heuristics.
 */
function vendorFromModel(modelId: string): string {
  const slash = modelId.indexOf('/')
  if (slash > 0) return modelId.slice(0, slash)
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3'))
    return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('llama') || modelId.startsWith('meta')) return 'meta'
  if (modelId.startsWith('mistral') || modelId.startsWith('mixtral')) return 'mistral'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  if (modelId.startsWith('qwen')) return 'qwen'
  if (modelId.startsWith('grok')) return 'xai'
  return modelId
}

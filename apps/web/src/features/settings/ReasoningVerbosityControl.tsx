import { Leaf, ListTree } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useReasoningVerbosity, type VerbosityMode } from '@/features/reasoning/reasoningPrefs'

/**
 * ReasoningVerbosityControl — a dual-audience preference on the Settings
 * surface. Newcomers keep the calm default (reasoning + tool calls collapsed and
 * summarized); a power user can switch to Detailed so every chain and tool call
 * arrives expanded. The choice persists (localStorage) and drives the
 * `defaultOpen` of the in-transcript disclosures (see
 * @/features/reasoning/reasoningPrefs).
 *
 * Rendered as an accessible two-option radiogroup (roving selection, governed
 * amber for the active option per the accent rules), it sits below Density.
 */

interface Option {
  value: VerbosityMode
  label: string
  hint: string
  icon: typeof Leaf
}

const OPTIONS: Option[] = [
  {
    value: 'calm',
    label: 'Calm',
    hint: 'Reasoning & tools stay collapsed (the default)',
    icon: Leaf,
  },
  {
    value: 'detailed',
    label: 'Detailed',
    hint: 'Reasoning & tools open on arrival',
    icon: ListTree,
  },
]

export function ReasoningVerbosityControl() {
  const { verbosity, setVerbosity } = useReasoningVerbosity()

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-base leading-snug font-medium text-foreground">
            Reasoning detail
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            How much thinking and tool detail shows in the transcript. Detailed opens it on arrival.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Reasoning detail"
          className="ad-surface inline-flex shrink-0 rounded-[10px] bg-surface-1 p-1"
        >
          {OPTIONS.map((opt) => {
            const checked = verbosity === opt.value
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                title={opt.hint}
                onClick={() => setVerbosity(opt.value)}
                className={cn(
                  // min-h-11 keeps a 44px touch target on mobile, relaxed to the
                  // compact density on sm+ (touch-manipulation drops tap delay).
                  'inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors sm:min-h-0',
                  'focus-visible:ad-focus',
                  checked
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {opt.label}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

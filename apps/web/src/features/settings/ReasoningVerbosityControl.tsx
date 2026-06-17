import { Leaf, ListTree } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
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
 * sky-blue for the active option per the accent rules), it sits below Density.
 */

const OPTIONS = [
  {
    value: 'calm' as VerbosityMode,
    label: 'Calm',
    hint: 'Reasoning & tools stay collapsed (the default)',
    icon: Leaf,
  },
  {
    value: 'detailed' as VerbosityMode,
    label: 'Detailed',
    hint: 'Reasoning & tools open on arrival',
    icon: ListTree,
  },
]

export function ReasoningVerbosityControl() {
  const { verbosity, setVerbosity } = useReasoningVerbosity()

  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-base leading-snug font-medium text-foreground">
            Reasoning detail
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            How much thinking and tool detail shows in the transcript. Detailed opens it on arrival.
          </p>
        </div>

        <SegmentedControl
          value={verbosity}
          onValueChange={(v) => setVerbosity(v)}
          options={OPTIONS}
          aria-label="Reasoning detail"
        />
      </CardContent>
    </Card>
  )
}

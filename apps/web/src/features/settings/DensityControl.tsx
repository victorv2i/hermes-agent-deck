import { AlignJustify, Rows3 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useDensity, type Density } from './density'

/**
 * DensityControl — the one editable preference on the otherwise read-only
 * Settings surface. A power user with a long session rail can switch from the
 * spacious brand default (Comfortable) to a tighter layout (Compact) that fits
 * more rows and prose per screen. The choice persists (localStorage) and applies
 * app-wide via a `data-density` attribute on <html> (see ./density.ts).
 *
 * Rendered as an accessible two-option radiogroup (roving selection, governed
 * amber for the active option per the accent rules), it lives above the config
 * list so it's reachable regardless of the config load state.
 */

const OPTIONS = [
  {
    value: 'comfortable' as Density,
    label: 'Comfortable',
    hint: 'Spacious (the default)',
    icon: Rows3,
  },
  {
    value: 'compact' as Density,
    label: 'Compact',
    hint: 'Tighter, more per screen',
    icon: AlignJustify,
  },
]

export function DensityControl() {
  const { density, setDensity } = useDensity()

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-base leading-snug font-medium text-foreground">
            Density
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Spacing across the rail and transcript. Compact fits more on screen.
          </p>
        </div>

        <SegmentedControl
          value={density}
          onValueChange={(v) => setDensity(v)}
          options={OPTIONS}
          aria-label="Density"
        />
      </CardContent>
    </Card>
  )
}

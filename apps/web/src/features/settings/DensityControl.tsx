import { AlignJustify, Rows3 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
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

interface Option {
  value: Density
  label: string
  hint: string
  icon: typeof Rows3
}

const OPTIONS: Option[] = [
  {
    value: 'comfortable',
    label: 'Comfortable',
    hint: 'Spacious (the default)',
    icon: Rows3,
  },
  {
    value: 'compact',
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

        <div
          role="radiogroup"
          aria-label="Density"
          className="ad-surface inline-flex shrink-0 rounded-[10px] bg-surface-1 p-1"
        >
          {OPTIONS.map((opt) => {
            const checked = density === opt.value
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                title={opt.hint}
                onClick={() => setDensity(opt.value)}
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

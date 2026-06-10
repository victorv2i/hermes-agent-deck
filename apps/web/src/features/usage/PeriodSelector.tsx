/**
 * Period selector — a small segmented control for the 7 / 14 / 30 day windows.
 * Design-language styled: hairline-bordered pill, amber active segment, calm.
 *
 * a11y (I5): an ARIA radiogroup implementing the roving-tabindex pattern — only
 * the checked radio is in the tab order; ArrowLeft/ArrowRight (and Up/Down) move
 * selection with wrap-around, matching the WAI-ARIA radio group keyboard map.
 */
import { useRef, type KeyboardEvent } from 'react'
import { USAGE_PERIODS, type UsagePeriod } from './types'
import { cn } from '@/lib/utils'

export interface PeriodSelectorProps {
  value: UsagePeriod
  onChange: (period: UsagePeriod) => void
  disabled?: boolean
}

export function PeriodSelector({ value, onChange, disabled }: PeriodSelectorProps) {
  // Refs to each radio button so an arrow keypress can move DOM focus to the
  // newly-selected segment (roving tabindex).
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const selectAt = (index: number) => {
    const next =
      USAGE_PERIODS[((index % USAGE_PERIODS.length) + USAGE_PERIODS.length) % USAGE_PERIODS.length]
    if (next === undefined) return
    onChange(next)
    // Move focus to the now-checked radio so the tab order follows selection.
    const nextIndex = USAGE_PERIODS.indexOf(next)
    buttonsRef.current[nextIndex]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(index - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Usage period"
      className="inline-flex items-center gap-0.5 rounded-[9px] border border-border bg-surface-2/60 p-0.5"
    >
      {USAGE_PERIODS.map((period, index) => {
        const active = period === value
        return (
          <button
            key={period}
            ref={(el) => {
              buttonsRef.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: only the checked radio is reachable via Tab; the
            // arrow keys traverse the rest.
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(period)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // min-h-11 keeps a 44px touch target on mobile, relaxed to the
              // compact desktop density on sm+; min-w-[44px] holds the width.
              'min-h-11 min-w-[44px] touch-manipulation rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none sm:min-h-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {period}d
          </button>
        )
      })}
    </div>
  )
}

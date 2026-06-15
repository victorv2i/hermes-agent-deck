import type React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string | number = string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Optional longer description, shown as the segment's title tooltip. */
  hint?: string
}

export interface SegmentedControlProps<T extends string | number = string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  /** Disables the whole group (no clicks, no arrow nav) and dims it. */
  disabled?: boolean
}

/**
 * SegmentedControl — the one pill-segmented radiogroup for small, mutually
 * exclusive choices (send-key, theme mode, density, usage period, log filters …).
 * Extracted from the hand-rolled copies that had drifted apart across Settings,
 * Connections, Usage and Logs. The ACTIVE segment carries the governed
 * `--primary` action accent (`bg-primary/10 text-primary`); every other segment
 * is neutral. Roving arrow-key navigation (a real WAI-ARIA radiogroup), a 44px
 * touch target on mobile (WCAG 2.5.5), and the one canonical `.ad-focus` ring.
 */
export function SegmentedControl<T extends string | number = string>({
  value,
  onValueChange,
  options,
  className,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: SegmentedControlProps<T>) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const ids = options.map((o) => o.value)
    const i = ids.indexOf(value)
    if (i === -1) return
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ids.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    if (next === null) return
    e.preventDefault()
    onValueChange(ids[next]!)
    // Focus follows selection (WAI-ARIA radiogroup): move focus to the chosen
    // radio so keyboard users stay on the active control.
    const radios = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onKeyDown={onKeyDown}
      className={cn(
        'ad-surface inline-flex shrink-0 rounded-md bg-surface-1 p-1',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((opt) => {
        const checked = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={opt.hint}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              // min-h-11 keeps a 44px touch target on mobile; relaxed to the
              // compact density on sm+ (touch-manipulation drops the tap delay).
              'inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-[0.8rem] font-medium transition-colors motion-reduce:transition-none sm:min-h-0',
              'focus-visible:ad-focus disabled:cursor-not-allowed',
              checked ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

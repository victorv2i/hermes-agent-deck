import type React from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RadioCardOption<T extends string = string> {
  value: T
  label: string
  description?: string
  icon?: LucideIcon
}

export interface RadioCardGroupProps<T extends string = string> {
  value: T
  onValueChange: (value: T) => void
  options: RadioCardOption<T>[]
  'aria-label'?: string
  'aria-labelledby'?: string
  /** Layout override for the grid (e.g. `grid-cols-2`). Defaults to one column. */
  className?: string
}

/**
 * RadioCardGroup — the one selectable-card radiogroup (starting soul, update
 * channel …). Extracted from the hand-rolled tile pickers that had each drifted.
 * The SELECTED card carries the neutral IDENTITY ring (`--border-strong`) and a
 * neutral check — NEVER the sky-blue `--primary` accent, which the spine reserves
 * for actions. Roving arrow-key navigation, one `.ad-focus` ring.
 */
export function RadioCardGroup<T extends string = string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: RadioCardGroupProps<T>) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
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
    const radios = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onKeyDown={onKeyDown}
      className={cn('grid gap-2', className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none',
              'focus-visible:ad-focus',
              selected
                ? 'border-[var(--border-strong)] bg-muted/50'
                : 'border-border hover:border-[var(--border-strong)] hover:bg-muted/30',
            )}
          >
            {Icon ? (
              <Icon className="mt-0.5 size-4 shrink-0 text-foreground-tertiary" aria-hidden />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{opt.label}</span>
              {opt.description ? (
                <span className="text-xs leading-snug text-foreground-tertiary">
                  {opt.description}
                </span>
              ) : null}
            </span>
            {selected ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

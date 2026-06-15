import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  className?: string
}

/**
 * Switch — the one on/off toggle (`role="switch"` + `aria-checked`). Amber when
 * ON is a SANCTIONED active-state use of the accent (not decoration). Extracted
 * from the hand-rolled copies in VoiceToggle / ComposerPrefs so the toggle reads
 * identically everywhere: a 44px touch target on mobile (WCAG 2.5.5) relaxing to
 * a compact pill on sm+, the canonical `.ad-focus` ring, motion-reduce safe.
 * Presentational: value in / change out.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center rounded-full transition-colors',
        'sm:h-6 sm:min-h-0 sm:w-11 sm:min-w-0',
        'focus-visible:ad-focus',
        'disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-primary' : 'bg-muted',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

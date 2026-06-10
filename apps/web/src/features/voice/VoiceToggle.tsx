import { useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * VoiceToggle — an honest, accessible on/off switch (the shared `role="switch"`
 * + `aria-checked` pattern). Amber when ON is a SANCTIONED active-state use of the
 * accent (not decoration). Presentational: value in / change out, so the page
 * owns the real config mutation.
 */
export interface VoiceToggleProps {
  icon: LucideIcon
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
  /** Disabled while a write is in flight. */
  disabled?: boolean
}

export function VoiceToggle({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: VoiceToggleProps) {
  const labelId = useId()
  const hintId = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Icon className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
          {label}
        </p>
        <p id={hintId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          // 44px touch target on mobile (WCAG 2.5.5); compact pill on sm+.
          'relative inline-flex min-h-11 min-w-11 touch-manipulation shrink-0 items-center rounded-full transition-colors',
          'sm:h-6 sm:min-h-0 sm:min-w-0 sm:w-11',
          'focus-visible:ad-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'bg-primary' : 'bg-muted',
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
    </div>
  )
}

import { useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'

/**
 * VoiceToggle — an honest, accessible on/off switch (the shared `role="switch"`
 * + `aria-checked` pattern). Sky-blue when ON is a SANCTIONED active-state use of the
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
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={hintId}
      />
    </div>
  )
}

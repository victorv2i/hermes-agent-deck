import { useId, useState, type FormEvent } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import type { VoiceKeyField as VoiceKeyFieldShape, SetVoiceKeyRequest } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * VoiceKeyField — a masked, SHAPE-ONLY provider-key input (mirror of the
 * messaging TokenField). When the provider is LOCAL (`envVar === null`) there is
 * NO field — a calm "No key needed" line is shown instead. A stored key shows its
 * redacted preview and a Check; the input NEVER echoes the plaintext (it clears
 * on submit), and the value is sent to the BFF once (allowlisted server-side).
 */

const INPUT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus'

export interface VoiceKeyFieldProps {
  field: VoiceKeyFieldShape
  /** Store/replace the key (the page owns the real mutation). */
  onSetKey: (request: SetVoiceKeyRequest) => void
  /** Disabled while a config write is in flight (prevents a conflicting save). */
  disabled?: boolean
}

export function VoiceKeyField({ field, onSetKey, disabled }: VoiceKeyFieldProps) {
  const id = useId()
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)

  // Local provider — no credential to fill. Honest, calm line.
  if (field.envVar === null) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Check className="size-3.5 shrink-0 text-success" aria-hidden />
        No key needed: this provider runs on your machine.
      </p>
    )
  }

  const envVar = field.envVar

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed === '' || disabled) return
    onSetKey({ envVar, value: trimmed })
    // Clear immediately so the plaintext never lingers in the DOM.
    setValue('')
    setReveal(false)
  }

  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit} aria-label={`Set ${envVar}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {field.label}
        </label>
        {field.isSet && field.redactedValue ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11px] text-foreground-tertiary">
            <Check className="size-3 text-success" aria-hidden />
            <span className="min-w-0 truncate">{field.redactedValue}</span>
          </span>
        ) : field.isSet ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-foreground-tertiary">
            <Check className="size-3 text-success" aria-hidden />
            Stored
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            id={id}
            value={value}
            type={reveal ? 'text' : 'password'}
            placeholder={field.isSet ? 'Paste a new key to replace' : 'Paste the API key'}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            className={cn(
              INPUT_CLASS,
              'pr-10 font-mono disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            disabled={disabled}
            aria-label={reveal ? 'Hide key characters' : 'Show key characters'}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-foreground-tertiary transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reveal ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <Button type="submit" disabled={disabled || value.trim() === ''} className="h-10 shrink-0">
          Save key
        </Button>
      </div>
    </form>
  )
}

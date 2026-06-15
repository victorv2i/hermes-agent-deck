/**
 * PromptBar — a calm inline text-prompt strip used for "new file / new folder /
 * rename" without pulling in a modal/dialog dependency. Submits on Enter, cancels
 * on Escape, autofocuses, and surfaces a busy + error state. Design-language:
 * hairline-bordered surface row, amber-focused input, generous targets.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PromptBarProps {
  label: string
  placeholder?: string
  /** Prefill (e.g. the current name when renaming). */
  initialValue?: string
  /** Specific submit copy for the action this prompt is performing. */
  submitLabel?: string
  busy?: boolean
  error?: string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptBar({
  label,
  placeholder,
  initialValue = '',
  submitLabel = 'Create',
  busy,
  error,
  onSubmit,
  onCancel,
}: PromptBarProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-muted/40 px-5 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label
          className="shrink-0 text-xs font-medium text-muted-foreground sm:max-w-40"
          htmlFor="ad-prompt-input"
        >
          {label}
        </label>
        <input
          id="ad-prompt-input"
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit(value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-13 text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ad-focus sm:h-7"
        />
        <Button
          size="xs"
          className="min-h-11 sm:min-h-6"
          onClick={() => onSubmit(value)}
          disabled={busy || value.trim() === ''}
        >
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="min-h-11 sm:min-h-6"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

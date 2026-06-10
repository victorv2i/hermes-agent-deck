/**
 * ConfirmBar — a calm inline confirmation strip for destructive actions (delete)
 * without a modal dependency. Amber-quiet surface, a danger-styled confirm
 * button, Escape to cancel. Matches the design language's "unmissable yet calm"
 * approval treatment.
 */
import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ConfirmBarProps {
  message: string
  confirmLabel?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmBar({
  message,
  confirmLabel = 'Confirm',
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmBarProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="alertdialog"
      aria-label="Confirm"
      className="flex flex-col gap-1 border-b border-destructive/30 bg-destructive/5 px-5 py-2.5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-xs text-foreground">{message}</p>
        <Button
          ref={confirmRef}
          variant="destructive"
          size="xs"
          className="min-h-11 sm:min-h-6"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Loader2 className="animate-spin" />}
          {confirmLabel}
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

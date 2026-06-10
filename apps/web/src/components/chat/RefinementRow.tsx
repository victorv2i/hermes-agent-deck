import { useState, useRef } from 'react'
import { Check, Copy, RefreshCw, AlignLeft, BookOpen } from 'lucide-react'
import { toast } from '@/lib/toast'

/**
 * Contextual refinement row on the LAST completed assistant message.
 * Visible (not hover-only) — a high-use post-response interaction.
 *
 * Each action composes a REAL follow-up prompt and sends it through the normal
 * run path — honest, it truly re-asks. No fake states.
 *
 * Keyboard + SR accessible: every button has an aria-label and 44px min touch
 * target on mobile.
 */

function RefinementButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-foreground-tertiary transition-colors hover:bg-surface-2/60 hover:text-muted-foreground focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-40 sm:min-h-7 sm:px-1.5"
    >
      {children}
    </button>
  )
}

export function RefinementRow({
  messageText,
  onSend,
  onRetry,
  disabled = false,
}: {
  /** The text of the completed assistant message. Used for Copy and as context
   * for the follow-up prompts. */
  messageText: string
  /** Send a follow-up prompt through the normal run path. */
  onSend: (text: string) => void
  /** Retry: re-run the prompting user turn. */
  onRetry: () => void
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = async () => {
    // Only flash "Copied!" on a REAL successful write — never a fake success when
    // the clipboard API is unavailable or the write is denied (honest UI).
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(messageText)
    } catch {
      toast.error('Could not copy: your browser blocked clipboard access')
      return
    }
    toast.success('Copied to clipboard')
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      data-testid="refinement-row"
      className="flex flex-wrap items-center gap-0.5"
      aria-label="Message actions"
    >
      <RefinementButton
        onClick={onRetry}
        label="Retry: regenerate this response"
        disabled={disabled}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Retry
      </RefinementButton>

      <RefinementButton
        onClick={() => onSend('Can you make that shorter and more concise?')}
        label="Shorter: ask for a more concise response"
        disabled={disabled}
      >
        <AlignLeft className="size-3.5" aria-hidden />
        Shorter
      </RefinementButton>

      <RefinementButton
        onClick={() => onSend('Can you elaborate on that with more detail?')}
        label="More detail: ask for a more detailed explanation"
        disabled={disabled}
      >
        <BookOpen className="size-3.5" aria-hidden />
        More detail
      </RefinementButton>

      {/* Copy is a pure clipboard read with no connection dependency, so it stays
          reachable even while a run is in flight or the socket is disconnected —
          only the actions that send a prompt through the run path (above) gate. */}
      <RefinementButton onClick={handleCopy} label={copied ? 'Copied' : 'Copy message'}>
        {copied ? (
          <Check className="size-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {copied ? 'Copied!' : 'Copy'}
      </RefinementButton>
    </div>
  )
}

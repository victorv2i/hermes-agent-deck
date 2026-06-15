import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { CliOpRequest, CliOpResponse } from '@agent-deck/protocol'
import { Button } from './button'
import { cn } from '@/lib/utils'
import { runCliOp } from '@/features/cli-op/api'

/**
 * DoItForMe — the "no-terminal" one-click action primitive.
 *
 * HONESTY RULES (non-negotiable):
 *  - The button label says what will happen in plain English (never jargon).
 *  - The banner reflects the REAL exit code — ok:false shows an error, always.
 *  - No spinner theater: the button shows the running state only while the
 *    BFF call is in flight; it never shows "Done!" before the result arrives.
 *  - The captured stdout pane is READ-ONLY: it renders the scrubbed terminal
 *    output exactly as the BFF returned it (already secret-scrubbed).
 *  - Reduced-motion: `animate-spin` only runs when the user hasn't opted out.
 *    (The `motion-reduce:` Tailwind variant handles this transparently.)
 *
 * ACCESSIBILITY:
 *  - The action button has an explicit `aria-label` (the label prop).
 *  - The result banner has `role="status"` (polite) so screen readers announce
 *    completion without interrupting in-flight speech.
 *  - The stdout pane is `role="log"` (past events, no auto-announcement).
 *  - The button is keyboard-reachable; focus-visible ring uses `--ring` (= `--primary`).
 *  - Minimum touch target: 44×44px enforced via `min-h-[44px]`.
 *
 * DESIGN:
 *  - Primary action button uses `--primary` accent (the per-palette color, NOT amber).
 *  - Radius ≤ 14px (uses the rounded-lg token = 8px).
 *  - Motion ≤ 300ms, no bounce.
 *  - No second accent. No glassmorphism.
 */
export interface DoItForMeProps {
  /**
   * Plain-English label for the action button.
   * Example: "Fix problems automatically" or "List credentials".
   */
  label: string
  /**
   * The whitelisted CLI op to run when the button is clicked.
   * Validated server-side against ALLOWED_OPS.
   */
  op: CliOpRequest
  /**
   * Optional plain-English description shown below the button before any action.
   * Keep it short (one sentence).
   */
  description?: string
  /**
   * Optional className applied to the root wrapper.
   */
  className?: string
}

type RunState = 'idle' | 'running' | 'done'

export function DoItForMe({ label, op, description, className }: DoItForMeProps) {
  const [state, setState] = useState<RunState>('idle')
  const [result, setResult] = useState<CliOpResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  const running = state === 'running'
  const done = state === 'done'

  async function handleClick() {
    setState('running')
    setResult(null)
    setError(null)
    setShowLog(false)
    try {
      const res = await runCliOp(op)
      setResult(res)
      setState('done')
    } catch (err) {
      // A network/transport error (not a hermes exit failure)
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.'
      setError(msg)
      setState('done')
    }
  }

  const succeeded = result?.ok === true

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {description ? (
        <p className="text-13 leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {/* Primary action button — primary accent, 44px touch target */}
        <Button
          onClick={handleClick}
          disabled={running}
          aria-label={label}
          className="min-h-[44px] min-w-[44px] px-4"
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              <span>Running…</span>
            </>
          ) : (
            label
          )}
        </Button>

        {/* Honest result banner — announces itself to screen readers */}
        {done ? (
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex items-center gap-1.5 text-sm',
              succeeded ? 'text-success' : 'text-destructive',
            )}
          >
            {succeeded ? (
              <>
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                Done
              </>
            ) : (
              <>
                <XCircle className="size-4 shrink-0" aria-hidden />
                {error ?? result?.summary ?? 'Failed'}
              </>
            )}
          </span>
        ) : null}
      </div>

      {/* Stdout log — only shown when there is output to show */}
      {done && result && result.stdout.trim().length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className={cn(
              'self-start text-[12px] text-foreground-tertiary underline-offset-2 hover:underline',
              'focus-visible:ad-focus rounded',
            )}
          >
            {showLog ? 'Hide output' : 'Show output'}
          </button>
          {showLog ? (
            <pre
              role="log"
              aria-label="Command output"
              className={cn(
                'ad-surface max-h-56 overflow-auto rounded-lg bg-surface-1 p-3',
                'font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground-tertiary',
              )}
            >
              {result.stdout.trim()}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

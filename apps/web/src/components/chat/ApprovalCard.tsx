import { useEffect, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ApprovalChoice } from '@agent-deck/protocol'
import type { PendingApproval } from '@/state/chatStore'
import { Button } from '@/components/ui/button'

/**
 * Inline approval prompt (not a modal). Amber-accented, unmissable yet calm.
 * Shows the command + description and the gateway-offered choices, mapping each
 * button to the right ApprovalChoice. The parent wires `onRespond` to the
 * chat socket's `respondApproval`.
 *
 * Accessibility (T2.1): this gates command execution, so when it appears
 * mid-stream a keyboard/SR user must be taken straight to the decision. On mount
 * we move focus to the primary Allow button, and the card is an `aria-live`
 * "assertive" labelled `group` so the gate is announced immediately. We do NOT
 * use `role="alertdialog"` — that promises modal/focus-trap semantics this inline
 * card deliberately doesn't implement (the conversation stays interactive).
 *
 * Keyboard accelerators (A2): for the power user on the hottest trust path, the
 * card binds `A` = Allow once and `D` = Deny — but ONLY the safe choices. The
 * permissive grants (`session`/`always`) are deliberately NOT keyboard-bound, so
 * a stray keystroke can never silently grant a standing permission. The handler
 * is scoped to the card (`onKeyDown`, not a `window` listener) so it never steals
 * keys while the user is typing elsewhere in the conversation, and only fires
 * when its choice was actually offered.
 */

/** The hotkey → choice map. Only the SAFEST choices are bound; `session`/
 * `always` stay click-only on purpose (see component doc). */
const ACCELERATOR: Record<string, Extract<ApprovalChoice, 'once' | 'deny'>> = {
  a: 'once',
  d: 'deny',
}

const CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow for session',
  always: 'Always allow',
  deny: 'Deny',
}

// Stable display order; only choices the gateway offered are rendered.
const CHOICE_ORDER: ApprovalChoice[] = ['once', 'session', 'always', 'deny']

export function ApprovalCard({
  approval,
  onRespond,
  busy = false,
  testId = 'approval-card',
}: {
  approval: PendingApproval
  onRespond: (choice: ApprovalChoice) => void
  /** Disable the buttons while a response is in flight. */
  busy?: boolean
  /** The card's `data-testid`. Defaults to the canonical `approval-card`. */
  testId?: string
}) {
  const choices = CHOICE_ORDER.filter((c) => approval.choices.includes(c))
  const allow = choices.filter((c) => c !== 'deny')
  const canDeny = choices.includes('deny')

  // The focus effect's identity key — re-runs per APPROVAL, keyed on
  // `approval_id` (falling back to `run_id`) so a second approval on the SAME run
  // (same run_id, new approval_id) still re-grabs focus instead of stranding the
  // user on a stale control (A3). Extracted so the dep array is statically checkable.
  const approvalKey = approval.approval_id ?? approval.run_id

  // Move focus to the least-permissive Allow button when the gate appears, so a
  // keyboard or screen-reader user is on the decision rather than wherever the
  // stream left them.
  const focusRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    focusRef.current?.focus()
  }, [approvalKey])

  // Card-scoped accelerators (A2): `A` = Allow once, `D` = Deny. Scoped via
  // `onKeyDown` on the card (not a window listener) so it never fires while the
  // user types elsewhere; honors `busy` and only binds choices that were offered.
  // A plain function (the React Compiler memoizes) — wrapping it in useCallback
  // with the freshly-filtered `choices` array defeats memoization anyway.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return
    const choice = ACCELERATOR[e.key.toLowerCase()]
    if (!choice || !choices.includes(choice)) return
    e.preventDefault()
    onRespond(choice)
  }

  return (
    <section
      role="group"
      aria-label="Approval required"
      aria-live="assertive"
      data-testid={testId}
      onKeyDown={onKeyDown}
      // `ad-attention-pulse` (Primitives lane) gives the card ONE calm breathing
      // ring on mount to draw the eye to a gate that scrolls into view — then it
      // settles to the static `ring-1 ring-primary/20` + `border-primary/40`
      // accent so a pending decision never strobes or distracts. Capping the
      // iteration count to 1 here (the keyframe class is `infinite`) mirrors the
      // reduced-motion behavior, where the index.css blanket guard already forces
      // a single, instantly-settled iteration.
      style={{ animationIterationCount: 1 }}
      className="ad-attention-pulse not-prose my-3 overflow-hidden rounded-xl border border-primary/40 bg-primary/5 ring-1 ring-primary/20"
    >
      <div className="flex items-start gap-3 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          {/* Lead with the INTENT in plain language so a non-technical user
              understands what they're approving and why they're being asked —
              BEFORE the raw command. The heading states the ask plainly; the
              gateway's `description` (real wire data, never fabricated) is the
              plain-language summary of what the agent wants to do. The raw
              command stays available below, clearly labelled, for power users. */}
          <p className="text-sm font-medium text-foreground">
            Your agent needs your OK to run this
          </p>
          {approval.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{approval.description}</p>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              It wants to run a command on your computer. Review it below before deciding.
            </p>
          )}
          <p className="mt-2.5 text-[11px] font-medium tracking-wide text-foreground-tertiary uppercase">
            Command
          </p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-card/70 p-2.5 font-mono text-xs leading-relaxed text-foreground ring-1 ring-foreground/10">
            {approval.command}
          </pre>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-primary/20 bg-card/40 px-4 py-3">
        {canDeny && (
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => onRespond('deny')}>
            {CHOICE_LABEL.deny}
            <AcceleratorHint k="D" />
          </Button>
        )}
        {allow.map((choice, i) => (
          <Button
            key={choice}
            // The last allow choice (rendered rightmost) is the primary amber
            // action. Focus, however, lands on the LEAST-permissive allow choice
            // ("once", first) so a stray Enter never silently grants "always".
            ref={i === 0 ? focusRef : undefined}
            variant={i === allow.length - 1 ? 'default' : 'secondary'}
            size="sm"
            disabled={busy}
            onClick={() => onRespond(choice)}
          >
            {CHOICE_LABEL[choice]}
            {/* Only "Allow once" carries a key hint — the permissive grants are
                deliberately not keyboard-bound. */}
            {choice === 'once' && <AcceleratorHint k="A" />}
          </Button>
        ))}
      </div>
    </section>
  )
}

/**
 * A small key-cap hint appended inside a button. `aria-hidden` so it never
 * pollutes the button's accessible name (which stays e.g. "Allow once") — it is
 * purely a sighted-power-user affordance for the A2 accelerators.
 */
function AcceleratorHint({ k }: { k: string }) {
  return (
    <kbd
      aria-hidden
      className="ml-1 hidden rounded border border-current px-1 font-mono text-[10px] leading-none opacity-50 sm:inline-block"
    >
      {k}
    </kbd>
  )
}

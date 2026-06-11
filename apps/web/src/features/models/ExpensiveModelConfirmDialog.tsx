import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** The pending expensive-model confirm: the gateway's honest warning plus the
 * (provider, model) pair the user picked, held until they decide. */
export interface ExpensiveModelConfirm {
  provider: string
  model: string
  /** The gateway guard's `confirm_message` — its honest pricing warning. */
  message: string
}

/**
 * The expensive-model switch confirm — the app's Dialog primitive (focus-trap +
 * ARIA + reduced-motion for free), matching how McpRoute/SystemPage/SessionList
 * confirm a consequential action. Shown when the gateway's expensive-model
 * guard declined a `POST /api/model/set` with `confirm_required` instead of
 * switching: the guard's own `confirm_message` is surfaced verbatim, and ONLY
 * the explicit "Switch anyway" button re-posts with the confirm flag — never an
 * auto-confirm. Cancel is the default-focused action (cancel-default) so a
 * reflexive Enter never green-lights an expensive switch.
 */
export function ExpensiveModelConfirmDialog({
  confirm,
  busy,
  onConfirm,
  onCancel,
}: {
  confirm: ExpensiveModelConfirm | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={confirm !== null}
      onOpenChange={(next) => {
        // Any close path (overlay / Escape / X) declines — never confirms — and
        // is ignored while the confirmed switch is in flight.
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Switch to {confirm?.model ?? 'this model'}?</DialogTitle>
          <DialogDescription>
            {confirm?.message ?? 'This model is priced well above typical models.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          {/* Cancel is the default-focused, default action (cancel-default). */}
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Switch anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

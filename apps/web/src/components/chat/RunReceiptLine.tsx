/**
 * The per-run cost receipt — one muted line under a COMPLETED assistant turn:
 * `64.3K in / 1.2K out / included (subscription)`.
 *
 * Renders NOTHING when the run carried no usage (honest absence, never zeros).
 * The tokens are the gateway's exact per-run `run.completed` usage riding the
 * turn; the billing segment comes from the same server-derived billing mode the
 * Usage page reconciles. The hover tooltip carries the exact numbers plus what
 * they measure ("Measured for this run"). Part of the turn footer — rendered
 * with the turn, so no live region is needed (the polite ChatLiveRegion already
 * narrates the reply itself).
 */
import type { TokenUsage } from '@agent-deck/protocol'
import { buildRunReceipt, receiptLine, receiptTitle } from '@/features/usage/runReceipt'

export function RunReceiptLine({
  usage,
  billingMode,
}: {
  /** The turn's per-run usage (gateway `run.completed`); absent → no receipt. */
  usage?: TokenUsage
  /** Server-derived period billing mode (`UsageSummary.billingMode`); anything
   * unresolved degrades to a tokens-only line — never implies "free". */
  billingMode?: string
}) {
  const receipt = buildRunReceipt(usage, billingMode)
  if (!receipt) return null
  return (
    <p
      data-testid="run-receipt"
      title={receiptTitle(receipt)}
      className="text-[11px] text-foreground-tertiary tabular-nums"
    >
      {receiptLine(receipt)}
    </p>
  )
}

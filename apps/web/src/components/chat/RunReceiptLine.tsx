/**
 * The per-run cost receipt — one muted line under a COMPLETED assistant turn:
 * `64.3K in / 1.2K out / included (subscription)`.
 *
 * Renders NOTHING when the run carried no usage (honest absence, never zeros).
 * The tokens are the gateway's exact per-run `run.completed` usage riding the
 * turn; the billing segment comes from the same server-derived billing mode the
 * Usage page reconciles. When a real wall-clock `duration` is available, the
 * line also shows the run time and output throughput (tok/s). The hover tooltip
 * carries the exact numbers plus what they measure ("Measured for this run").
 * Part of the turn footer — rendered with the turn, so no live region is needed
 * (the polite ChatLiveRegion already narrates the reply itself).
 */
import type { TokenUsage } from '@agent-deck/protocol'
import {
  buildRunReceipt,
  formatDuration,
  receiptLine,
  receiptTitle,
} from '@/features/usage/runReceipt'

export function RunReceiptLine({
  usage,
  billingMode,
  duration,
}: {
  /** The turn's per-run usage (gateway `run.completed`); absent → no receipt. */
  usage?: TokenUsage
  /** Server-derived period billing mode (`UsageSummary.billingMode`); anything
   * unresolved degrades to a tokens-only line — never implies "free". */
  billingMode?: string
  /** Wall-clock seconds for this run. When present and > 0, the receipt also
   * shows the duration and output tok/s. Never invented — omitted when absent. */
  duration?: number
}) {
  const receipt = buildRunReceipt(usage, billingMode)
  if (!receipt) return null

  const hasDuration = duration !== undefined && duration > 0
  const hasThroughput = hasDuration && receipt.outputTokens > 0
  const tokPerSec = hasThroughput ? Math.round(receipt.outputTokens / duration!) : null

  const speedSegment = hasDuration
    ? `${formatDuration(duration!)}${tokPerSec !== null ? ` · ${tokPerSec} tok/s` : ''}`
    : null

  return (
    <p
      data-testid="run-receipt"
      title={receiptTitle(receipt)}
      className="text-[11px] text-foreground-tertiary tabular-nums"
    >
      {receiptLine(receipt)}
      {speedSegment && (
        <>
          <span aria-hidden className="mx-1 opacity-40">
            ·
          </span>
          {speedSegment}
        </>
      )}
    </p>
  )
}

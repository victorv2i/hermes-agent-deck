/**
 * Per-run cost receipt — pure builders for the muted line under a completed
 * assistant turn (`64.3K in / 1.2K out / included (subscription)`).
 *
 * SOURCE OF TRUTH. The token numbers are the gateway's `run.completed` usage,
 * relayed verbatim by the BFF onto the turn (`source: 'run_event'`). They are
 * EXACT for the run: hermes creates a fresh agent per `/v1/runs` run whose token
 * counters start at zero and count only that run's own model calls — a
 * concurrent run or background fork sharing the session id can never leak in.
 * The billing mode is the SAME server-derived signal the Usage page reconciles
 * (`UsageSummary.billingMode` from `GET /api/agent-deck/usage`), so the receipt
 * and the Usage surface can never tell two different billing stories.
 *
 * HONESTY RULES:
 *  - No usage on the wire → NO receipt (null), never zeros.
 *  - `estCostUsd` is always null today: hermes's run lifecycle carries tokens
 *    only (no per-run dollar field), and deriving dollars from window aggregates
 *    would be fabrication. Dollars appear only if a real per-run price ever
 *    lands on the wire.
 *  - An unresolved billing signal renders NO billing segment (tokens only) —
 *    "unknown" must not read as "free".
 *  - Historical turns seeded from hermes transcripts carry no per-run usage
 *    (state.db's per-message token_count is unpopulated in practice), so they
 *    honestly have no receipt; only runs completed live get one.
 */
import {
  RunReceipt as RunReceiptSchema,
  UsageBillingMode,
  type RunReceipt,
  type TokenUsage,
} from '@agent-deck/protocol'
import { formatCost, formatTokens, formatTokensFull } from '@/lib/format'

/** What the numbers measure — surfaced in the receipt tooltip. */
const RUN_EVENT_ATTRIBUTION = 'Measured for this run'

/**
 * Build the receipt for a completed run, or null when the run carried no usage
 * (honest absence — the line simply doesn't render). `billingMode` is the
 * server-derived period mode from the Usage summary; anything outside the
 * governed set (including a missing summary) degrades to 'unknown'.
 */
export function buildRunReceipt(
  usage: TokenUsage | undefined,
  billingMode?: string,
): RunReceipt | null {
  if (!usage) return null
  const mode = UsageBillingMode.safeParse(billingMode)
  return RunReceiptSchema.parse({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    // Real per-run dollars don't exist on the hermes wire — never derived.
    estCostUsd: null,
    billingMode: mode.success ? mode.data : 'unknown',
    source: 'run_event',
    attribution: RUN_EVENT_ATTRIBUTION,
  })
}

/**
 * The billing segment of the receipt line, or null to omit it:
 *  - subscription → "included (subscription)" (a flat plan covers it — not free)
 *  - metered      → real dollars when present, else "billed per use" (a per-call
 *                   bill lands with the provider; hermes records no per-run $)
 *  - local        → "no billed cost" (genuinely nothing to bill)
 *  - unknown      → omitted (we don't know — never imply free)
 */
export function receiptBillingSegment(receipt: RunReceipt): string | null {
  switch (receipt.billingMode) {
    case 'subscription':
      return 'included (subscription)'
    case 'metered':
      return formatCost(receipt.estCostUsd) ?? 'billed per use'
    case 'local':
      return 'no billed cost'
    default:
      return null
  }
}

/** The one muted line: `64.3K in / 1.2K out / included (subscription)`. */
export function receiptLine(receipt: RunReceipt): string {
  const tokens = `${formatTokens(receipt.inputTokens)} in / ${formatTokens(receipt.outputTokens)} out`
  const billing = receiptBillingSegment(receipt)
  return billing ? `${tokens} / ${billing}` : tokens
}

/** The hover tooltip: exact numbers plus what they measure. */
export function receiptTitle(receipt: RunReceipt): string {
  const exact = `${formatTokensFull(receipt.inputTokens)} input tokens, ${formatTokensFull(
    receipt.outputTokens,
  )} output tokens.`
  const source =
    receipt.source === 'run_event'
      ? `${receipt.attribution ?? RUN_EVENT_ATTRIBUTION}: counted from this run's own model calls.`
      : 'Session growth during this run; concurrent activity on the same session may be included.'
  const billing =
    receipt.billingMode === 'subscription'
      ? 'Covered by your flat subscription, not billed per call.'
      : receipt.billingMode === 'metered'
        ? 'Billed per use by your provider; hermes records no per-run dollar amount.'
        : receipt.billingMode === 'local'
          ? 'No rate card for this provider, so there is nothing to bill.'
          : ''
  return [exact, source, billing].filter(Boolean).join(' ')
}

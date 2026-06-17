/**
 * Cache-hit ratio compute for the Usage surface. Pure, unit-tested.
 *
 * The Hermes dashboard records prompt-side tokens in two ADDITIVE buckets:
 * `input_tokens` (fresh, non-cached prompt tokens) and `cache_read_tokens`
 * (prompt context reused from the provider cache). The dashboard itself sums
 * them separately (`total = input + output + cache_read + cache_write`, see
 * hermes `agent/insights.py`), confirming `input_tokens` EXCLUDES cache reads.
 *
 * So the honest cache-hit ratio – the fraction of prompt-side (input) tokens
 * that were served from cache rather than freshly processed – is:
 *
 *     cacheRead / (cacheRead + nonCachedInput)
 *
 * Output is `null` when there is no prompt-side usage at all (divide-by-zero):
 * a fresh window, or one with only output. A `null` ratio is the honest empty
 * state ("–"), distinct from a real 0% (cached usage exists, but none was a hit
 * – which here means cacheRead is 0 while input is non-zero → ratio 0).
 */

export interface CacheHitInput {
  /** Prompt tokens served from the provider cache (`cache_read_tokens`). */
  cacheReadTokens: number
  /** Fresh, non-cached prompt tokens (`input_tokens`, excludes cache reads). */
  inputTokens: number
}

/**
 * The cache-hit ratio as a fraction in [0, 1], or `null` when there is no
 * prompt-side usage to measure against (the honest empty state). Non-finite or
 * negative inputs are treated as 0.
 */
export function cacheHitRatio({ cacheReadTokens, inputTokens }: CacheHitInput): number | null {
  const cacheRead = sanitize(cacheReadTokens)
  const input = sanitize(inputTokens)
  const denominator = cacheRead + input
  if (denominator <= 0) return null
  return cacheRead / denominator
}

/** Format a ratio (0..1) as a whole-percent label, e.g. 0.842 → "84%". */
export function formatCacheHitPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '–'
  const pct = Math.round(clamp01(ratio) * 100)
  return `${pct}%`
}

function sanitize(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

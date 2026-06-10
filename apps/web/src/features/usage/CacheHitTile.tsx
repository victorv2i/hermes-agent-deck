/**
 * CacheHitTile — a single headline tile showing the prompt-cache hit rate, the
 * fraction of prompt-side (input) tokens served from the provider cache rather
 * than freshly processed. Sits alongside the other Usage stat tiles and reuses
 * the shared {@link StatCard} primitive, so it inherits the neutral, AA-safe,
 * amber-free card vocabulary (the spine reserves amber for actions / live state,
 * never decoration — a ratio is not an active accent).
 *
 * Purely presentational: the ratio is computed from fields already present in
 * the usage response (`cacheReadTokens`, `inputTokens`) — no new fetch.
 *
 * Honest empty state: when there is no prompt-side usage at all, the value reads
 * "—" (via the compute returning `null`), distinct from a genuine 0% (input
 * existed but none was a cache hit).
 */
import { DatabaseZap } from 'lucide-react'
import { StatCard } from './StatCard'
import { cacheHitRatio, formatCacheHitPct } from './cacheHit'
import { formatTokens } from './format'

export interface CacheHitTileProps {
  /** Prompt tokens served from the provider cache (`totals.cacheReadTokens`). */
  cacheReadTokens: number
  /** Fresh, non-cached prompt tokens (`totals.inputTokens`). */
  inputTokens: number
}

export function CacheHitTile({ cacheReadTokens, inputTokens }: CacheHitTileProps) {
  const ratio = cacheHitRatio({ cacheReadTokens, inputTokens })
  const value = formatCacheHitPct(ratio)

  const sub =
    ratio === null
      ? 'No cached usage yet'
      : `${formatTokens(cacheReadTokens)} cached / ${formatTokens(cacheReadTokens + inputTokens)} prompt tokens`

  return (
    <StatCard
      label="Hit rate"
      value={value}
      sub={sub}
      icon={<DatabaseZap className="size-3.5" />}
      info="Cache hit rate: the share of prompt (input) tokens served from the provider cache instead of freshly processed (cache-read ÷ (cache-read + non-cached input)). Higher means more context was reused, often cheaper and faster."
    />
  )
}

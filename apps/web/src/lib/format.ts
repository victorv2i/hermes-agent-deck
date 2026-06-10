/**
 * Shared display formatters — the ONE source of truth across surfaces.
 *
 * Before this module, cost/token formatting had diverged: the Usage surface
 * rendered a bare "$0.00" (a "wall of zeros"), while SessionHistory omitted a
 * genuine zero and showed an honest "<$0.01" for sub-cent costs. This converges
 * on the calmer SessionHistory behaviour everywhere. Pure functions — unit-tested.
 */

// `formatRelative` is canonical in the sessions grouping module (the rail uses
// it for row ages); re-export it here so surfaces have a single import for all
// display formatters rather than reaching across feature folders.
export { formatRelative } from '@/features/sessions/grouping'

/**
 * A calm USD cost label. A genuinely-zero (or absent / non-finite) cost is
 * OMITTED — returns `null` — so a surface never shows a wall of "$0.00".
 * Anything that rounds to nothing at cent precision shows the honest "<$0.01"
 * rather than a misleading rounded zero; otherwise two-decimal dollars with
 * thousands separators.
 */
export function formatCost(cost: number | null | undefined): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return null
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Compact token count: 1234 → "1.2K", 2_500_000 → "2.5M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${trimZero(n / 1000)}K`
  if (abs < 1_000_000_000) return `${trimZero(n / 1_000_000)}M`
  return `${trimZero(n / 1_000_000_000)}B`
}

/** Full token count with thousands separators: 1234567 → "1,234,567". */
export function formatTokensFull(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Drop a trailing ".0" from a one-decimal number ("1.0" → "1"). */
function trimZero(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

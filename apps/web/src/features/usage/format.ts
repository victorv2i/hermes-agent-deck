/**
 * Date formatters for the Usage trend axis/tooltips. The token and cost
 * formatters now live in the shared `lib/format` module (one source of truth);
 * they're re-exported here so existing Usage imports keep working unchanged.
 * Pure functions — unit-tested.
 */

export { formatTokens, formatTokensFull, formatCost } from '@/lib/format'

/**
 * Round a positive count UP to a clean chart-axis ceiling (1, 2 or 5 times a
 * power of ten), so y-axis ticks read "1M / 500K / 0" instead of raw data
 * peaks like "991.9K / 496K / 0". Halves of these ceilings are also clean
 * (500K, 1M, 2.5M), so the midline tick stays round too.
 */
export function niceAxisMax(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(n))
  const frac = n / base
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return nice * base
}

/** A short weekday + day label for a YYYY-MM-DD string, e.g. "Sat 23". The
 * weekday/day parts are composed explicitly so the order is deterministic
 * regardless of the runtime's locale data ordering. */
export function formatDayLabel(iso: string): string {
  // Parse as UTC midnight so the label is stable regardless of the viewer's TZ.
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })
  return `${weekday} ${day}`
}

/** A fuller date label for tooltips/titles, e.g. "May 23, 2026". */
export function formatDayFull(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

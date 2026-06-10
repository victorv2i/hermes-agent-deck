/**
 * Subsequence ("fuzzy") match for the Files go-to-file filter (T2.6): every
 * character of the lowercased query must appear, in order, within the lowercased
 * name. An empty query matches everything. Cheap and predictable — a presence
 * test, not a scoring algorithm, which is all a single-level listing needs.
 */
export function fuzzyMatch(name: string, query: string): boolean {
  if (!query) return true
  const haystack = name.toLowerCase()
  const needle = query.toLowerCase()
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return i === needle.length
}

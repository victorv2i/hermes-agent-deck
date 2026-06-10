/**
 * Data hook for the `@`-mention file picker.
 *
 * Queries the EXISTING `/api/agent-deck/files` surface through the converged
 * `apiFetch` (via the Files `api.ts`), fuzzy-filtering file entries by the
 * `@`-query — the same subsequence matcher the Files go-to-file filter uses.
 * Directories are skipped (a mention references a readable file). No new
 * backend; no run-path change. LOCAL-ONLY.
 *
 * Lives in its own `.ts` (not the picker's `.tsx`) so the component file exports
 * only a component — the project's react-refresh convention (hooks/constants in
 * `.ts`, components in `.tsx`).
 *
 * NOTE: this is a thin, root-level lister so the foundation is functional + tested
 * today; the Integration agent may widen it to a recursive/search source without
 * changing this hook's surface.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchRoots, fetchListing, type FileEntry } from '@/features/files/api'
import { fuzzyMatch } from '@/features/files/fuzzy'
import type { MentionFile } from './MentionPicker'

/** How many file results to offer at once (keeps the popdown calm). */
export const MENTION_RESULT_LIMIT = 20

export interface UseFileMentions {
  results: MentionFile[]
  loading: boolean
  error: Error | null
}

/**
 * Fetch + fuzzy-filter workspace files for an `@`-query. Resolves the first
 * workspace root and lists it, then subsequence-matches file entries by the
 * query. A null/empty query still lists the root (so the picker can show files
 * the moment `@` is typed). Fetches are aborted on unmount.
 *
 * Returns `{ results, loading, error }`.
 */
export function useFileMentions(query: string): UseFileMentions {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // The listing is query-independent (one root); the query only filters below, so
  // we fetch once per mount — re-fetching as the user types would be wasteful.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const { roots } = await fetchRoots(controller.signal)
        const root = roots[0]
        if (!root) {
          if (!cancelled) setEntries([])
          return
        }
        const listing = await fetchListing(root.id, '', controller.signal)
        if (!cancelled) setEntries(listing.entries)
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setEntries([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const results = useMemo<MentionFile[]>(() => {
    return entries
      .filter((e) => e.type === 'file' && fuzzyMatch(e.name, query))
      .slice(0, MENTION_RESULT_LIMIT)
      .map((e) => ({ name: e.name, path: e.path }))
  }, [entries, query])

  return { results, loading, error }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSessions } from '@/features/sessions/hooks'
import { useJobs } from '@/features/jobs/hooks'
import { computeAwayDigest, type AwayDigest } from './digest'
import { readLastSeenAt, writeLastSeenAt } from './lastSeenStore'

/** The comparison window, captured ONCE at mount (read-safe via lazy state). */
interface AwayWindow {
  /** The previous last-seen mark (ms), or null on first visit. */
  prevSeenAt: number | null
  /** The frozen mount time (ms). */
  now: number
}

/** What the away-digest hook returns: the computed digest (or null) + dismiss. */
export interface UseAwayDigest {
  /** The honest digest to render, or null when there is nothing to show. */
  digest: AwayDigest | null
  /** Hide the digest for this return (sticks for the window's lifetime). */
  dismiss: () => void
}

/**
 * useAwayDigest: the single connecting seam for the "While you were away" card.
 * It REUSES the data the app already loads (the sessions list + the cron jobs
 * list via their existing hooks), so it adds no new gateway call and no polling
 * loop of its own; the digest is computed from whatever those queries have.
 *
 * The load-bearing sequencing (honesty + correctness):
 *  1. On mount it reads the PREVIOUS `lastSeenAt` and freezes a `now`, BOTH
 *     captured once (lazy refs), so the async session/jobs data arriving on a
 *     later render never shifts the window out from under the comparison.
 *  2. It then writes `now` as the new mark (once), so the NEXT return measures
 *     from this moment.
 *  3. It computes the digest from the live data against the FROZEN previous mark.
 *
 * First visit (no stored mark) and below-threshold returns yield null (handled in
 * {@link computeAwayDigest}). A per-mount `dismissed` flag hides the card for the
 * rest of this return after the user closes it, without re-appearing on a data
 * refetch.
 *
 * Returned as an object (not the raw digest) so the route can wire `dismiss`
 * alongside the value, mirroring the app's other small UI hooks.
 */
export function useAwayDigest(): UseAwayDigest {
  // Freeze the comparison window ONCE at mount via a lazy state initializer. This
  // is render-SAFE (unlike reading a ref during render) and, because the setter is
  // never called, the values never change across the re-renders the async queries
  // trigger, so a late-arriving finished run is still measured against the real
  // previous visit, not against `now`.
  const [mountWindow] = useState<AwayWindow>(() => ({
    prevSeenAt: readLastSeenAt(),
    now: Date.now(),
  }))

  // Advance the stored mark to the frozen `now` exactly once, AFTER the previous
  // value was captured above. The empty dep array runs it a single time per mount.
  useEffect(() => {
    writeLastSeenAt(mountWindow.now)
  }, [mountWindow.now])

  const [dismissed, setDismissed] = useState(false)
  const dismiss = useCallback(() => setDismissed(true), [])

  // Reuse the app's existing data. `useSessions()` is the same rail query; a
  // generous page covers the absence window without a bespoke fetch. `useJobs()`
  // is the shared cron list. Neither adds a new poll here.
  const sessions = useSessions({ limit: 100, order: 'recent' })
  const jobs = useJobs()

  const digest = useMemo<AwayDigest | null>(() => {
    if (dismissed) return null
    return computeAwayDigest({
      sessions: sessions.data?.sessions ?? [],
      jobs: jobs.data ?? [],
      lastSeenAt: mountWindow.prevSeenAt,
      now: mountWindow.now,
    })
  }, [dismissed, sessions.data, jobs.data, mountWindow])

  return { digest, dismiss }
}

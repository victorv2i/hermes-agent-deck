import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAwayDigest } from './useAwayDigest'
import { AWAY_LAST_SEEN_STORAGE_KEY, writeLastSeenAt } from './lastSeenStore'
import { AWAY_THRESHOLD_MS } from './digest'
import type { SessionListResponse } from '@/features/sessions/types'
import type { CronJob } from '@/features/jobs/types'

// The hook reuses the existing data hooks; mock them so the test drives the
// inputs directly (no network), exactly as the app's other connected tests do.
const useSessionsMock = vi.fn()
const useJobsMock = vi.fn()

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: (...args: unknown[]) => useSessionsMock(...args),
}))
vi.mock('@/features/jobs/hooks', () => ({
  useJobs: (...args: unknown[]) => useJobsMock(...args),
}))

const NOW = Date.UTC(2026, 5, 16, 12, 0, 0)
const SEC = 1000

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function sessionsResult(sessions: SessionListResponse['sessions']) {
  return { data: { sessions, total: sessions.length } }
}
function jobsResult(jobs: CronJob[]) {
  return { data: jobs }
}

function completedSession(id: string, lastActiveMs: number) {
  return {
    id,
    source: 'cron',
    model: 'gpt-5',
    title: `Run ${id}`,
    preview: '',
    started_at: Math.floor((lastActiveMs - 60_000) / SEC),
    last_active: Math.floor(lastActiveMs / SEC),
    message_count: 2,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: null,
  }
}

describe('useAwayDigest', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsMock.mockReset()
    useJobsMock.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null on the first-ever visit (and then records now)', () => {
    useSessionsMock.mockReturnValue(sessionsResult([completedSession('a', NOW - 60_000)]))
    useJobsMock.mockReturnValue(jobsResult([]))

    const { result } = renderHook(() => useAwayDigest(), { wrapper })
    // First visit → nothing to catch up on.
    expect(result.current.digest).toBeNull()
    // But the visit IS recorded, so a later return can compute against it.
    expect(localStorage.getItem(AWAY_LAST_SEEN_STORAGE_KEY)).toBe(String(NOW))
  })

  it('computes a digest against the PREVIOUS lastSeen, then advances the mark to now', () => {
    const twoHoursAgo = NOW - 2 * 60 * 60 * 1000
    writeLastSeenAt(twoHoursAgo)
    // A chat finished 10 minutes ago, after last seen.
    useSessionsMock.mockReturnValue(sessionsResult([completedSession('done', NOW - 10 * 60_000)]))
    useJobsMock.mockReturnValue(jobsResult([]))

    const { result } = renderHook(() => useAwayDigest(), { wrapper })
    expect(result.current.digest).not.toBeNull()
    expect(result.current.digest!.runs.completed).toBe(1)
    // The digest was computed against the OLD mark…
    expect(result.current.digest!.sinceMs).toBe(twoHoursAgo)
    // …and the stored mark advanced to now for the next return.
    expect(localStorage.getItem(AWAY_LAST_SEEN_STORAGE_KEY)).toBe(String(NOW))
  })

  it('stays null for a below-threshold absence (quick refresh)', () => {
    writeLastSeenAt(NOW - (AWAY_THRESHOLD_MS - 60_000))
    useSessionsMock.mockReturnValue(sessionsResult([completedSession('done', NOW - 30_000)]))
    useJobsMock.mockReturnValue(jobsResult([]))

    const { result } = renderHook(() => useAwayDigest(), { wrapper })
    expect(result.current.digest).toBeNull()
  })

  it('hides the digest after dismiss (same return)', () => {
    writeLastSeenAt(NOW - 2 * 60 * 60 * 1000)
    useSessionsMock.mockReturnValue(sessionsResult([completedSession('done', NOW - 10 * 60_000)]))
    useJobsMock.mockReturnValue(jobsResult([]))

    const { result } = renderHook(() => useAwayDigest(), { wrapper })
    expect(result.current.digest).not.toBeNull()
    act(() => result.current.dismiss())
    expect(result.current.digest).toBeNull()
  })

  it('does not change the window when the data arrives on a later render', () => {
    const twoHoursAgo = NOW - 2 * 60 * 60 * 1000
    writeLastSeenAt(twoHoursAgo)
    // First render: queries still loading (no data yet).
    useSessionsMock.mockReturnValue({ data: undefined })
    useJobsMock.mockReturnValue({ data: undefined })

    const { result, rerender } = renderHook(() => useAwayDigest(), { wrapper })
    // Nothing to show yet (no data), and the mark is already advanced.
    expect(result.current.digest).toBeNull()
    expect(localStorage.getItem(AWAY_LAST_SEEN_STORAGE_KEY)).toBe(String(NOW))

    // Data arrives later, the window is still the ORIGINAL prev mark, so the
    // late-arriving finished run is still caught (not measured against `now`).
    useSessionsMock.mockReturnValue(sessionsResult([completedSession('late', NOW - 5 * 60_000)]))
    useJobsMock.mockReturnValue(jobsResult([]))
    rerender()
    expect(result.current.digest).not.toBeNull()
    expect(result.current.digest!.sinceMs).toBe(twoHoursAgo)
  })
})

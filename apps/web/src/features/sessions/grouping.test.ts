import { describe, it, expect } from 'vitest'
import { groupSessions, formatRelative, splitRecent } from './grouping'
import type { SessionSummary } from './types'

function s(id: string, lastActiveMs: number): SessionSummary {
  return {
    id,
    source: 'cli',
    model: 'm',
    title: id,
    preview: '',
    started_at: Math.floor(lastActiveMs / 1000),
    last_active: Math.floor(lastActiveMs / 1000),
    message_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
  }
}

describe('groupSessions', () => {
  // Fixed "now": 2026-05-29 12:00 local.
  const now = new Date(2026, 4, 29, 12, 0, 0).getTime()
  const DAY = 86_400_000

  it('buckets by Today / Yesterday / Earlier using local-day boundaries', () => {
    const today = s('today', now - 3_600_000) // 1h ago
    const yesterday = s('yest', now - DAY) // ~yesterday noon
    const earlier = s('old', now - DAY * 5)

    const groups = groupSessions([earlier, yesterday, today], now)
    const labels = groups.map((g) => g.label)
    expect(labels).toEqual(['Today', 'Yesterday', 'Earlier'])
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['today'])
    expect(groups[1]!.sessions.map((x) => x.id)).toEqual(['yest'])
    expect(groups[2]!.sessions.map((x) => x.id)).toEqual(['old'])
  })

  it('sorts within a group by last_active descending and drops empty groups', () => {
    const a = s('a', now - 1_000)
    const b = s('b', now - 5_000)
    const groups = groupSessions([b, a], now)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Today')
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupSessions([], now)).toEqual([])
  })
})

describe('splitRecent', () => {
  const now = new Date(2026, 4, 29, 12, 0, 0).getTime()
  const DAY = 86_400_000

  it('floats the N most-recently-active sessions into a recency slice (most-recent first)', () => {
    const a = s('a', now - 1_000)
    const b = s('b', now - 5_000)
    const c = s('c', now - DAY * 3)
    const { recent, rest } = splitRecent([c, b, a], 2)
    expect(recent.map((x) => x.id)).toEqual(['a', 'b'])
    expect(rest.map((x) => x.id)).toEqual(['c'])
  })

  it('does not duplicate a session across recent and rest', () => {
    const a = s('a', now - 1_000)
    const b = s('b', now - 5_000)
    const { recent, rest } = splitRecent([a, b], 1)
    const ids = [...recent, ...rest].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('yields no recent group when limit <= 0 or the list is empty', () => {
    const a = s('a', now)
    expect(splitRecent([a], 0)).toEqual({ recent: [], rest: [a] })
    expect(splitRecent([], 3)).toEqual({ recent: [], rest: [] })
  })

  it('puts everything in recent when the limit meets/exceeds the count', () => {
    const a = s('a', now - 1_000)
    const b = s('b', now - 5_000)
    const { recent, rest } = splitRecent([b, a], 5)
    expect(recent.map((x) => x.id)).toEqual(['a', 'b'])
    expect(rest).toEqual([])
  })
})

describe('formatRelative', () => {
  const now = new Date(2026, 4, 29, 12, 0, 0).getTime()
  it('renders coarse relative ages', () => {
    expect(formatRelative(Math.floor((now - 30_000) / 1000), now)).toBe('just now')
    expect(formatRelative(Math.floor((now - 5 * 60_000) / 1000), now)).toBe('5m ago')
    expect(formatRelative(Math.floor((now - 3 * 3_600_000) / 1000), now)).toBe('3h ago')
    expect(formatRelative(Math.floor((now - 2 * 86_400_000) / 1000), now)).toBe('2d ago')
  })
})

import { describe, it, expect } from 'vitest'
import {
  CHANGELOG,
  RECENT_CHANGELOG,
  RECENT_CHANGELOG_LIMIT,
  formatChangelogDate,
} from './changelog'

describe('home changelog', () => {
  it('seeds the recent shipped items (agents hub, Clay & Sky default, workspace fixes, themes)', () => {
    const ids = CHANGELOG.map((e) => e.id)
    expect(ids).toContain('agents-hub')
    expect(ids).toContain('clay-sky-default')
    expect(ids).toContain('workspace-fixes')
    expect(ids).toContain('themes')
  })

  it('has unique ids and well-formed ISO dates', () => {
    const ids = CHANGELOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.detail.length).toBeGreaterThan(0)
    }
  })

  it('is ordered newest first', () => {
    const dates = CHANGELOG.map((e) => e.date)
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    expect(dates).toEqual(sorted)
  })

  it('exposes only the latest few for Home (curated, not a wall)', () => {
    expect(RECENT_CHANGELOG).toHaveLength(Math.min(RECENT_CHANGELOG_LIMIT, CHANGELOG.length))
    expect(RECENT_CHANGELOG[0]).toEqual(CHANGELOG[0])
  })

  it('formats a calm, locale-stable date label', () => {
    expect(formatChangelogDate('2026-05-29')).toBe('May 29')
    // Invalid input degrades to the raw string rather than "Invalid Date".
    expect(formatChangelogDate('not-a-date')).toBe('not-a-date')
  })
})

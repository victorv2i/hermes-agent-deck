import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AWAY_LAST_SEEN_STORAGE_KEY, readLastSeenAt, writeLastSeenAt } from './lastSeenStore'

describe('lastSeenStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored (first-ever visit)', () => {
    expect(readLastSeenAt()).toBeNull()
  })

  it('round-trips a written timestamp', () => {
    const t = Date.UTC(2026, 5, 16, 9, 0, 0)
    writeLastSeenAt(t)
    expect(readLastSeenAt()).toBe(t)
  })

  it('writes the value as the raw ms number string', () => {
    const t = 1_700_000_000_000
    writeLastSeenAt(t)
    expect(localStorage.getItem(AWAY_LAST_SEEN_STORAGE_KEY)).toBe(String(t))
  })

  it('returns null for a corrupt stored value rather than throwing', () => {
    localStorage.setItem(AWAY_LAST_SEEN_STORAGE_KEY, 'not-a-number')
    expect(readLastSeenAt()).toBeNull()
  })

  it('tolerates a throwing localStorage on read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readLastSeenAt()).toBeNull()
    spy.mockRestore()
  })

  it('tolerates a throwing localStorage on write (no throw)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeLastSeenAt(123)).not.toThrow()
    spy.mockRestore()
  })
})

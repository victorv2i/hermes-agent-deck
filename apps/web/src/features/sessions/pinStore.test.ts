import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PINNED_SESSIONS_STORAGE_KEY,
  getPinnedSnapshot,
  pinSession,
  unpinSession,
  togglePin,
} from './pinStore'

// Simulate a page reload: drop the module's in-memory state and re-import so the
// fresh module instance rehydrates from whatever is in localStorage right now.
async function reloadStore() {
  vi.resetModules()
  return import('./pinStore')
}

// The store is module-level; reset both localStorage AND the in-memory set
// (by unpinning everything we know about) before each test so they don't bleed.
beforeEach(() => {
  for (const id of [...getPinnedSnapshot()]) unpinSession(id)
  localStorage.clear()
})

describe('pinStore', () => {
  it('pins and unpins a session id', () => {
    pinSession('s1')
    expect(getPinnedSnapshot().has('s1')).toBe(true)
    unpinSession('s1')
    expect(getPinnedSnapshot().has('s1')).toBe(false)
  })

  it('toggles a session id', () => {
    togglePin('s2')
    expect(getPinnedSnapshot().has('s2')).toBe(true)
    togglePin('s2')
    expect(getPinnedSnapshot().has('s2')).toBe(false)
  })

  it('persists pins to localStorage as a JSON array', () => {
    pinSession('a')
    pinSession('b')
    const raw = localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(new Set(JSON.parse(raw!))).toEqual(new Set(['a', 'b']))
  })

  it('returns a stable snapshot reference until the next mutation', () => {
    pinSession('x')
    const first = getPinnedSnapshot()
    // No mutation → same reference (required by useSyncExternalStore).
    expect(getPinnedSnapshot()).toBe(first)
    pinSession('y')
    expect(getPinnedSnapshot()).not.toBe(first)
  })

  it('is a no-op when pinning an already-pinned id (no new snapshot)', () => {
    pinSession('dup')
    const ref = getPinnedSnapshot()
    pinSession('dup')
    expect(getPinnedSnapshot()).toBe(ref)
  })

  it('rehydrates pins from localStorage after a reload', async () => {
    pinSession('keep-1')
    pinSession('keep-2')
    const fresh = await reloadStore()
    expect(fresh.getPinnedSnapshot().has('keep-1')).toBe(true)
    expect(fresh.getPinnedSnapshot().has('keep-2')).toBe(true)
  })

  it('does not resurrect an unpinned id after a reload', async () => {
    pinSession('gone')
    unpinSession('gone')
    const fresh = await reloadStore()
    expect(fresh.getPinnedSnapshot().has('gone')).toBe(false)
  })

  it('rehydrates to an empty set when storage is empty', async () => {
    const fresh = await reloadStore()
    expect(fresh.getPinnedSnapshot().size).toBe(0)
  })

  it('degrades to an empty set when stored value is corrupt', async () => {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, '{not json')
    const fresh = await reloadStore()
    expect(fresh.getPinnedSnapshot().size).toBe(0)
  })

  it('ignores non-array stored JSON on reload', async () => {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, '{"foo":"bar"}')
    const fresh = await reloadStore()
    expect(fresh.getPinnedSnapshot().size).toBe(0)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  draftKey,
  readDraft,
  writeDraft,
  clearDraft,
  seedDraft,
  useDraft,
  DRAFT_STORAGE_PREFIX,
  NEW_CHAT_DRAFT_KEY,
  DRAFT_SAVE_DEBOUNCE_MS,
} from './draftStore'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('draftKey', () => {
  it('namespaces a session id under the draft prefix', () => {
    expect(draftKey('sess-1')).toBe(`${DRAFT_STORAGE_PREFIX}sess-1`)
  })

  it('maps null/undefined/empty to the "new" chat sentinel', () => {
    const expected = `${DRAFT_STORAGE_PREFIX}${NEW_CHAT_DRAFT_KEY}`
    expect(draftKey(null)).toBe(expected)
    expect(draftKey(undefined)).toBe(expected)
    expect(draftKey('')).toBe(expected)
  })
})

describe('readDraft / writeDraft / clearDraft (round-trip)', () => {
  it('round-trips a draft for a session', () => {
    writeDraft('sess-1', 'hello world')
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBe('hello world')
    expect(readDraft('sess-1')).toBe('hello world')
  })

  it('keeps drafts independent per session', () => {
    writeDraft('a', 'draft A')
    writeDraft('b', 'draft B')
    expect(readDraft('a')).toBe('draft A')
    expect(readDraft('b')).toBe('draft B')
  })

  it('persists the new-chat draft under the sentinel key', () => {
    writeDraft(null, 'unsent message')
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${NEW_CHAT_DRAFT_KEY}`)).toBe(
      'unsent message',
    )
    expect(readDraft(null)).toBe('unsent message')
  })

  it('writing empty text removes the entry (clean resting storage)', () => {
    writeDraft('sess-1', 'something')
    writeDraft('sess-1', '')
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBeNull()
    expect(readDraft('sess-1')).toBe('')
  })

  it('clearDraft removes a session draft', () => {
    writeDraft('sess-1', 'to be cleared')
    clearDraft('sess-1')
    expect(readDraft('sess-1')).toBe('')
  })

  it('readDraft returns empty string for an unknown session', () => {
    expect(readDraft('never-written')).toBe('')
  })

  describe('seedDraft', () => {
    it('writes a starter draft when the session has no draft yet', () => {
      expect(seedDraft('sess-1', 'summarize this repo')).toBe(true)
      expect(readDraft('sess-1')).toBe('summarize this repo')
    })

    it('seeds the new-chat composer under the sentinel key', () => {
      expect(seedDraft(null, 'starter prompt')).toBe(true)
      expect(readDraft(null)).toBe('starter prompt')
      expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${NEW_CHAT_DRAFT_KEY}`)).toBe(
        'starter prompt',
      )
    })

    it('does NOT clobber an existing draft (back/refresh with stale state is safe)', () => {
      writeDraft('sess-1', 'half-typed message')
      expect(seedDraft('sess-1', 'starter prompt')).toBe(false)
      expect(readDraft('sess-1')).toBe('half-typed message')
    })

    it('ignores an empty starter (nothing to seed)', () => {
      expect(seedDraft('sess-1', '')).toBe(false)
      expect(readDraft('sess-1')).toBe('')
    })
  })

  it('tolerates a localStorage that throws on read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readDraft('sess-1')).toBe('')
    spy.mockRestore()
  })

  it('tolerates a localStorage that throws on write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeDraft('sess-1', 'x')).not.toThrow()
    spy.mockRestore()
  })
})

describe('useDraft', () => {
  it('seeds its initial value from storage', () => {
    writeDraft('sess-1', 'persisted')
    const { result } = renderHook(() => useDraft('sess-1'))
    expect(result.current.draft).toBe('persisted')
  })

  it('debounces persistence of edits', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDraft('sess-1'))
    act(() => result.current.setDraft('typing'))
    // The in-memory value updates immediately…
    expect(result.current.draft).toBe('typing')
    // …but storage hasn't been written before the debounce elapses.
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBeNull()
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS))
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBe('typing')
  })

  it('coalesces rapid edits into a single late write', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useDraft('sess-1'))
    act(() => result.current.setDraft('a'))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.setDraft('ab'))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.setDraft('abc'))
    // No write yet (each edit reset the timer).
    expect(setItem).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBe('abc')
  })

  it('clear() empties the value and removes storage immediately (on send)', () => {
    vi.useFakeTimers()
    writeDraft('sess-1', 'queued')
    const { result } = renderHook(() => useDraft('sess-1'))
    act(() => result.current.clear())
    expect(result.current.draft).toBe('')
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBeNull()
    // A pending debounced write (if any) must not resurrect the draft.
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS))
    expect(localStorage.getItem(`${DRAFT_STORAGE_PREFIX}sess-1`)).toBeNull()
  })

  it('re-seeds when the session key changes', () => {
    writeDraft('a', 'draft for A')
    writeDraft('b', 'draft for B')
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDraft(id), {
      initialProps: { id: 'a' },
    })
    expect(result.current.draft).toBe('draft for A')
    rerender({ id: 'b' })
    expect(result.current.draft).toBe('draft for B')
  })
})

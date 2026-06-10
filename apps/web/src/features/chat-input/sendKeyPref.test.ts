import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  shouldSend,
  readSendKeyPref,
  getSendKeyPref,
  setSendKeyPref,
  useSendKeyPref,
  SEND_KEY_STORAGE_KEY,
  DEFAULT_SEND_KEY,
  type SendKeyEvent,
  type SendKeyPref,
} from './sendKeyPref'

beforeEach(() => {
  localStorage.clear()
  setSendKeyPref(DEFAULT_SEND_KEY)
  localStorage.clear()
})

afterEach(() => {
  setSendKeyPref(DEFAULT_SEND_KEY)
  localStorage.clear()
  vi.restoreAllMocks()
})

/** Build a minimal keyboard-event shape for the matrix. */
function ev(over: Partial<SendKeyEvent> = {}): SendKeyEvent {
  return { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, ...over }
}

describe('shouldSend matrix', () => {
  describe("pref = 'enter' (Enter sends)", () => {
    const pref: SendKeyPref = 'enter'
    it('plain Enter sends', () => {
      expect(shouldSend(ev(), pref)).toBe(true)
    })
    it('Shift+Enter inserts a newline (no send)', () => {
      expect(shouldSend(ev({ shiftKey: true }), pref)).toBe(false)
    })
    it('⌘+Enter inserts a newline (no send)', () => {
      expect(shouldSend(ev({ metaKey: true }), pref)).toBe(false)
    })
    it('Ctrl+Enter inserts a newline (no send)', () => {
      expect(shouldSend(ev({ ctrlKey: true }), pref)).toBe(false)
    })
  })

  describe("pref = 'mod-enter' (⌘/Ctrl+Enter sends)", () => {
    const pref: SendKeyPref = 'mod-enter'
    it('plain Enter inserts a newline (no send)', () => {
      expect(shouldSend(ev(), pref)).toBe(false)
    })
    it('⌘+Enter sends', () => {
      expect(shouldSend(ev({ metaKey: true }), pref)).toBe(true)
    })
    it('Ctrl+Enter sends', () => {
      expect(shouldSend(ev({ ctrlKey: true }), pref)).toBe(true)
    })
    it('Shift+Enter inserts a newline even with a modifier (no send)', () => {
      expect(shouldSend(ev({ shiftKey: true, metaKey: true }), pref)).toBe(false)
    })
  })

  describe('non-send keys + IME guards', () => {
    it('a non-Enter key never sends', () => {
      expect(shouldSend(ev({ key: 'a' }), 'enter')).toBe(false)
      expect(shouldSend(ev({ key: 'Tab' }), 'mod-enter')).toBe(false)
    })
    it('an in-progress IME composition (isComposing) never sends', () => {
      expect(shouldSend(ev({ isComposing: true }), 'enter')).toBe(false)
    })
    it('an in-progress IME composition (keyCode 229) never sends', () => {
      expect(shouldSend(ev({ keyCode: 229 }), 'enter')).toBe(false)
      expect(shouldSend(ev({ keyCode: 229, metaKey: true }), 'mod-enter')).toBe(false)
    })
  })
})

describe('preference store', () => {
  it('defaults to "enter" when unset', () => {
    expect(readSendKeyPref()).toBe('enter')
    expect(getSendKeyPref()).toBe('enter')
  })

  it('round-trips a preference through localStorage', () => {
    setSendKeyPref('mod-enter')
    expect(localStorage.getItem(SEND_KEY_STORAGE_KEY)).toBe('mod-enter')
    expect(readSendKeyPref()).toBe('mod-enter')
    expect(getSendKeyPref()).toBe('mod-enter')
  })

  it('falls back to the default for an invalid stored value', () => {
    localStorage.setItem(SEND_KEY_STORAGE_KEY, 'garbage')
    expect(readSendKeyPref()).toBe(DEFAULT_SEND_KEY)
  })

  it('tolerates a localStorage that throws on write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setSendKeyPref('mod-enter')).not.toThrow()
    // The in-memory value still applies for this session.
    expect(getSendKeyPref()).toBe('mod-enter')
    spy.mockRestore()
  })
})

describe('useSendKeyPref', () => {
  it('exposes the current preference and a setter, staying in sync', () => {
    const { result } = renderHook(() => useSendKeyPref())
    expect(result.current.pref).toBe('enter')
    act(() => result.current.setPref('mod-enter'))
    expect(result.current.pref).toBe('mod-enter')
  })

  it('reflects an external store change (shared subscription)', () => {
    const { result } = renderHook(() => useSendKeyPref())
    act(() => setSendKeyPref('mod-enter'))
    expect(result.current.pref).toBe('mod-enter')
  })
})

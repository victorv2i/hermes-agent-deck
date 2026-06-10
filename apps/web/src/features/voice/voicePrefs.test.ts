import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  VOICE_PREFS_STORAGE_KEY,
  getVoicePrefs,
  readStoredVoicePrefs,
  setAutoSpeak,
  setVoicePrefs,
  useVoicePrefs,
} from './voicePrefs'

beforeEach(() => {
  localStorage.clear()
  // Reset the module store to the default baseline so tests don't leak the
  // module-level `current` value between them.
  setVoicePrefs({ autoSpeak: false })
  localStorage.clear()
})

afterEach(() => {
  setVoicePrefs({ autoSpeak: false })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('voice prefs storage', () => {
  it('reads a valid stored prefs object', () => {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify({ autoSpeak: true }))
    expect(readStoredVoicePrefs()).toEqual({ autoSpeak: true })
  })

  it('returns null for a missing value', () => {
    expect(readStoredVoicePrefs()).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, '{not json')
    expect(readStoredVoicePrefs()).toBeNull()
  })

  it('returns null for a wrong-shaped stored value', () => {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify({ autoSpeak: 'yes' }))
    expect(readStoredVoicePrefs()).toBeNull()
  })

  it('normalises away unknown extra keys', () => {
    localStorage.setItem(
      VOICE_PREFS_STORAGE_KEY,
      JSON.stringify({ autoSpeak: true, voiceUri: 'x' }),
    )
    expect(readStoredVoicePrefs()).toEqual({ autoSpeak: true })
  })

  it('defaults to autoSpeak:false when nothing is stored', () => {
    expect(getVoicePrefs()).toEqual({ autoSpeak: false })
  })
})

describe('setVoicePrefs / setAutoSpeak', () => {
  it('persists and applies the chosen prefs', () => {
    setVoicePrefs({ autoSpeak: true })
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_STORAGE_KEY)!)).toEqual({ autoSpeak: true })
    expect(getVoicePrefs()).toEqual({ autoSpeak: true })
  })

  it('setAutoSpeak flips just the one flag and persists it', () => {
    setAutoSpeak(true)
    expect(getVoicePrefs().autoSpeak).toBe(true)
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_STORAGE_KEY)!).autoSpeak).toBe(true)
    setAutoSpeak(false)
    expect(getVoicePrefs().autoSpeak).toBe(false)
  })

  it('survives a throwing localStorage.setItem (private mode / quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setAutoSpeak(true)).not.toThrow()
    expect(getVoicePrefs().autoSpeak).toBe(true)
    spy.mockRestore()
  })
})

describe('useVoicePrefs', () => {
  it('exposes the current prefs and updates on change', () => {
    const { result } = renderHook(() => useVoicePrefs())
    expect(result.current.autoSpeak).toBe(false)

    act(() => result.current.setAutoSpeak(true))
    expect(result.current.autoSpeak).toBe(true)
  })

  it('reflects an external setAutoSpeak() call (shared subscription)', () => {
    const { result } = renderHook(() => useVoicePrefs())
    act(() => setAutoSpeak(true))
    expect(result.current.autoSpeak).toBe(true)
  })

  it('keeps two hook instances in sync', () => {
    const a = renderHook(() => useVoicePrefs())
    const b = renderHook(() => useVoicePrefs())
    act(() => a.result.current.setAutoSpeak(true))
    expect(b.result.current.autoSpeak).toBe(true)
  })

  it('toggleAutoSpeak() flips the flag', () => {
    const { result } = renderHook(() => useVoicePrefs())
    act(() => result.current.toggleAutoSpeak())
    expect(result.current.autoSpeak).toBe(true)
    act(() => result.current.toggleAutoSpeak())
    expect(result.current.autoSpeak).toBe(false)
  })
})

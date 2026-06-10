import { describe, it, expect, afterEach, vi } from 'vitest'
import { isMac, platformModKey, usePlatformModKey } from './platformMod'

/**
 * The shared platform-modifier helper (C3). Both the ⌘K palette and the `?`
 * shortcuts overlay read from here, so it must spell ⌘ on Apple platforms and
 * "Ctrl" on Linux + Windows — consistently, and without crashing where
 * `navigator` is absent.
 */

function stubPlatform(platform: string, userAgent = '') {
  vi.stubGlobal('navigator', { platform, userAgent } as Navigator)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platformMod', () => {
  it('reports Mac + ⌘ on Apple platforms', () => {
    stubPlatform('MacIntel')
    expect(isMac()).toBe(true)
    expect(platformModKey()).toBe('⌘')
    expect(usePlatformModKey()).toBe('⌘')
  })

  it('reports non-Mac + Ctrl on Linux', () => {
    stubPlatform('Linux x86_64')
    expect(isMac()).toBe(false)
    expect(platformModKey()).toBe('Ctrl')
  })

  it('reports non-Mac + Ctrl on Windows', () => {
    stubPlatform('Win32')
    expect(isMac()).toBe(false)
    expect(platformModKey()).toBe('Ctrl')
  })

  it('falls back to the user-agent string when platform is empty (iPad)', () => {
    stubPlatform('', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    expect(isMac()).toBe(true)
    expect(platformModKey()).toBe('⌘')
  })
})

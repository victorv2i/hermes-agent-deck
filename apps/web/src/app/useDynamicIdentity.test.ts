import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useDynamicIdentity,
  activeProfile,
  ambientProfile,
  titleForActive,
  faviconForActive,
  TITLE_SUFFIX,
  DEFAULT_FAVICON,
} from './useDynamicIdentity'
import { resolveAvatar, avatarSrc } from '@/features/profiles/avatarForProfile'
import type { ProfileSummary, ProfilesResponse } from '@/features/profiles/types'

function profile(over: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    name: 'default',
    displayPath: 'Hermes home',
    isDefault: true,
    isActive: false,
    model: null,
    provider: null,
    hasEnv: false,
    skillCount: 0,
    gatewayRunning: false,
    avatar: null,
    displayName: null,
    ...over,
  }
}

function roster(profiles: ProfileSummary[], active: string): ProfilesResponse {
  return { active, profiles }
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('activeProfile', () => {
  it('returns null with no roster', () => {
    expect(activeProfile(null)).toBeNull()
    expect(activeProfile(undefined)).toBeNull()
  })

  it('returns null for a partial roster missing the profiles array (no throw)', () => {
    // A truthy-but-incomplete response (loading/partial) must not crash the hook.
    expect(activeProfile({ active: 'default' } as never)).toBeNull()
  })

  it('prefers the isActive-flagged profile', () => {
    const a = profile({ name: 'coder', isDefault: false, isActive: true })
    const data = roster([profile(), a], 'coder')
    expect(activeProfile(data)?.name).toBe('coder')
  })

  it('falls back to the top-level active name when no flag is set', () => {
    const data = roster([profile(), profile({ name: 'mercury', isDefault: false })], 'mercury')
    expect(activeProfile(data)?.name).toBe('mercury')
  })

  it('returns null when nothing matches', () => {
    const data = roster([profile()], 'ghost')
    // default is not active and name !== ghost
    expect(activeProfile(data)?.name).toBeUndefined()
  })
})

describe('ambientProfile (drives identity from the RUNNING agent, not the selected one)', () => {
  it('returns null with no roster', () => {
    expect(ambientProfile(null)).toBeNull()
    expect(ambientProfile(undefined)).toBeNull()
  })

  it('prefers the agent the gateway is actually running, even when a DIFFERENT one is selected active', () => {
    // active_profile names "venus" (just switched) but the gateway is still
    // running "mercury" — ambient identity must follow the RUNNING agent.
    const data = roster(
      [
        profile({ name: 'mercury', isDefault: false, isActive: false, gatewayRunning: true }),
        profile({ name: 'venus', isDefault: false, isActive: true, gatewayRunning: false }),
      ],
      'venus',
    )
    expect(ambientProfile(data)?.name).toBe('mercury')
    // The selected-active resolver still points at the freshly-selected one.
    expect(activeProfile(data)?.name).toBe('venus')
  })

  it('falls back to the selected active profile when NOTHING is running', () => {
    const data = roster(
      [
        profile({ name: 'mercury', isDefault: false, isActive: false, gatewayRunning: false }),
        profile({ name: 'venus', isDefault: false, isActive: true, gatewayRunning: false }),
      ],
      'venus',
    )
    expect(ambientProfile(data)?.name).toBe('venus')
  })
})

describe('titleForActive', () => {
  it('is the bare product for no active agent', () => {
    expect(titleForActive(null)).toBe(TITLE_SUFFIX)
  })

  it('is the bare product for the unnamed default', () => {
    expect(titleForActive(profile({ isDefault: true }))).toBe(TITLE_SUFFIX)
    expect(titleForActive(profile({ name: 'default', isDefault: false }))).toBe(TITLE_SUFFIX)
  })

  it('uses the display name when set', () => {
    expect(titleForActive(profile({ displayName: 'Mercury' }))).toBe('Mercury - Agent Deck')
  })

  it('uses the profile id for a non-default unnamed agent', () => {
    expect(titleForActive(profile({ name: 'coder', isDefault: false }))).toBe('coder - Agent Deck')
  })

  it('falls back to the product for a blank/whitespace name', () => {
    expect(titleForActive(profile({ name: '   ', isDefault: false }))).toBe(TITLE_SUFFIX)
  })
})

describe('faviconForActive', () => {
  it('is the stable mark with no active agent', () => {
    expect(faviconForActive(null)).toBe(DEFAULT_FAVICON)
  })

  it('is the active agent resolved avatar webp', () => {
    const p = profile({ name: 'mercury', isDefault: false })
    expect(faviconForActive(p)).toBe(avatarSrc(resolveAvatar(p)))
    expect(faviconForActive(p)).toMatch(/^\/avatars\/.+\.webp$/)
  })

  it('uses an explicitly chosen avatar', () => {
    const p = profile({ name: 'mercury', isDefault: false, avatar: 'v3' })
    expect(faviconForActive(p)).toBe('/avatars/v3.webp')
  })
})

describe('useDynamicIdentity', () => {
  function stubProfiles(data: ProfilesResponse) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => data } as Response),
    )
  }

  it('sets the title and favicon from the active agent', async () => {
    document.title = 'Agent Deck'
    // clear any prior icon link
    document.querySelectorAll('link[rel="icon"]').forEach((n) => n.remove())
    stubProfiles(
      roster([profile({ name: 'mercury', isDefault: false, isActive: true })], 'mercury'),
    )

    renderHook(() => useDynamicIdentity(), { wrapper: wrapper() })

    await waitFor(() => expect(document.title).toBe('mercury - Agent Deck'))
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toMatch(/^\/avatars\/.+\.webp$/)
    expect(link!.type).toBe('image/webp')
    // A variable-size avatar mark drops the stale 32x32 sizes hint.
    expect(link!.getAttribute('sizes')).toBeNull()
  })

  it('keeps the 32x32 sizes hint for the static default favicon (no active agent)', async () => {
    document.title = 'Agent Deck'
    // Seed the existing index.html link the hook reuses, with its sizes hint.
    document.querySelectorAll('link[rel="icon"]').forEach((n) => n.remove())
    const seed = document.createElement('link')
    seed.rel = 'icon'
    seed.type = 'image/png'
    seed.setAttribute('sizes', '32x32')
    seed.setAttribute('href', DEFAULT_FAVICON)
    document.head.appendChild(seed)
    // A roster where nothing is active -> faviconForActive falls back to the mark.
    stubProfiles(roster([profile({ name: 'default', isDefault: true, isActive: false })], 'ghost'))
    renderHook(() => useDynamicIdentity(), { wrapper: wrapper() })
    await waitFor(() => expect(document.title).toBe('Agent Deck'))
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    expect(link!.getAttribute('href')).toBe(DEFAULT_FAVICON)
    expect(link!.getAttribute('sizes')).toBe('32x32')
    expect(link!.type).toBe('image/png')
  })

  it('uses the display name in the title', async () => {
    document.title = 'Agent Deck'
    stubProfiles(
      roster(
        [profile({ name: 'mercury', isDefault: false, isActive: true, displayName: 'Mercury' })],
        'mercury',
      ),
    )
    renderHook(() => useDynamicIdentity(), { wrapper: wrapper() })
    await waitFor(() => expect(document.title).toBe('Mercury - Agent Deck'))
  })

  it('updates the title when the active agent changes', async () => {
    document.title = 'Agent Deck'
    const first = roster(
      [profile({ name: 'mercury', isDefault: false, isActive: true })],
      'mercury',
    )
    const second = roster([profile({ name: 'venus', isDefault: false, isActive: true })], 'venus')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first } as Response)
      .mockResolvedValue({ ok: true, json: async () => second } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrap = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    renderHook(() => useDynamicIdentity(), { wrapper: wrap })
    await waitFor(() => expect(document.title).toBe('mercury - Agent Deck'))

    // Invalidate so the hook re-fetches the new roster (an agent switch).
    await client.invalidateQueries({ queryKey: ['profiles'] })
    await waitFor(() => expect(document.title).toBe('venus - Agent Deck'))
  })

  it('titles the tab after the RUNNING agent, not a just-selected-but-not-restarted one', async () => {
    document.title = 'Agent Deck'
    // active_profile = venus (selected), but the gateway is still running mercury.
    stubProfiles(
      roster(
        [
          profile({ name: 'mercury', isDefault: false, isActive: false, gatewayRunning: true }),
          profile({ name: 'venus', isDefault: false, isActive: true, gatewayRunning: false }),
        ],
        'venus',
      ),
    )
    renderHook(() => useDynamicIdentity(), { wrapper: wrapper() })
    await waitFor(() => expect(document.title).toBe('mercury - Agent Deck'))
  })

  it('falls back to the bare product title for the unnamed default', async () => {
    document.title = 'something stale'
    stubProfiles(roster([profile({ name: 'default', isDefault: true, isActive: true })], 'default'))
    renderHook(() => useDynamicIdentity(), { wrapper: wrapper() })
    await waitFor(() => expect(document.title).toBe('Agent Deck'))
  })
})

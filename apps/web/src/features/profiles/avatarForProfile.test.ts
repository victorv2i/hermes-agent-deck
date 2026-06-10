import { describe, it, expect } from 'vitest'
import { BUILTIN_AVATAR_IDS } from '@agent-deck/protocol'
import { avatarForProfile, resolveAvatar, avatarSrc } from './avatarForProfile'

describe('avatarForProfile (deterministic default)', () => {
  it('pins the built-in default profile to v1', () => {
    expect(avatarForProfile({ name: 'default' })).toBe('v1')
    expect(avatarForProfile({ name: 'anything', isDefault: true })).toBe('v1')
  })

  it('is deterministic — same name always maps to the same face', () => {
    const a = avatarForProfile({ name: 'atlas' })
    const b = avatarForProfile({ name: 'atlas' })
    expect(a).toBe(b)
  })

  it('is total — always returns a valid built-in id', () => {
    for (const name of ['atlas', 'iris', 'juno', 'a', 'zzzz', 'agent_42', 'my-agent']) {
      expect(BUILTIN_AVATAR_IDS).toContain(avatarForProfile({ name }))
    }
  })

  it('spreads distinct names across the set (not all the same face)', () => {
    const names = Array.from({ length: 40 }, (_, i) => `agent-${i}`)
    const faces = new Set(names.map((name) => avatarForProfile({ name })))
    // With 3 buckets and 40 names a healthy hash hits more than one face — the
    // point is the default isn't a single hard-coded face for everyone.
    expect(faces.size).toBeGreaterThanOrEqual(2)
  })
})

describe('resolveAvatar', () => {
  it('prefers an explicitly chosen avatar', () => {
    expect(resolveAvatar({ name: 'atlas', avatar: 'v3' })).toBe('v3')
  })

  it('falls back to the deterministic default when unset or null', () => {
    expect(resolveAvatar({ name: 'default', avatar: null })).toBe('v1')
    expect(resolveAvatar({ name: 'atlas' })).toBe(avatarForProfile({ name: 'atlas' }))
  })
})

describe('avatarSrc', () => {
  it('maps an id to its served webp path', () => {
    expect(avatarSrc('v3')).toBe('/avatars/v3.webp')
  })
})

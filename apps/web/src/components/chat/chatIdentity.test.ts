import { describe, it, expect } from 'vitest'
import { resolveChatAgent } from './chatIdentity'

describe('resolveChatAgent', () => {
  it('returns null while no profile is available (roster loading)', () => {
    expect(resolveChatAgent(null)).toBeNull()
    expect(resolveChatAgent(undefined)).toBeNull()
  })

  it('treats the built-in default as UNnamed and shows its REAL name "default"', () => {
    const id = resolveChatAgent({ name: 'default', isDefault: true })
    expect(id).not.toBeNull()
    expect(id!.isNamed).toBe(false)
    // The name is accurate: the default agent reads as "default", never a
    // fabricated friendly label.
    expect(id!.friendlyName).toBe('default')
    // The default profile pins to the signature front portrait.
    expect(id!.avatarId).toBe('v1')
  })

  it('treats a real name as named and carries it through verbatim', () => {
    const id = resolveChatAgent({ name: 'Sol', isDefault: false })
    expect(id!.isNamed).toBe(true)
    expect(id!.name).toBe('Sol')
    expect(id!.friendlyName).toBe('Sol')
  })

  it('honors an explicitly chosen avatar over the deterministic default', () => {
    const id = resolveChatAgent({ name: 'Sol', isDefault: false, avatar: 'v3' })
    expect(id!.avatarId).toBe('v3')
  })

  it('falls back to null for a blank name (never a faceless, nameless identity)', () => {
    expect(resolveChatAgent({ name: '   ', isDefault: false })).toBeNull()
  })

  it('uses displayName as friendlyName when set on the default profile', () => {
    const id = resolveChatAgent({ name: 'default', isDefault: true, displayName: 'Mercury' })
    expect(id!.friendlyName).toBe('Mercury')
    expect(id!.isNamed).toBe(true)
  })

  it('uses displayName as friendlyName on a named profile too', () => {
    const id = resolveChatAgent({ name: 'atlas', isDefault: false, displayName: 'Atlas Prime' })
    expect(id!.friendlyName).toBe('Atlas Prime')
    expect(id!.isNamed).toBe(true)
  })

  it('falls back to profile id when displayName is null/empty on a non-default profile', () => {
    const id = resolveChatAgent({ name: 'atlas', isDefault: false, displayName: null })
    expect(id!.friendlyName).toBe('atlas')
    expect(id!.isNamed).toBe(true)
  })

  it('falls back to the real name "default" when displayName is null/empty on the default profile', () => {
    const id = resolveChatAgent({ name: 'default', isDefault: true, displayName: null })
    expect(id!.friendlyName).toBe('default')
    expect(id!.isNamed).toBe(false)
  })
})

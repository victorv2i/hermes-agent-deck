import { describe, it, expect } from 'vitest'
import {
  PROFILE_ID_RE,
  isProfileId,
  ProfileName,
  AvatarId,
  BUILTIN_AVATAR_IDS,
  ProfileIdentity,
  AgentDeckAvatarWriteRequest,
  AgentDeckProfileCreateRequest,
  AgentDeckProfileSwitchRequest,
  AgentDeckProfileRenameRequest,
} from './identity'

describe('PROFILE_ID_RE / isProfileId', () => {
  it('accepts legal single-segment names incl. "default"', () => {
    for (const ok of ['default', 'atlas', 'a', 'my-agent', 'agent_1', 'a'.repeat(64)]) {
      expect(isProfileId(ok)).toBe(true)
    }
  })

  it('rejects traversal, casing, empty, control chars, and over-length', () => {
    for (const bad of [
      '',
      '..',
      '../x',
      'a/b',
      'Atlas',
      '-leading',
      'a'.repeat(65),
      'has space',
      'x\n',
    ]) {
      expect(isProfileId(bad)).toBe(false)
    }
  })

  it('is the same regex callers can reuse', () => {
    expect(PROFILE_ID_RE.test('atlas')).toBe(true)
    expect(PROFILE_ID_RE.test('../etc')).toBe(false)
  })
})

describe('ProfileName DTO', () => {
  it('parses a valid name and rejects an invalid one', () => {
    expect(ProfileName.parse('atlas')).toBe('atlas')
    expect(() => ProfileName.parse('../escape')).toThrow()
  })
})

describe('AvatarId / BUILTIN_AVATAR_IDS', () => {
  it('pins exactly the six built-in ids in order', () => {
    // prettier-ignore
    expect(BUILTIN_AVATAR_IDS).toEqual([
      'v1', 'v2', 'v3', 'v4', 'v5', 'v6',
    ])
  })

  it('parses a member and rejects a non-member', () => {
    expect(AvatarId.parse('v1')).toBe('v1')
    expect(AvatarId.parse('v6')).toBe('v6')
    expect(() => AvatarId.parse('v7')).toThrow()
    expect(() => AvatarId.parse('nous-girl')).toThrow()
  })
})

describe('ProfileIdentity DTO', () => {
  it('parses a chosen avatar and a null (unset) avatar', () => {
    expect(ProfileIdentity.parse({ avatar: 'v2' }).avatar).toBe('v2')
    expect(ProfileIdentity.parse({ avatar: null }).avatar).toBeNull()
  })

  it('whitelists to exactly { avatar } (drops hand-edited extras)', () => {
    const parsed = ProfileIdentity.parse({ avatar: 'v1', name: 'leaked', secret: 'x' })
    expect(Object.keys(parsed)).toEqual(['avatar'])
  })

  it('rejects a non-builtin avatar value', () => {
    expect(() => ProfileIdentity.parse({ avatar: 'v19' })).toThrow()
  })

  it('parses a valid displayName alongside the avatar', () => {
    const parsed = ProfileIdentity.parse({ avatar: 'v3', displayName: 'Mercury' })
    expect(parsed.avatar).toBe('v3')
    expect(parsed.displayName).toBe('Mercury')
  })

  it('allows displayName to be null or absent', () => {
    const withNull = ProfileIdentity.parse({ avatar: 'v2', displayName: null })
    expect(withNull.displayName).toBeNull()
    const absent = ProfileIdentity.parse({ avatar: 'v2' })
    expect(absent.displayName).toBeUndefined()
  })

  it('rejects a displayName longer than 64 characters', () => {
    expect(() => ProfileIdentity.parse({ avatar: 'v1', displayName: 'a'.repeat(65) })).toThrow()
  })
})

describe('identity request DTOs', () => {
  it('AgentDeckAvatarWriteRequest requires a valid avatar', () => {
    expect(AgentDeckAvatarWriteRequest.parse({ avatar: 'v3' })).toEqual({ avatar: 'v3' })
    expect(() => AgentDeckAvatarWriteRequest.parse({ avatar: 'nope' })).toThrow()
  })

  it('AgentDeckAvatarWriteRequest accepts an optional displayName', () => {
    const withName = AgentDeckAvatarWriteRequest.parse({ avatar: 'v2', displayName: 'Mercury' })
    expect(withName).toEqual({ avatar: 'v2', displayName: 'Mercury' })
    const withoutName = AgentDeckAvatarWriteRequest.parse({ avatar: 'v2' })
    expect(withoutName.displayName).toBeUndefined()
  })

  it('AgentDeckProfileCreateRequest validates name + optional avatar', () => {
    expect(AgentDeckProfileCreateRequest.parse({ name: 'atlas' })).toEqual({ name: 'atlas' })
    expect(AgentDeckProfileCreateRequest.parse({ name: 'iris', avatar: 'v3' })).toEqual({
      name: 'iris',
      avatar: 'v3',
    })
    expect(() => AgentDeckProfileCreateRequest.parse({ name: '../x' })).toThrow()
    expect(() => AgentDeckProfileCreateRequest.parse({ name: 'ok', avatar: 'v19' })).toThrow()
  })

  it('AgentDeckProfileSwitchRequest validates the target name', () => {
    expect(AgentDeckProfileSwitchRequest.parse({ name: 'default' })).toEqual({ name: 'default' })
    expect(() => AgentDeckProfileSwitchRequest.parse({ name: 'Bad Name' })).toThrow()
  })

  it('AgentDeckProfileRenameRequest validates the new name', () => {
    expect(AgentDeckProfileRenameRequest.parse({ newName: 'mercury' })).toEqual({
      newName: 'mercury',
    })
    expect(() => AgentDeckProfileRenameRequest.parse({ newName: 'Bad Name' })).toThrow()
    expect(() => AgentDeckProfileRenameRequest.parse({ newName: '../escape' })).toThrow()
  })
})

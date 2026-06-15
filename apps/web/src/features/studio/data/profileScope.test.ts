import { describe, it, expect } from 'vitest'
import { profileQuery, profileBody } from './profileScope'

describe('profileQuery', () => {
  it('builds a ?profile= query for a named agent', () => {
    expect(profileQuery('coder')).toBe('?profile=coder')
  })

  it('url-encodes the agent name', () => {
    expect(profileQuery('a b/c')).toBe('?profile=a%20b%2Fc')
  })

  it('returns an empty string for null/undefined (target the active profile)', () => {
    expect(profileQuery(null)).toBe('')
    expect(profileQuery(undefined)).toBe('')
  })

  it('returns an empty string for a blank name', () => {
    expect(profileQuery('')).toBe('')
    expect(profileQuery('   ')).toBe('')
  })

  it('treats the "current" sentinel as the active profile (no query)', () => {
    expect(profileQuery('current')).toBe('')
    expect(profileQuery('CURRENT')).toBe('')
  })

  it('trims surrounding whitespace before encoding', () => {
    expect(profileQuery('  coder  ')).toBe('?profile=coder')
  })
})

describe('profileBody', () => {
  it('returns a { profile } object for a named agent', () => {
    expect(profileBody('coder')).toEqual({ profile: 'coder' })
  })

  it('returns an empty object when targeting the active profile', () => {
    expect(profileBody(null)).toEqual({})
    expect(profileBody('current')).toEqual({})
    expect(profileBody('  ')).toEqual({})
  })

  it('trims the name it forwards', () => {
    expect(profileBody('  coder ')).toEqual({ profile: 'coder' })
  })
})

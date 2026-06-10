import { describe, it, expect } from 'vitest'
import { nextSessionId } from './sessionNav'

const IDS = ['a', 'b', 'c']

describe('nextSessionId', () => {
  it('returns null for an empty list', () => {
    expect(nextSessionId([], null, 'next')).toBeNull()
    expect(nextSessionId([], 'a', 'prev')).toBeNull()
  })

  it('lands on the first row on "next" when nothing is open', () => {
    expect(nextSessionId(IDS, null, 'next')).toBe('a')
  })

  it('lands on the last row on "prev" when nothing is open', () => {
    expect(nextSessionId(IDS, null, 'prev')).toBe('c')
  })

  it('steps forward and backward by one', () => {
    expect(nextSessionId(IDS, 'a', 'next')).toBe('b')
    expect(nextSessionId(IDS, 'b', 'next')).toBe('c')
    expect(nextSessionId(IDS, 'c', 'prev')).toBe('b')
  })

  it('clamps at the bottom (no wrap) and returns null when already there', () => {
    expect(nextSessionId(IDS, 'c', 'next')).toBeNull()
  })

  it('clamps at the top (no wrap) and returns null when already there', () => {
    expect(nextSessionId(IDS, 'a', 'prev')).toBeNull()
  })

  it('treats an unknown current id like "nothing open"', () => {
    expect(nextSessionId(IDS, 'zzz', 'next')).toBe('a')
    expect(nextSessionId(IDS, 'zzz', 'prev')).toBe('c')
  })
})

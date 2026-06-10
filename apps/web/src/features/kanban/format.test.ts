import { describe, it, expect } from 'vitest'
import { formatDuration, cardTitle } from './format'

describe('formatDuration', () => {
  it('renders seconds / minutes / hours / days compactly', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(7200)).toBe('2h')
    expect(formatDuration(172_800)).toBe('2d')
  })

  it('returns null for null / negative / non-finite', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })

  it('floors sub-minute to whole seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(59.9)).toBe('59s')
  })
})

describe('cardTitle', () => {
  it('returns a short title unchanged', () => {
    expect(cardTitle('Ship the board')).toBe('Ship the board')
  })

  it('takes only the first line when the title is multi-line', () => {
    expect(cardTitle('Rebuild the deck\n\nGoal:\nmany more lines')).toBe('Rebuild the deck')
  })

  it('caps an over-long first line with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const out = cardTitle(long)
    expect(out.endsWith('…')).toBe(true)
    // The ellipsis replaces trailing characters, so the result stays at the cap.
    expect(out.length).toBeLessThanOrEqual(81)
    expect(out.length).toBeGreaterThan(40)
  })

  it('breaks on a word boundary when one is near the cap', () => {
    const text = `${'word '.repeat(30)}tail`.trim()
    const out = cardTitle(text)
    expect(out.endsWith('…')).toBe(true)
    // No partial word left dangling before the ellipsis.
    expect(out).not.toMatch(/wor…$/)
  })

  it('trims surrounding whitespace and collapses an empty title to a fallback', () => {
    expect(cardTitle('   ')).toBe('Untitled task')
    expect(cardTitle('')).toBe('Untitled task')
    expect(cardTitle('\n\n  Real title  \n')).toBe('Real title')
  })
})

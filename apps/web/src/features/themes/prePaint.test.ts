import { describe, it, expect } from 'vitest'
import { prePaintPaletteAttr } from './prePaint'

/**
 * These cases mirror the inline pre-paint guard in apps/web/index.html. If this
 * rule changes, update that inline copy too (it can't import this module).
 */
describe('prePaintPaletteAttr (no-flash guard logic)', () => {
  it('returns null for an unset value (default → bare :root, no attribute)', () => {
    expect(prePaintPaletteAttr(null)).toBeNull()
    expect(prePaintPaletteAttr(undefined)).toBeNull()
    expect(prePaintPaletteAttr('')).toBeNull()
  })

  it('returns null for the default palette (no attribute, clean DOM)', () => {
    expect(prePaintPaletteAttr('clay-sky')).toBeNull()
  })

  it('returns null for an unknown/invalid palette (falls back to default)', () => {
    expect(prePaintPaletteAttr('teal')).toBeNull()
    expect(prePaintPaletteAttr('warm-voidx')).toBeNull()
    // The former 5th family folded away — no longer a valid id.
    expect(prePaintPaletteAttr('warm-parchment')).toBeNull()
    // The dropped Ember Study family no longer stamps (falls back to default).
    expect(prePaintPaletteAttr('ember-study')).toBeNull()
  })

  it('stamps each valid non-default family verbatim', () => {
    expect(prePaintPaletteAttr('warm-void')).toBe('warm-void')
    expect(prePaintPaletteAttr('indigo-atelier')).toBe('indigo-atelier')
  })
})

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PALETTE_ID,
  PALETTES,
  PALETTE_IDS,
  getPalette,
  isPaletteId,
} from './palette-registry'

const HEX = /^#[0-9a-fA-F]{6}$/

describe('palette registry', () => {
  it('registers exactly the THREE theme families, in order (Clay & Sky first)', () => {
    expect(PALETTES.map((p) => p.id)).toEqual(['clay-sky', 'warm-void', 'indigo-atelier'])
    expect(PALETTE_IDS).toEqual(PALETTES.map((p) => p.id))
    // Exactly three families — 'warm-parchment' folded in as a LIGHT mode; the
    // former 'ember-study' family was dropped.
    expect(PALETTES).toHaveLength(3)
    expect(isPaletteId('warm-parchment')).toBe(false)
    expect(isPaletteId('ember-study')).toBe(false)
  })

  it('every family resolves a real LIGHT and DARK swatch pair', () => {
    for (const p of PALETTES) {
      // A dark variant and a light variant must both exist for every family.
      expect(p.swatch.primary.dark).toMatch(HEX)
      expect(p.swatch.primary.light).toMatch(HEX)
      expect(p.swatch.secondary.dark).toMatch(HEX)
      expect(p.swatch.secondary.light).toMatch(HEX)
      // Light and dark are genuinely distinct (not a single mode masquerading as two).
      expect(p.swatch.primary.dark).not.toBe(p.swatch.primary.light)
      expect(p.swatch.secondary.dark).not.toBe(p.swatch.secondary.light)
    }
  })

  it('clay-sky is first and the sole recommended palette; warm-void keeps its Nous relabel', () => {
    expect(PALETTES[0]?.id).toBe('clay-sky')
    expect(getPalette('clay-sky')!.isRecommended).toBe(true)
    // The Nous palette keeps its identity label but is no longer recommended.
    expect(getPalette('warm-void')!.label).toBe('Warm Void · Nous')
    expect(getPalette('warm-void')!.isRecommended).toBeUndefined()
    // Exactly one recommended palette.
    expect(PALETTES.filter((p) => p.isRecommended)).toHaveLength(1)
  })

  it('clay-sky is the no-attribute default AND the recommended starting point', () => {
    expect(DEFAULT_PALETTE_ID).toBe('clay-sky')
    const def = getPalette(DEFAULT_PALETTE_ID)
    expect(def?.isDefault).toBe(true)
    // The user's preferred default is also the recommended one.
    expect(def?.isRecommended).toBe(true)
    // Exactly one default.
    expect(PALETTES.filter((p) => p.isDefault)).toHaveLength(1)
    // The dropped Ember Study family no longer resolves.
    expect(getPalette('ember-study')).toBeUndefined()
  })

  it('every palette has a label, a description, and valid hex swatches', () => {
    for (const p of PALETTES) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.swatch.primary.dark).toMatch(HEX)
      expect(p.swatch.primary.light).toMatch(HEX)
      expect(p.swatch.secondary.dark).toMatch(HEX)
      expect(p.swatch.secondary.light).toMatch(HEX)
    }
  })

  it('exposes the verbatim default swatch (Clay & Sky dusty blue)', () => {
    const claySky = getPalette(DEFAULT_PALETTE_ID)!
    expect(claySky.swatch.primary.dark).toBe('#7BA7D9')
    expect(claySky.swatch.primary.light).toBe('#2F5C8C')
  })

  it('no longer exposes the dropped Ember Study family', () => {
    expect(getPalette('ember-study')).toBeUndefined()
  })

  it('getPalette returns undefined for an unknown id', () => {
    expect(getPalette('nope')).toBeUndefined()
  })

  it('isPaletteId accepts the three registered ids and rejects everything else', () => {
    expect(isPaletteId('clay-sky')).toBe(true)
    expect(isPaletteId('warm-void')).toBe(true)
    expect(isPaletteId('indigo-atelier')).toBe(true)
    // The folded-away former 5th family is no longer a valid id.
    expect(isPaletteId('warm-parchment')).toBe(false)
    // The dropped Ember Study family is no longer a valid id.
    expect(isPaletteId('ember-study')).toBe(false)
    expect(isPaletteId('teal')).toBe(false)
    expect(isPaletteId('')).toBe(false)
    expect(isPaletteId(null)).toBe(false)
    expect(isPaletteId(42)).toBe(false)
  })
})

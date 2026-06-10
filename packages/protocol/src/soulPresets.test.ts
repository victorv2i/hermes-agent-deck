import { describe, it, expect } from 'vitest'
import { SoulPresetId, SOUL_PRESETS, SOUL_PRESET_LIST } from './soulPresets'

describe('soul presets', () => {
  it('exposes exactly the four presets in order, Hermes default first', () => {
    expect(SOUL_PRESET_LIST.map((p) => p.id)).toEqual([
      'default',
      'assistant',
      'coder',
      'researcher',
    ])
  })

  it('every preset has a label, blurb, and non-empty soul', () => {
    for (const p of SOUL_PRESET_LIST) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.blurb.length).toBeGreaterThan(0)
      expect(p.soul.trim().length).toBeGreaterThan(0)
    }
  })

  it('SoulPresetId accepts the four known ids and rejects others', () => {
    for (const id of ['default', 'assistant', 'coder', 'researcher']) {
      expect(SoulPresetId.safeParse(id).success).toBe(true)
    }
    expect(SoulPresetId.safeParse('bogus').success).toBe(false)
    expect(SoulPresetId.safeParse('').success).toBe(false)
  })

  it('marks the Hermes default as already seeded by Hermes (server skips the overwrite)', () => {
    expect(SOUL_PRESETS.default.seededByHermes).toBe(true)
    expect(SOUL_PRESETS.assistant.seededByHermes).toBe(false)
    expect(SOUL_PRESETS.coder.seededByHermes).toBe(false)
    expect(SOUL_PRESETS.researcher.seededByHermes).toBe(false)
  })

  it('preset souls are written in the second-person Hermes register', () => {
    expect(SOUL_PRESETS.coder.soul).toContain('You are Hermes')
    expect(SOUL_PRESETS.researcher.soul.toLowerCase()).toContain('research')
    expect(SOUL_PRESETS.assistant.soul.toLowerCase()).toContain('assistant')
  })

  it('uses only straight ASCII quotes (no curly quotes) in soul text', () => {
    for (const p of SOUL_PRESET_LIST) {
      expect(p.soul).not.toMatch(/[‘’“”]/)
    }
  })
})

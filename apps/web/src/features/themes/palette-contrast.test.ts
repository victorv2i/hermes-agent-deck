import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = readFileSync(path.join(here, '../../index.css'), 'utf8')
const PALETTES_CSS = readFileSync(path.join(here, 'palettes.css'), 'utf8')

const FACES = [
  {
    name: 'Clay & Sky dark',
    css: INDEX_CSS,
    selector: ":root,\n[data-theme='dark'] {",
  },
  {
    name: 'Clay & Sky light',
    css: INDEX_CSS,
    selector: ":root:not([data-palette])[data-theme='light'] {",
  },
  {
    name: 'Warm Void dark',
    css: PALETTES_CSS,
    selector: "[data-palette='warm-void'],\n[data-palette='warm-void'][data-theme='dark'] {",
  },
  {
    name: 'Warm Void light',
    css: PALETTES_CSS,
    selector: "[data-palette='warm-void'][data-theme='light'] {",
  },
  {
    name: 'Indigo Atelier dark',
    css: PALETTES_CSS,
    selector:
      "[data-palette='indigo-atelier'],\n[data-palette='indigo-atelier'][data-theme='dark'] {",
  },
  {
    name: 'Indigo Atelier light',
    css: PALETTES_CSS,
    selector: "[data-palette='indigo-atelier'][data-theme='light'] {",
  },
] as const

function blockFor(css: string, selector: string): string {
  const idx = css.indexOf(selector)
  expect(idx, `missing selector ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', idx)
  const close = css.indexOf('}', open)
  expect(open, `missing opening brace for ${selector}`).toBeGreaterThanOrEqual(0)
  expect(close, `missing closing brace for ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(open + 1, close)
}

function hexDecl(block: string, token: string): string {
  const match = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  expect(match, `missing --${token}`).not.toBeNull()
  return match![1]!.toLowerCase()
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b))
  const darker = Math.min(luminance(a), luminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('palette token contrast', () => {
  it('keeps --ring byte-identical to --primary in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      expect(hexDecl(block, 'ring'), face.name).toBe(hexDecl(block, 'primary'))
    }
  })

  it('keeps primary action text AA against the primary fill in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'primary'), hexDecl(block, 'primary-foreground'))
      expect(ratio, face.name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps destructive text AA against card surfaces in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'destructive'), hexDecl(block, 'card'))
      expect(ratio, face.name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps --foreground-tertiary AA (>=4.5:1) against card in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'foreground-tertiary'), hexDecl(block, 'card'))
      expect(ratio, `${face.name} foreground-tertiary vs card`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps --foreground-tertiary AA (>=4.5:1) against sidebar in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'foreground-tertiary'), hexDecl(block, 'sidebar'))
      expect(ratio, `${face.name} foreground-tertiary vs sidebar`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps --muted-foreground AA (>=4.5:1) against card in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'muted-foreground'), hexDecl(block, 'card'))
      expect(ratio, `${face.name} muted-foreground vs card`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps --muted-foreground AA (>=4.5:1) against sidebar in every palette face', () => {
    for (const face of FACES) {
      const block = blockFor(face.css, face.selector)
      const ratio = contrast(hexDecl(block, 'muted-foreground'), hexDecl(block, 'sidebar'))
      expect(ratio, `${face.name} muted-foreground vs sidebar`).toBeGreaterThanOrEqual(4.5)
    }
  })

  // The rungs + dock cards (and the onboarding wizard) render muted text heavily
  // ON the surface-1/surface-2 tones, not on --card/--sidebar. Those faces were
  // previously unchecked, so a muted token that read AA on card could still be
  // sub-AA on the surface it actually sits on. Assert both muted tokens against
  // both surface tones for every face. (If a face genuinely fails, do NOT weaken
  // the 4.5 threshold — fix the palette token instead.)
  for (const surface of ['surface-1', 'surface-2'] as const) {
    it(`keeps --foreground-tertiary AA (>=4.5:1) against ${surface} in every palette face`, () => {
      for (const face of FACES) {
        const block = blockFor(face.css, face.selector)
        const ratio = contrast(hexDecl(block, 'foreground-tertiary'), hexDecl(block, surface))
        expect(ratio, `${face.name} foreground-tertiary vs ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps --muted-foreground AA (>=4.5:1) against ${surface} in every palette face`, () => {
      for (const face of FACES) {
        const block = blockFor(face.css, face.selector)
        const ratio = contrast(hexDecl(block, 'muted-foreground'), hexDecl(block, surface))
        expect(ratio, `${face.name} muted-foreground vs ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

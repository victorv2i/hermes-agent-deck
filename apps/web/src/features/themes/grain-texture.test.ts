/**
 * Grain-texture guard (S7 nice-tier) — a hermetic, disk-parse proof that the
 * optional ~4%-opacity aged-paper grain is:
 *   (a) declared as a `--bg-texture` token that defaults to `none`,
 *   (b) only switched ON under the one sanctioned DARK palette (warm-void) —
 *       never the default, never light, never the other palettes,
 *   (c) painted on the BODY background only (off cards), at a low opacity.
 *
 * Pure string parsing (no browser/CSSOM), matching index.theme.test.ts's style,
 * so it stays fast and deterministic. Authored RED before the CSS lands.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = readFileSync(path.join(here, '../../index.css'), 'utf8')
const PALETTES_CSS = readFileSync(path.join(here, 'palettes.css'), 'utf8')

/** Pull the declaration block (selector { ... }) for an exact selector list. */
function blockFor(css: string, selector: string): string | undefined {
  const idx = css.indexOf(selector)
  if (idx === -1) return undefined
  const open = css.indexOf('{', idx)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) return undefined
  return css.slice(open + 1, close)
}

describe('grain texture (--bg-texture)', () => {
  it('defaults to none at the root so no palette is grainy unless opted in', () => {
    const root = blockFor(INDEX_CSS, ":root,\n[data-theme='dark'] {")
    expect(root).toBeDefined()
    expect(root).toMatch(/--bg-texture:\s*none/)
  })

  it('paints the texture on the body background only (off cards)', () => {
    // The body rule references the token; cards never do.
    expect(INDEX_CSS).toMatch(/body\s*\{[^}]*background-image:\s*var\(--bg-texture\)/s)
    // No card/surface utility opts into the texture.
    expect(INDEX_CSS).not.toMatch(/\.ad-surface[^{]*\{[^}]*--bg-texture/s)
    expect(INDEX_CSS).not.toMatch(/\.ad-surface[^{]*\{[^}]*var\(--bg-texture\)/s)
  })

  it('switches the grain ON only under the one sanctioned dark palette', () => {
    const warmVoidDark = blockFor(
      PALETTES_CSS,
      "[data-palette='warm-void'],\n[data-palette='warm-void'][data-theme='dark'] {",
    )
    expect(warmVoidDark).toBeDefined()
    expect(warmVoidDark).toMatch(/--bg-texture:\s*url\(/)
    // The dropped Ember Study family is gone entirely.
    expect(PALETTES_CSS).not.toMatch(/\[data-palette='ember-study'\]/)
  })

  it('resets the grain to none in the grained palette light face', () => {
    // The dark attribute selector also matches in light, so the light face MUST
    // explicitly reset --bg-texture to none (otherwise the grain leaks into light).
    const warmVoidLight = blockFor(PALETTES_CSS, "[data-palette='warm-void'][data-theme='light'] {")
    expect(warmVoidLight).toBeDefined()
    expect(warmVoidLight).toMatch(/--bg-texture:\s*none/)
  })

  it('never grains the un-grained families (clay-sky default, indigo)', () => {
    const indigoDark = blockFor(
      PALETTES_CSS,
      "[data-palette='indigo-atelier'],\n[data-palette='indigo-atelier'][data-theme='dark'] {",
    )
    expect(indigoDark).not.toMatch(/--bg-texture/)
    // The former 'warm-parchment' family is gone (folded into Warm Void's light).
    expect(PALETTES_CSS).not.toMatch(/\[data-palette='warm-parchment'\]/)
  })

  it('uses a low, AA-safe opacity (<=6%) in the noise SVG', () => {
    const warmVoidDark = blockFor(
      PALETTES_CSS,
      "[data-palette='warm-void'],\n[data-palette='warm-void'][data-theme='dark'] {",
    )!
    const m = warmVoidDark.match(/opacity['"]?\s*[:=]\s*['"]?(0?\.\d+)/)
    expect(m, 'expected an opacity in the noise SVG').not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(0.06)
  })
})

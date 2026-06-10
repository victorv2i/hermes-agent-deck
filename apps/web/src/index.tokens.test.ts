/**
 * Token + shared-primitive substrate guard (beautification punch-list, 2026-06-01).
 *
 * A hermetic, disk-parse proof that the polish that flows app-wide through the
 * TOKEN + SHARED-PRIMITIVE layer is actually wired:
 *   - P0.1  the named font-size scale (`--text-2xs … --text-3xl`) exists as theme tokens,
 *   - P0.3  shared elevation tokens (`--shadow-popover` / `--shadow-composer`) are defined
 *           AND exposed through the `@theme inline` block (so `shadow-popover`/`shadow-composer`
 *           utilities resolve them),
 *   - P0.4  those shadow tokens are THEME-AWARE — softer/lower-alpha under `[data-theme='light']`,
 *   - P0.5  `.ad-surface-hover` gains a motion-safe hover lift (translate + a shadow step),
 *   - P1.9  a canonical `.ad-focus` ring utility exists.
 *
 * Pure string parsing (no browser/CSSOM), matching index.theme.test.ts's style, so it stays
 * fast + deterministic. Authored RED before the CSS lands.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = readFileSync(path.join(here, 'index.css'), 'utf8')

/** Pull the declaration block (selector { ... }) for an exact selector/at-rule prelude. */
function blockFor(css: string, selector: string): string | undefined {
  const idx = css.indexOf(selector)
  if (idx === -1) return undefined
  const open = css.indexOf('{', idx)
  if (open === -1) return undefined
  let depth = 1
  let j = open + 1
  while (j < css.length && depth > 0) {
    const ch = css[j]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    j++
  }
  return css.slice(open + 1, j - 1)
}

/** Parse the alpha out of an rgba(...) literal inside a shadow declaration. */
function rgbaAlpha(decl: string): number | null {
  const m = decl.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/)
  return m ? Number(m[1]) : null
}

describe('P0.1 — named font-size scale tokens', () => {
  // The design-language scale is 11·12·13·14(body)·16·20·24·30. The two steps the
  // app lacked a name for (the 11px floor + the 13px step) get NEW tokens; the
  // stock Tailwind names keep their stock sizes so no live consumer shifts.
  it('adds the 11px legibility floor (--text-2xs)', () => {
    expect(INDEX_CSS).toMatch(/--text-2xs:\s*11px/)
  })
  it('names the 13px step (--text-13) without hijacking the 14px body --text-sm', () => {
    expect(INDEX_CSS).toMatch(/--text-13:\s*13px/)
    // The body step stays 14px (0.875rem) — redefining it would shrink ~49 live consumers.
    expect(INDEX_CSS).toMatch(/--text-sm:\s*0\.875rem/)
    expect(INDEX_CSS).not.toMatch(/--text-sm:\s*13px/)
  })
  it('keeps text-xs at the stock 12px (no shift)', () => {
    expect(INDEX_CSS).toMatch(/--text-xs:\s*0\.75rem/)
  })
  it('documents the full scale up through --text-3xl', () => {
    for (const token of ['--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl']) {
      expect(INDEX_CSS).toContain(`${token}:`)
    }
  })
})

describe('P0.3 — shared elevation tokens, exposed for utilities', () => {
  it('defines --shadow-popover + --shadow-composer (the dark/default values)', () => {
    const dark = blockFor(INDEX_CSS, ":root,\n[data-theme='dark'] {")
    expect(dark, ':root dark block').toBeDefined()
    expect(dark).toContain('--shadow-popover:')
    expect(dark).toContain('--shadow-composer:')
  })
  it('exposes both through an @theme inline block (generates shadow-* utilities)', () => {
    // Tailwind v4: a `--shadow-*` in @theme inline that references the runtime var
    // generates a `shadow-*` utility that resolves the (theme-aware) var at use site.
    expect(INDEX_CSS).toMatch(/--shadow-popover:\s*var\(--shadow-popover\)/)
    expect(INDEX_CSS).toMatch(/--shadow-composer:\s*var\(--shadow-composer\)/)
  })
})

describe('P0.4 — theme-aware shadows (lighter under light)', () => {
  it("overrides both shadow tokens under [data-theme='light'] at LOWER alpha", () => {
    // Match the STANDALONE bare `[data-theme='light']` rule (newline-anchored so it
    // doesn't catch the default `:root:not([data-palette])[data-theme='light']`).
    const light = blockFor(INDEX_CSS, "\n[data-theme='light'] {")
    expect(light, "standalone [data-theme='light'] override block").toBeDefined()
    const popLine = light!.split('\n').find((l) => l.includes('--shadow-popover'))
    const compLine = light!.split('\n').find((l) => l.includes('--shadow-composer'))
    expect(popLine, 'light --shadow-popover').toBeTruthy()
    expect(compLine, 'light --shadow-composer').toBeTruthy()
    const lightPop = rgbaAlpha(popLine!)
    const lightComp = rgbaAlpha(compLine!)
    expect(lightPop, 'light popover alpha parsed').not.toBeNull()
    expect(lightComp, 'light composer alpha parsed').not.toBeNull()
    // Dark uses 0.6 / 0.55; light must be strictly lighter so it isn't a muddy black drop.
    expect(lightPop!).toBeLessThan(0.6)
    expect(lightComp!).toBeLessThan(0.55)
  })
})

describe('P0.5 — .ad-surface-hover gains a motion-safe hover lift', () => {
  it('lifts on hover (translate + a shadow step), motion-safe + ≤150ms', () => {
    // The hover declarations live on the .ad-surface-hover:hover rule under a
    // motion-safe guard. Assert the substrate carries a translate + shadow.
    const css = INDEX_CSS
    expect(css).toContain('.ad-surface-hover')
    // A 1px lift.
    expect(css).toMatch(/translateY\(-1px\)/)
    // The transition stays ≤150ms (the existing 0.15s window) and now also animates transform + shadow.
    const hoverBlock = blockFor(css, '.ad-surface-hover {')
    expect(hoverBlock, '.ad-surface-hover base block').toBeDefined()
    expect(hoverBlock).toMatch(/transform/)
    expect(hoverBlock).toMatch(/box-shadow/)
  })
  it('guards the lift behind prefers-reduced-motion (motion-safe only)', () => {
    // The translate must NOT apply when motion is reduced.
    expect(INDEX_CSS).toMatch(/prefers-reduced-motion[\s\S]*ad-surface-hover/)
  })
})

describe('P1.9 — canonical .ad-focus ring', () => {
  it('defines ad-focus as an @utility (so it composes with focus-visible:)', () => {
    // MUST be `@utility` — a `@layer utilities` + @apply class does NOT compose
    // with the `focus-visible:` variant in Tailwind v4 (the ring would silently
    // vanish from inputs/buttons). This guards that exact regression.
    const block = blockFor(INDEX_CSS, '@utility ad-focus')
    expect(block, '@utility ad-focus block').toBeDefined()
    // 2px ring at 50% alpha, offset by the background so it reads on every surface.
    expect(block).toMatch(/ring-2/)
    expect(block).toMatch(/ring-ring\/50/)
    expect(block).toMatch(/ring-offset-2/)
    expect(block).toMatch(/ring-offset-background/)
  })
})

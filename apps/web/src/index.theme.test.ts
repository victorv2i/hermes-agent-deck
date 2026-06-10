/**
 * Theme cascade guard — a JS-only, hermetic proof that a selected palette's
 * light face actually WINS over the default light block.
 *
 * The bug this locks down: index.css `@import`s palettes.css (line 7) BEFORE the
 * default light rule (`:root[data-theme='light']`). The default light selector
 * and a palette's light selector (`[data-palette='x'][data-theme='light']`) have
 * EQUAL specificity (0,2,0), so the cascade falls to SOURCE ORDER — and the
 * default, appearing later, overrode every palette's light tokens. (`@import`
 * must precede all rules, so reordering the import is invalid CSS; the only clean
 * fix is to make the default light selector not match when a palette is set:
 * `:root:not([data-palette])[data-theme='light']`.)
 *
 * This test parses the real CSS files off disk (no browser, no CSSOM — pure
 * string parsing + a faithful specificity+order cascade), then for every
 * palette × {dark, light} plus the 3 default cases asserts the WINNING value of
 * the governed accent/semantic tokens is the palette's value, not the default's.
 * Authored RED against the current CSS: the 4 light-palette cases fail until the
 * selector fix lands.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = readFileSync(path.join(here, 'index.css'), 'utf8')
const PALETTES_CSS = readFileSync(path.join(here, 'features/themes/palettes.css'), 'utf8')

/** The governed tokens the design language promises a palette controls. */
const GOVERNED = ['--primary', '--success', '--warning', '--destructive'] as const
type GovernedToken = (typeof GOVERNED)[number]

const PALETTES = ['warm-void', 'indigo-atelier'] as const
type PaletteId = (typeof PALETTES)[number]

interface ElementState {
  palette: PaletteId | null
  /** The data-theme attribute value, or undefined when absent. */
  theme: 'dark' | 'light' | undefined
}

interface Rule {
  /** Comma-split selectors, trimmed. */
  selectors: string[]
  /** Declared custom properties in this block (token -> value). */
  decls: Map<string, string>
  /** Source order: index of this block across the whole concatenated cascade. */
  order: number
}

interface Specificity {
  a: number
  b: number
  c: number
}

/**
 * Parse top-level rule blocks (selector { decls }) from a stylesheet, skipping
 * at-rule blocks (@theme/@layer/@media etc.). Only the flat top-level rules carry
 * the palette/theme token declarations we care about, so nested at-rule contents
 * are intentionally ignored. `orderBase` offsets source order so concatenated
 * sheets keep a single global ordering.
 */
function parseRules(css: string, orderBase: number): Rule[] {
  const rules: Rule[] = []
  let i = 0
  let order = orderBase
  while (i < css.length) {
    // Skip block comments.
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 2
      continue
    }
    const open = css.indexOf('{', i)
    if (open === -1) break
    // Strip comments out of the prelude before reading the selector.
    const prelude = css
      .slice(i, open)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
    // Find the matching close brace, tracking nesting depth.
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      const ch = css[j]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)

    if (prelude.startsWith('@')) {
      // At-rule (e.g. @theme inline, @layer base, @media …). Skip its block
      // entirely — none of the palette/theme token rules live inside one.
      i = j
      continue
    }

    const decls = new Map<string, string>()
    const cleanBody = body.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const stmt of cleanBody.split(';')) {
      const idx = stmt.indexOf(':')
      if (idx === -1) continue
      const prop = stmt.slice(0, idx).trim()
      const value = stmt.slice(idx + 1).trim()
      if (prop.startsWith('--')) decls.set(prop, value)
    }
    rules.push({
      selectors: prelude.split(',').map((s) => s.trim()),
      decls,
      order: order++,
    })
    i = j
  }
  return rules
}

/** Selector-list specificity = the MAX over its comma parts (per the cascade). */
function selectorSpecificity(selector: string): Specificity {
  // Count :not(...) contents but not the :not() wrapper itself.
  const notArgs: string[] = []
  const stripped = selector.replace(/:not\(([^)]*)\)/g, (_m, inner: string) => {
    notArgs.push(inner)
    return ' '
  })
  const all = stripped + ' ' + notArgs.join(' ')
  // ID selectors (#x) — none here, but counted for completeness.
  const a = (all.match(/#[\w-]+/g) ?? []).length
  // Class (.x), attribute ([x]), pseudo-class (:x) selectors.
  const classes = (all.match(/\.[\w-]+/g) ?? []).length
  const attrs = (all.match(/\[[^\]]*\]/g) ?? []).length
  const pseudoClasses = (all.match(/(?<!:):[\w-]+/g) ?? []).length
  const b = classes + attrs + pseudoClasses
  // Element + pseudo-element selectors (none meaningful here).
  const c = 0
  return { a, b, c }
}

function cmpSpecificity(x: Specificity, y: Specificity): number {
  if (x.a !== y.a) return x.a - y.a
  if (x.b !== y.b) return x.b - y.b
  return x.c - y.c
}

/**
 * Does a single (comma-part) selector match the given element state? We only
 * model the three building blocks these rules actually use: `:root`,
 * `[data-theme='…']`, `[data-palette='…']`, and `:not([data-palette])`. The
 * element is always the root, so `:root` always matches.
 */
function selectorMatches(part: string, state: ElementState): boolean {
  // :not([data-palette]) — true only when NO palette is set.
  if (/:not\(\s*\[data-palette\]\s*\)/.test(part) && state.palette !== null) return false
  // [data-palette='x'] — require that exact palette.
  const palMatch = part.match(/\[data-palette=['"]?([\w-]+)['"]?\]/)
  if (palMatch && palMatch[1] !== state.palette) return false
  // [data-theme='x'] — require that exact theme attribute value.
  const themeMatch = part.match(/\[data-theme=['"]?([\w-]+)['"]?\]/)
  if (themeMatch && themeMatch[1] !== state.theme) return false
  return true
}

/** The strongest specificity among a rule's comma parts that match the state. */
function ruleMatch(rule: Rule, state: ElementState): { spec: Specificity; order: number } | null {
  let best: Specificity | null = null
  for (const part of rule.selectors) {
    if (!selectorMatches(part, state)) continue
    const spec = selectorSpecificity(part)
    if (best === null || cmpSpecificity(spec, best) > 0) best = spec
  }
  return best === null ? null : { spec: best, order: rule.order }
}

/**
 * Resolve the winning value of `token` for an element state via the real
 * cascade: among all matching rules that declare the token, the highest
 * specificity wins; ties break on later source order.
 */
function resolveToken(rules: Rule[], state: ElementState, token: GovernedToken): string | null {
  let winner: { spec: Specificity; order: number; value: string } | null = null
  for (const rule of rules) {
    const value = rule.decls.get(token)
    if (value === undefined) continue
    const m = ruleMatch(rule, state)
    if (!m) continue
    if (
      winner === null ||
      cmpSpecificity(m.spec, winner.spec) > 0 ||
      (cmpSpecificity(m.spec, winner.spec) === 0 && m.order > winner.order)
    ) {
      winner = { spec: m.spec, order: m.order, value }
    }
  }
  return winner ? winner.value : null
}

// index.css comes first in the cascade (it @imports palettes.css at the top, so
// palette rules resolve BEFORE index.css's own later rules in source order).
const PALETTE_RULES = parseRules(PALETTES_CSS, 0)
const INDEX_RULES = parseRules(INDEX_CSS, PALETTE_RULES.length)
const RULES = [...PALETTE_RULES, ...INDEX_RULES]

/**
 * The expected palette value for a token under a given theme, read straight from
 * palettes.css (the source of truth for what a selected palette SHOULD win to).
 */
function paletteExpected(
  palette: PaletteId,
  theme: 'dark' | 'light',
  token: GovernedToken,
): string {
  const value = resolveToken(PALETTE_RULES, { palette, theme }, token)
  if (value === null) {
    throw new Error(`palettes.css has no ${token} for ${palette}/${theme}`)
  }
  return value
}

describe('theme cascade — a selected palette wins its tokens in BOTH themes', () => {
  for (const palette of PALETTES) {
    for (const theme of ['dark', 'light'] as const) {
      it(`${palette} (${theme}) governs ${GOVERNED.join(', ')}`, () => {
        const state: ElementState = { palette, theme }
        for (const token of GOVERNED) {
          const expected = paletteExpected(palette, theme, token)
          const actual = resolveToken(RULES, state, token)
          expect(actual, `${palette}/${theme} ${token}`).toBe(expected)
        }
      })
    }
  }
})

describe('theme cascade — the default (no palette) keeps the default values', () => {
  // Default Clay & Sky values live at the bare :root / [data-theme] in index.css.
  function defaultExpected(theme: 'dark' | 'light' | undefined, token: GovernedToken): string {
    const value = resolveToken(INDEX_RULES, { palette: null, theme }, token)
    if (value === null) throw new Error(`index.css has no default ${token} for theme=${theme}`)
    return value
  }

  // Three default cases: no theme attr (bare :root), explicit dark, explicit light.
  for (const theme of [undefined, 'dark', 'light'] as const) {
    it(`default (theme=${theme ?? 'none'}) resolves to the Clay & Sky values`, () => {
      const state: ElementState = { palette: null, theme }
      for (const token of GOVERNED) {
        const expected = defaultExpected(theme, token)
        const actual = resolveToken(RULES, state, token)
        expect(actual, `default/${theme} ${token}`).toBe(expected)
      }
    })
  }
})

/**
 * Warm-void xterm.js theme, derived from the design-language palette
 * (docs/design/design-language.md). Reads the resolved CSS custom properties at
 * call time so the terminal tracks the active theme (any family, light or dark)
 * without duplicating hex values. Falls back to the dark warm-void palette when
 * a variable is unavailable (e.g. SSR / tests with no computed styles).
 */

/** The subset of xterm's ITheme we set. (Kept local — no xterm import needed.) */
export interface XtermTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** Warm-void (dark) fallbacks straight from the design tokens. */
const DARK_FALLBACK = {
  // The terminal viewport reads as a *designed, slightly-elevated surface* — it
  // sits on surface-1, a hair lifted from the page base (#041C1C), so the framed
  // panel doesn't look like a flat cut-out. Tracks the theme via --surface-1.
  background: '#07211F',
  foreground: '#F2EBDD',
  primary: '#DD8E35',
  muted: '#82918A',
  success: '#3FB7A0',
  danger: '#E5604D',
} as const

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Build the xterm theme from the live CSS variables. The 16 ANSI colors are a
 * restrained, warm-void-harmonized set (amber-leaning yellows, teal-glow greens)
 * so command output looks on-brand without being garish.
 */
export function buildTerminalTheme(): XtermTheme {
  // surface-1 (a hair lifted from the page base) so the framed viewport reads as
  // an elevated, designed panel rather than a flat cut-out — and it still tracks
  // the active theme (Warm Void / Warm Parchment).
  const background = readVar('--surface-1', DARK_FALLBACK.background)
  const foreground = readVar('--foreground', DARK_FALLBACK.foreground)
  const primary = readVar('--primary', DARK_FALLBACK.primary)
  const muted = readVar('--muted-foreground', DARK_FALLBACK.muted)
  const success = readVar('--success', DARK_FALLBACK.success)
  const danger = readVar('--destructive', DARK_FALLBACK.danger)

  return {
    background,
    foreground,
    // Amber caret with a warm-cream accent (the glyph under the block cursor),
    // so the cursor reads as the app's governed amber, legible on the warm void.
    cursor: primary,
    cursorAccent: '#041C1C',
    // ~30% amber tint, matching the app's ::selection rule.
    selectionBackground: 'rgba(221, 142, 53, 0.30)',

    // A warm, teal-tinted black so dark ANSI text never goes flat-grey on the
    // void; the rest of the 16-color set is harmonized to the warm-void palette
    // (amber-leaning yellows, teal-glow greens) so output looks on-brand.
    black: '#0B2826',
    red: danger,
    green: success,
    yellow: primary,
    blue: '#5BA3C7',
    magenta: '#C792EA',
    cyan: success,
    white: foreground,

    brightBlack: muted,
    brightRed: '#E9776A',
    brightGreen: '#5FCAB6',
    brightYellow: '#E9A24D',
    brightBlue: '#7FBEDC',
    brightMagenta: '#D9AFF2',
    brightCyan: '#7FD6C6',
    brightWhite: '#FFFFFF',
  }
}

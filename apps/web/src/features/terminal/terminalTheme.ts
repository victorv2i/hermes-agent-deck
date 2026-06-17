/**
 * xterm.js theme, derived from the live design-language palette (the default is
 * the inviting sky-blue look). Reads the resolved CSS custom properties at call
 * time so the terminal tracks the active theme (any family, light or dark)
 * without duplicating hex values. Falls back to the sky-blue dark palette when a
 * variable is unavailable (e.g. SSR / tests with no computed styles).
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

/** Sky-blue (dark) fallbacks straight from the design tokens. */
const DARK_FALLBACK = {
  // The terminal viewport reads as a *designed, slightly-elevated surface* — it
  // sits on surface-1, a hair lifted from the page base, so the framed panel
  // doesn't look like a flat cut-out. Tracks the theme via --surface-1.
  background: '#1a2333',
  foreground: '#e9eef6',
  primary: '#6fb1ea',
  warning: '#e3b45a',
  muted: '#9aa7b9',
  success: '#56bd9c',
  danger: '#e8736d',
} as const

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** Build an rgba() tint from a #rrggbb hex (xterm's parser can't read color-mix). */
function hexTint(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `rgba(111, 177, 234, ${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Build the xterm theme from the live CSS variables. The bg/fg/cursor/selection
 * + the red/green/yellow ANSI slots track the palette; the rest of the 16-color
 * set is a restrained, cool-harmonized fixed set so command output looks on-brand
 * without being garish.
 */
export function buildTerminalTheme(): XtermTheme {
  // surface-1 (a hair lifted from the page base) so the framed viewport reads as
  // an elevated, designed panel rather than a flat cut-out — and it still tracks
  // the active theme (light / dark, any palette).
  const background = readVar('--surface-1', DARK_FALLBACK.background)
  const foreground = readVar('--foreground', DARK_FALLBACK.foreground)
  const primary = readVar('--primary', DARK_FALLBACK.primary)
  const warning = readVar('--warning', DARK_FALLBACK.warning)
  const muted = readVar('--muted-foreground', DARK_FALLBACK.muted)
  const success = readVar('--success', DARK_FALLBACK.success)
  const danger = readVar('--destructive', DARK_FALLBACK.danger)

  return {
    background,
    foreground,
    // Sky-blue caret; the glyph under the block cursor takes the terminal
    // background so it stays legible whatever the theme.
    cursor: primary,
    cursorAccent: background,
    // ~30% sky-blue tint (built from the live --primary so it tracks light/dark),
    // matching the app's ::selection rule.
    selectionBackground: hexTint(primary, 0.3),

    // A cool, slate-tinted black so dark ANSI text never goes flat-grey; the
    // red/green/yellow slots track the palette, the rest is a calm cool set.
    black: '#16202e',
    red: danger,
    green: success,
    yellow: warning,
    blue: '#5ba3c7',
    magenta: '#b79cf0',
    cyan: success,
    white: foreground,

    brightBlack: muted,
    brightRed: '#e9776a',
    brightGreen: '#5fcab6',
    brightYellow: '#e9c45d',
    brightBlue: '#7fbedc',
    brightMagenta: '#c9b3f5',
    brightCyan: '#7fd6c6',
    brightWhite: '#ffffff',
  }
}

/**
 * Theme palette registry — the single source of truth for the THREE selectable
 * theme FAMILIES (a third design dimension, orthogonal to dark/light mode and
 * density). Each family ships a real LIGHT and DARK variant; the light/dark TOGGLE
 * (the app mode) chooses which one paints.
 *
 * Each family implements the SAME governed token contract (design-language §2/§10):
 * one `--primary` action accent, semantic tokens for status only, lifted hairline
 * borders + a 1px top highlight. A family only swaps the token VALUES under its
 * `[data-palette='<id>']` (dark) + `[data-palette='<id>'][data-theme='light']`
 * (light) selectors — no component code knows palette names.
 *
 * The DEFAULT (`clay-sky`) lives at the bare `:root`, so it loads with zero
 * attribute and the pre-paint guard only has to stamp the NON-default families.
 *
 * Families: Clay & Sky (default), Warm Void · Nous, Indigo Atelier.
 * The former 5th palette `warm-parchment` is NOT its own family — its airy
 * parchment light face folded in as the LIGHT mode of the Warm Void family.
 *
 * Swatches drive the Settings picker preview only (UI metadata, not the applied
 * colors — those live in index.css). Each swatch is the dark/light pair of the
 * family's primary + secondary, so the tile reads as the theme it selects.
 */

export const PALETTE_IDS = ['clay-sky', 'warm-void', 'indigo-atelier'] as const
// NOTE: keep this order identical to the PALETTES array below (the test asserts
// PALETTE_IDS === PALETTES.map(p => p.id)).

export type PaletteId = (typeof PALETTE_IDS)[number]

/** The default palette — the calm-cool, grounded "Clay & Sky". */
export const DEFAULT_PALETTE_ID: PaletteId = 'clay-sky'

/** A dark/light pair of hex values, for the picker swatch. */
export interface SwatchPair {
  /** Hex used in the dark variant. */
  dark: string
  /** Hex used in the light variant. */
  light: string
}

export interface ThemePalette {
  id: PaletteId
  /** Human label shown in Settings + the command palette. */
  label: string
  /** One-line description of the palette's mood. */
  description: string
  /** Preview colors for the picker tile (the governed action accent + a surface). */
  swatch: {
    primary: SwatchPair
    secondary: SwatchPair
  }
  /** The single default that loads with no attribute. */
  isDefault?: boolean
  /**
   * The single suggested starting point — the default Clay & Sky. Purely UI
   * metadata (a quiet "Recommended" hint in the picker / onboarding preselect);
   * orthogonal to `isDefault`, which governs the no-attribute load contract.
   */
  isRecommended?: boolean
}

/**
 * The full ordered registry — the THREE families. Order is the display order in
 * Settings + the command palette: the default Clay & Sky first (the recommended
 * starting point), then Nous's Warm Void, and Indigo. Each family ships a real
 * dark AND light swatch (and CSS) variant.
 */
export const PALETTES: ThemePalette[] = [
  {
    id: 'clay-sky',
    label: 'Clay & Sky',
    description: 'Reliable and grounded: neutral slate, dusty trust-blue accent.',
    swatch: {
      primary: { dark: '#7BA7D9', light: '#2F5C8C' },
      secondary: { dark: '#282C33', light: '#E2E6EC' },
    },
    isDefault: true,
    isRecommended: true,
  },
  {
    id: 'warm-void',
    label: 'Warm Void · Nous',
    description: "Nous's own warm-void: deep teal-black dark, airy parchment light.",
    swatch: {
      // Dark: the signature Nous teal-black + amber. Light: the airy parchment
      // face (folded in from the former Warm Parchment) — cream + deepened amber.
      primary: { dark: '#DD8E35', light: '#9C520D' },
      secondary: { dark: '#0C2A28', light: '#F1EADA' },
    },
  },
  {
    id: 'indigo-atelier',
    label: 'Indigo Atelier',
    description: 'A crafted instrument: warm aubergine, vivid indigo accent.',
    swatch: {
      primary: { dark: '#9B8CFF', light: '#5B45C9' },
      secondary: { dark: '#2B2440', light: '#ECE8F6' },
    },
  },
]

/** Look up a palette by id (undefined when the id is unknown). */
export function getPalette(id: string): ThemePalette | undefined {
  return PALETTES.find((p) => p.id === id)
}

/** Type guard — is the value one of the registered palette ids? */
export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value)
}

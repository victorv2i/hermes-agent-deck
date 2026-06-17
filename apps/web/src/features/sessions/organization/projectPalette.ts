/**
 * The curated CATEGORICAL palette for project colors.
 *
 * This is the design language's allowed data-grouping exception (like chart
 * accents): a small set of calm, distinct hues used ONLY to tell projects apart
 * at a glance (a colored dot + a faint row tint). It is deliberately NOT the
 * governed sky-blue action accent — the first swatch even skips the accent hue so a project
 * dot can never be mistaken for the "active"/primary-action marker.
 *
 * Each entry is an opaque token `id` (what the server stores verbatim in the
 * organization store) mapped to a theme-aware CSS variable. Components read the
 * `var(--cat-N)` reference, never a raw hex, so every theme can tune the actual
 * hue values in CSS while the stored token id stays stable. The values live in
 * `index.css` (default theme) and inherit across the other themes.
 */

/** A single curated categorical swatch. */
export interface ProjectColor {
  /** Opaque, stored token id (e.g. `violet`). Never a hex. */
  id: string
  /** Human label for the picker / accessible names. */
  label: string
  /** The CSS custom property carrying this swatch's theme-aware hue. */
  cssVar: string
}

/**
 * The curated palette, in a deliberate display order. Eight calm hues — enough
 * to distinguish a realistic number of projects without the rail turning into a
 * fruit salad. Ordered so adjacent swatches stay easy to tell apart.
 */
export const PROJECT_COLORS: readonly ProjectColor[] = [
  { id: 'slate', label: 'Slate', cssVar: '--cat-slate' },
  { id: 'violet', label: 'Violet', cssVar: '--cat-violet' },
  { id: 'teal', label: 'Teal', cssVar: '--cat-teal' },
  { id: 'rose', label: 'Rose', cssVar: '--cat-rose' },
  { id: 'sky', label: 'Sky', cssVar: '--cat-sky' },
  { id: 'moss', label: 'Moss', cssVar: '--cat-moss' },
  { id: 'plum', label: 'Plum', cssVar: '--cat-plum' },
  { id: 'sand', label: 'Sand', cssVar: '--cat-sand' },
] as const

/** The default swatch a new-project form starts on (first in the palette). */
export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0]!.id

const BY_ID: ReadonlyMap<string, ProjectColor> = new Map(PROJECT_COLORS.map((c) => [c.id, c]))

/**
 * Resolve a stored color token to its swatch. An unknown token (e.g. a hue
 * removed from the palette, or a hand-edited store) falls back to the first
 * swatch so a project always renders a calm, legible dot rather than nothing.
 */
export function resolveProjectColor(token: string | undefined): ProjectColor {
  return (token && BY_ID.get(token)) || PROJECT_COLORS[0]!
}

/**
 * The CSS color reference for a stored color token — `var(--cat-…)`. Used as an
 * inline style value (`backgroundColor` / `color`) so the swatch tracks the
 * active theme. Categorical, never the sky-blue `--primary`.
 */
export function projectColorVar(token: string | undefined): string {
  return `var(${resolveProjectColor(token).cssVar})`
}

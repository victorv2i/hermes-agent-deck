/**
 * Pre-paint palette resolution — the single, tested source of truth for the logic
 * the inline flash guard in index.html runs before first paint.
 *
 * The guard cannot import modules (it runs before the bundle loads), so the inline
 * script in index.html is a hand-mirrored copy of THIS function. Keeping the rule
 * here lets us unit-test it (no-flash default, valid → stamp, invalid/default →
 * clean DOM) and keep the inline copy honest.
 *
 * Rule: the default palette (`clay-sky`) lives at the bare :root, so it carries
 * NO attribute. Only a valid NON-default palette stamps `data-palette`; an unset,
 * unknown, or default value resolves to null (no attribute) — so there is no
 * default→saved flash and the resting DOM is clean.
 */
import { DEFAULT_PALETTE_ID, isPaletteId } from './palette-registry'

/**
 * Resolve the `data-palette` attribute value to apply before paint, or `null`
 * when no attribute should be set (default / unset / invalid).
 */
export function prePaintPaletteAttr(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!isPaletteId(stored)) return null
  if (stored === DEFAULT_PALETTE_ID) return null
  return stored
}

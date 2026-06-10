/**
 * Palette — the user-selectable color SCHEME (a third design dimension, fully
 * orthogonal to dark/light mode and density).
 *
 * It mirrors the proven density store (./palette is to density what data-palette
 * is to data-density): an imperative module store + a `usePalette()` hook over
 * `useSyncExternalStore` — NO React Context, NO edit to the app shell. The choice
 * is persisted to localStorage and reflected as a `data-palette="<id>"` attribute
 * on <html>.
 *
 * The DEFAULT palette (`clay-sky`) lives at the bare `:root` in index.css, so
 * it carries NO attribute — the resting DOM is clean and the default tokens are
 * the baseline (exactly like Comfortable density). Only the non-default palettes
 * stamp `data-palette`. A tiny inline guard in index.html applies the saved
 * palette before paint (mirroring the theme + density flash guards), so there is
 * no default→saved flash on load. This module is the single source of truth at
 * runtime.
 *
 * Dark/light (`.dark` + `data-theme`) and density (`data-density`) are untouched:
 * a palette only swaps the token VALUES under its `[data-palette]` selectors, so
 * all three dimensions compose freely.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_PALETTE_ID, isPaletteId, type PaletteId } from './palette-registry'

export type Palette = PaletteId

export const PALETTE_STORAGE_KEY = 'agent-deck-palette'

/** Read the persisted palette, or null when unset/invalid/unavailable. */
export function readStoredPalette(): Palette | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(PALETTE_STORAGE_KEY)
  return isPaletteId(v) ? v : null
}

/**
 * Reflect a palette on <html>. The default (`clay-sky`) removes the attribute
 * so the DOM rests clean and the bare-`:root` tokens apply untouched; every other
 * palette stamps `data-palette="<id>"`.
 */
export function applyPalette(palette: Palette): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (palette === DEFAULT_PALETTE_ID) root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', palette)
}

// Module-level current value + subscribers. A tiny store (no Context provider) so
// the Settings picker stays reactive and any number of `usePalette()` callers stay
// in sync, without threading a provider through the app shell.
let current: Palette = readStoredPalette() ?? DEFAULT_PALETTE_ID
const listeners = new Set<() => void>()

/** The current palette (stored value, else the default). */
export function getPalette(): Palette {
  return current
}

/** Persist + apply a palette and notify subscribers. */
export function setPalette(palette: Palette): void {
  current = palette
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, palette)
    } catch {
      // Storage can throw (private mode / quota); the in-memory value + applied
      // attribute still take effect for this session.
    }
  }
  applyPalette(palette)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface UsePalette {
  palette: Palette
  setPalette: (palette: Palette) => void
}

/**
 * Subscribe to the current palette. Reads from the module store via
 * `useSyncExternalStore`, so every caller and the imperative `setPalette()` stay
 * consistent.
 */
export function usePalette(): UsePalette {
  const palette = useSyncExternalStore(subscribe, getPalette, getPalette)
  return { palette, setPalette }
}

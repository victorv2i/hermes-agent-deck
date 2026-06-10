/**
 * Density — a power-user spacing control (Comfortable / Compact).
 *
 * Spacious-by-default is the brand (design-language §1: "mostly whitespace"); a
 * driver with 50+ sessions wants more rows per screen. This is opt-in and lives
 * in Settings (T-E1 / P6).
 *
 * It is deliberately self-contained — no React provider, no edit to the app
 * shell. The chosen density is persisted to localStorage and reflected as a
 * `data-density="compact"` attribute on <html> (the comfortable default carries
 * NO attribute, so the resting DOM is clean and the existing tokens are the
 * baseline). A matching scoped CSS block (`./density.css`, imported here so it
 * ships wherever this module is used) reacts to that attribute via stable
 * design-system selectors only — it never broadly rewrites the token sheet.
 *
 * The attribute is also set before paint by a tiny inline guard in index.html
 * (mirroring the theme-flash guard) so there is no comfortable→compact flash on
 * load. This module is the single source of truth at runtime.
 */
import { useSyncExternalStore } from 'react'
import './density.css'

export type Density = 'comfortable' | 'compact'

export const DENSITY_STORAGE_KEY = 'agent-deck-density'

const DEFAULT_DENSITY: Density = 'comfortable'

function isDensity(value: unknown): value is Density {
  return value === 'comfortable' || value === 'compact'
}

/** Read the persisted density, or null when unset/invalid/unavailable. */
export function readStoredDensity(): Density | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(DENSITY_STORAGE_KEY)
  return isDensity(v) ? v : null
}

/**
 * Reflect a density on <html>. Compact stamps `data-density="compact"`;
 * comfortable (the baseline) removes the attribute so the DOM rests clean and
 * the default tokens apply untouched.
 */
export function applyDensity(density: Density): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (density === 'compact') root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')
}

// Module-level current value + subscribers. A tiny store (no Context provider)
// so the Settings toggle stays reactive and any number of `useDensity()` callers
// stay in sync, without threading a provider through the app shell.
let current: Density = readStoredDensity() ?? DEFAULT_DENSITY
const listeners = new Set<() => void>()

/** The current density (stored value, else the comfortable default). */
export function getDensity(): Density {
  return current
}

/** Persist + apply a density and notify subscribers. */
export function setDensity(density: Density): void {
  current = density
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, density)
    } catch {
      // Storage can throw (private mode / quota); the in-memory value + applied
      // attribute still take effect for this session.
    }
  }
  applyDensity(density)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface UseDensity {
  density: Density
  setDensity: (density: Density) => void
  /** Flip between the two densities. */
  toggle: () => void
}

/**
 * Subscribe to the current density. Reads from the module store via
 * `useSyncExternalStore`, so every caller and the imperative `setDensity()`
 * stay consistent.
 */
export function useDensity(): UseDensity {
  const density = useSyncExternalStore(subscribe, getDensity, getDensity)
  return {
    density,
    setDensity,
    toggle: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
  }
}

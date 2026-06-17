/**
 * Density — a spacing control (Compact / Comfortable).
 *
 * COMPACT is now the default — a dense, pro-desktop read (tighter rows, cards,
 * headers, prose) that fits more per screen. A user who prefers the airier,
 * spacious feel can switch to Comfortable in Settings (T-E1 / P6). The choice
 * persists and the Comfortable option is fully reversible — it simply removes
 * the compact attribute, restoring the airy baseline tokens untouched.
 *
 * It is deliberately self-contained — no React provider, no edit to the app
 * shell. The chosen density is persisted to localStorage and reflected as a
 * `data-density="compact"` attribute on <html> (Comfortable carries NO
 * attribute, so the airy baseline rests clean and the existing tokens apply).
 * A matching scoped CSS block (`./density.css`, imported here so it ships
 * wherever this module is used) reacts to that attribute via stable
 * design-system selectors only — it never broadly rewrites the token sheet.
 *
 * Because COMPACT is the default, the attribute is stamped UNLESS the user has
 * explicitly stored 'comfortable'. The pre-paint inline guard in index.html
 * mirrors this (stamps compact unless the stored value is 'comfortable') so
 * there is no flash on load. This module is the single source of truth at
 * runtime.
 */
import { useSyncExternalStore } from 'react'
import './density.css'

export type Density = 'comfortable' | 'compact'

export const DENSITY_STORAGE_KEY = 'agent-deck-density'

/** Compact is the default read; Comfortable is the opt-in airier mode. */
const DEFAULT_DENSITY: Density = 'compact'

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
 * Reflect a density on <html>. Compact (the default) stamps
 * `data-density="compact"`; comfortable removes the attribute so the airier
 * baseline tokens apply untouched.
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

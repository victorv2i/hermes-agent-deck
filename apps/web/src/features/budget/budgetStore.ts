/**
 * Budget — an optional, soft spend cap.
 *
 * The loudest real user pain with agents is cost SHOCK ("$50/hour", "$360/mo")
 * — the bill arrives after the spend. A soft budget lets a user say "warn me if
 * I go past $X/day or $Y/month" so a runaway is noticed the same day, not at
 * month's end.
 *
 * HONESTY: this is a WARNING, not a kill switch. agent-deck watches a read-only
 * usage rollup; it cannot stop a CLI / telegram / cron run mid-flight. Both caps
 * are unset by default (no nagging out of the box) and live entirely client-side
 * in localStorage — LOCAL-ONLY, nothing leaves the browser.
 *
 * Deliberately self-contained, mirroring `settings/density.ts`: a tiny module
 * store (no React provider) read via `useSyncExternalStore`, so the Settings
 * control and the App-level alert check both observe the same value live.
 */
import { useSyncExternalStore } from 'react'

export interface Budget {
  /** Soft daily cap in USD, or null when unset. */
  daily: number | null
  /** Soft monthly (month-to-date) cap in USD, or null when unset. */
  monthly: number | null
}

export const BUDGET_STORAGE_KEY = 'agent-deck-budget'

const EMPTY_BUDGET: Budget = { daily: null, monthly: null }

/** A positive finite cap, or null. Zero/negative/NaN normalize to null (unset). */
function normalizeCap(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Parse a stored JSON budget, tolerating partial / legacy / corrupt shapes. */
export function parseBudget(raw: string | null): Budget {
  if (!raw) return EMPTY_BUDGET
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return EMPTY_BUDGET
    return {
      daily: normalizeCap(parsed.daily),
      monthly: normalizeCap(parsed.monthly),
    }
  } catch {
    return EMPTY_BUDGET
  }
}

/** Read the persisted budget, or the empty (all-unset) budget. */
export function readStoredBudget(): Budget {
  if (typeof localStorage === 'undefined') return EMPTY_BUDGET
  return parseBudget(localStorage.getItem(BUDGET_STORAGE_KEY))
}

// Module-level current value + subscribers — a tiny store, no Context provider,
// matching settings/density.ts so the control + the alert check stay in sync.
let current: Budget = readStoredBudget()
const listeners = new Set<() => void>()

/** The current budget (stored value, else all-unset). */
export function getBudget(): Budget {
  return current
}

/** True when at least one cap is set — used to gate the alert check cheaply. */
export function hasBudget(budget: Budget = current): boolean {
  return budget.daily !== null || budget.monthly !== null
}

/** Persist + set the budget and notify subscribers. Caps are normalized. */
export function setBudget(next: Partial<Budget>): void {
  current = {
    daily: 'daily' in next ? normalizeCap(next.daily) : current.daily,
    monthly: 'monthly' in next ? normalizeCap(next.monthly) : current.monthly,
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(current))
    } catch {
      // Storage can throw (private mode / quota); the in-memory value still
      // takes effect for this session.
    }
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface UseBudget {
  budget: Budget
  setDaily: (cap: number | null) => void
  setMonthly: (cap: number | null) => void
}

/**
 * Subscribe to the current budget. Reads the module store via
 * `useSyncExternalStore`, so every caller and the imperative `setBudget()` stay
 * consistent without threading a provider through the shell.
 */
export function useBudget(): UseBudget {
  const budget = useSyncExternalStore(subscribe, getBudget, getBudget)
  return {
    budget,
    setDaily: (cap) => setBudget({ daily: cap }),
    setMonthly: (cap) => setBudget({ monthly: cap }),
  }
}

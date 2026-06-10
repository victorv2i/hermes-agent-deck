/**
 * i18n core — a lightweight, dependency-free translation layer.
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────
 *  - `TranslationProvider` (./TranslationProvider.tsx): a React context holding
 *    the active locale (default 'en', persisted to localStorage).
 *  - `useTranslation()` → `{ t, locale, setLocale }`. `t(key, vars?)` looks up a
 *    message in the active locale's catalog, falling back to the `en` catalog,
 *    and finally to the key itself if it's missing everywhere (so a missing
 *    string is loud but never crashes). `{placeholder}` tokens are interpolated
 *    from `vars`.
 *  - The `en` catalog (./messages.en.ts) is the SOURCE OF TRUTH. The `MessageKey`
 *    union is DERIVED from it, so `t()` only accepts keys that actually exist.
 *
 * ── HOW TO WRAP A STRING (the mechanical later-pass pattern) ───────────────
 *  1. Add `'feature.scope.label': 'text'` to ./messages.en.ts.
 *  2. `const { t } = useTranslation()` then `t('feature.scope.label')`.
 *  3. Dynamic values: `'hi {name}'` + `t('...', { name })`.
 *
 * This barrel re-exports the public surface so callers import from '@/i18n'.
 * Straight ASCII quotes only — curly quotes break the build.
 */
import { en } from './messages.en'

/** The supported locale codes. Only 'en' ships today; more are added as sibling
 * catalogs registered in {@link CATALOGS}. Keep this in sync with that map. */
export const LOCALES = ['en'] as const
export type Locale = (typeof LOCALES)[number]

/** The owner default + fallback locale. The `en` catalog is always complete, so
 * it is both the initial locale and the per-key fallback source. */
export const DEFAULT_LOCALE: Locale = 'en'

/** localStorage key for the persisted locale (mirrors the density/theme guards). */
export const LOCALE_STORAGE_KEY = 'agent-deck-locale'

/** The shape every catalog conforms to: the exact key set of `en`. A new locale
 * is a `Partial` of this (missing keys fall back to `en`), but `en` itself is
 * complete. */
export type MessageCatalog = typeof en

/** The compile-time key union — DERIVED from the `en` catalog so `t()` can only
 * be called with a real message key. Adding a key to `en` widens this union. */
export type MessageKey = keyof MessageCatalog

/** Interpolation variables: a flat map of `{placeholder}` name → value. */
export type TranslationVars = Record<string, string | number>

/**
 * The registry of locale → catalog. `en` is complete; future locales register a
 * `Partial<MessageCatalog>` here (missing keys fall back to `en` at lookup).
 * Kept as a plain object so adding a locale is a one-line, mechanical change.
 */
export const CATALOGS: Record<Locale, Partial<MessageCatalog>> = {
  en,
}

/** True when `value` is a known, supported locale code. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Read the persisted locale, or null when unset/invalid/storage-unavailable. */
export function readStoredLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(v) ? v : null
  } catch {
    // Storage can throw (private mode); treat as unset.
    return null
  }
}

/** Persist a locale. Swallows storage errors (private mode / quota) — the
 * in-memory locale still takes effect for the session. */
export function writeStoredLocale(locale: Locale): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // no-op: see note above.
  }
}

/**
 * Interpolate `{name}` placeholders in `template` from `vars`. An unmatched
 * placeholder (no matching var) is left verbatim so a typo is visible rather
 * than silently blanked. Values are coerced to strings.
 */
export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Resolve a message key to a string for a given locale, with interpolation.
 * Lookup order: active-locale catalog → `en` fallback → the key itself. The
 * final key-as-string fallback means a missing translation is loud (you see the
 * raw key) but never throws or renders blank. This is the pure core that the
 * `t()` hook closes over.
 */
export function translate(locale: Locale, key: MessageKey, vars?: TranslationVars): string {
  const active = CATALOGS[locale]
  const template = active?.[key] ?? en[key] ?? key
  return interpolate(template, vars)
}

/** The bound translate function the hook hands components: locale is captured. */
export type TranslateFn = (key: MessageKey, vars?: TranslationVars) => string

export { TranslationProvider } from './TranslationProvider'
export { useTranslation } from './useTranslation'
export type { UseTranslation } from './useTranslation'

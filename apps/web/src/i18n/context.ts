/**
 * The translation React context value + the context object itself, kept in their
 * own module so the provider component and the `useTranslation` hook can import
 * the context without a circular dependency (and so fast-refresh stays happy:
 * the provider file then only exports a component).
 *
 * Straight ASCII quotes only.
 */
import { createContext } from 'react'
import { DEFAULT_LOCALE, type Locale, type TranslateFn } from './index'

export interface TranslationContextValue {
  /** The active locale (default 'en'). */
  locale: Locale
  /** Switch + persist the active locale. */
  setLocale: (locale: Locale) => void
  /** Translate a key (locale captured) with optional interpolation vars. */
  t: TranslateFn
}

/**
 * Default context value: usable WITHOUT a provider (it translates against the
 * default locale and ignores `setLocale`). This keeps `useTranslation()` safe in
 * isolated tests / Storybook-style renders that don't mount the provider — there
 * is no "used outside provider" throw, matching the calm/honest-UI posture.
 */
export const TranslationContext = createContext<TranslationContextValue | null>(null)

export { DEFAULT_LOCALE }

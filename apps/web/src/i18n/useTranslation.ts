/**
 * useTranslation — the hook components call to translate strings.
 *
 *   const { t } = useTranslation()
 *   t('settings.title')               // -> "Settings"
 *   t('greeting.hello', { name })     // -> interpolated
 *
 * Returns `{ t, locale, setLocale }`. Works WITHOUT a mounted provider by falling
 * back to the default-locale context value (see ./context.ts) — so isolated unit
 * tests can call `t()` without wrapping, while the app gets a live, switchable
 * locale once {@link TranslationProvider} is mounted.
 *
 * Straight ASCII quotes only.
 */
import { useContext, useMemo } from 'react'
import {
  DEFAULT_LOCALE,
  translate,
  type Locale,
  type MessageKey,
  type TranslationVars,
} from './index'
import { TranslationContext } from './context'

export interface UseTranslation {
  /** Translate a key with optional `{placeholder}` interpolation vars. */
  t: (key: MessageKey, vars?: TranslationVars) => string
  /** The active locale. */
  locale: Locale
  /** Switch + persist the active locale (no-op without a provider). */
  setLocale: (locale: Locale) => void
}

export function useTranslation(): UseTranslation {
  const ctx = useContext(TranslationContext)

  // No provider mounted: degrade to the default locale. `t` translates against
  // DEFAULT_LOCALE and `setLocale` is an inert no-op. Memoised so the returned
  // object identity is stable across renders.
  const fallback = useMemo<UseTranslation>(
    () => ({
      t: (key: MessageKey, vars?: TranslationVars) => translate(DEFAULT_LOCALE, key, vars),
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
    }),
    [],
  )

  return ctx ?? fallback
}

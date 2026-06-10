/**
 * TranslationProvider — holds the active locale and exposes `{ locale, setLocale,
 * t }` to the tree via context. The locale defaults to 'en', is initialised from
 * localStorage (so a returning user keeps their choice), and is persisted on
 * change. `t` is rebound whenever the locale changes so consumers re-render with
 * the new language.
 *
 * Mounted once near the app root (see main.tsx). Dependency-free; no network.
 * Straight ASCII quotes only.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_LOCALE,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type Locale,
  type MessageKey,
  type TranslationVars,
} from './index'
import { TranslationContext, type TranslationContextValue } from './context'

export function TranslationProvider({
  children,
  /** Test seam: force an initial locale, bypassing the stored value. */
  initialLocale,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale() ?? DEFAULT_LOCALE,
  )

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    writeStoredLocale(next)
  }, [])

  // `t` is bound to the current locale; a new identity on locale change is what
  // re-renders consumers into the new language.
  const t = useCallback(
    (key: MessageKey, vars?: TranslationVars) => translate(locale, key, vars),
    [locale],
  )

  const value = useMemo<TranslationContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  )

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}

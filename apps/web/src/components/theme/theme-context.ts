import { createContext, useContext } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export type ThemeContextValue = {
  /** The user's selection: 'dark' | 'light' | 'system'. */
  theme: ThemeMode
  /** The concrete theme currently applied to <html>. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
  /** Convenience flip between the two concrete themes. */
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export const THEME_STORAGE_KEY = 'agent-deck-theme'

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

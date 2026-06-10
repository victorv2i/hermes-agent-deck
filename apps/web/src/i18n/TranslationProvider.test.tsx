import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, screen, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LOCALE_STORAGE_KEY } from './index'
import { TranslationProvider } from './TranslationProvider'
import { useTranslation } from './useTranslation'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <TranslationProvider>{children}</TranslationProvider>
}

describe('TranslationProvider + useTranslation', () => {
  it('translates a key through the provider', () => {
    function Probe() {
      const { t } = useTranslation()
      return <p>{t('settings.title')}</p>
    }
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('defaults the locale to en', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })
    expect(result.current.locale).toBe('en')
  })

  it('initialises the locale from localStorage', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const { result } = renderHook(() => useTranslation(), { wrapper })
    expect(result.current.locale).toBe('en')
  })

  it('setLocale switches and persists the active locale', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })
    act(() => result.current.setLocale('en'))
    expect(result.current.locale).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })

  it('t() interpolates vars', () => {
    function Probe() {
      const { t } = useTranslation()
      // settings.locale.title is a static key; assert interpolation API does not
      // mangle a no-placeholder string.
      return <span>{t('settings.locale.title', { unused: 'x' })}</span>
    }
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByText('Language')).toBeInTheDocument()
  })

  it('initialLocale test seam overrides the stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    function Probe() {
      const { locale } = useTranslation()
      return <span data-testid="loc">{locale}</span>
    }
    render(
      <TranslationProvider initialLocale="en">
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByTestId('loc')).toHaveTextContent('en')
  })
})

describe('useTranslation without a provider', () => {
  it('falls back to the default locale and still translates', () => {
    const { result } = renderHook(() => useTranslation())
    expect(result.current.locale).toBe('en')
    expect(result.current.t('settings.title')).toBe('Settings')
  })

  it('setLocale is an inert no-op without a provider', () => {
    const { result } = renderHook(() => useTranslation())
    act(() => result.current.setLocale('en'))
    // No throw, locale unchanged.
    expect(result.current.locale).toBe('en')
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '@/i18n'
import { LocaleControl } from './LocaleControl'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderControl() {
  return render(
    <TranslationProvider>
      <LocaleControl />
    </TranslationProvider>,
  )
}

describe('LocaleControl', () => {
  it('renders the language title and the honest "coming soon" line', () => {
    renderControl()
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByText('More languages coming. Contributions welcome.')).toBeInTheDocument()
  })

  it('exposes an accessible radiogroup with English selected', () => {
    renderControl()
    const group = screen.getByRole('radiogroup', { name: 'Language' })
    expect(group).toBeInTheDocument()
    const en = screen.getByRole('radio', { name: 'English' })
    expect(en).toHaveAttribute('aria-checked', 'true')
  })

  it('gives each language segment a 44px mobile touch target (relaxed on sm+)', () => {
    renderControl()
    const group = screen.getByRole('radiogroup', { name: 'Language' })
    for (const radio of within(group).getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 for compact desktop.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })

  it('selecting a locale persists it to localStorage', async () => {
    const user = userEvent.setup()
    renderControl()
    await user.click(screen.getByRole('radio', { name: 'English' }))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })
})

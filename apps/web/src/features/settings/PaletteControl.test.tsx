import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaletteControl } from './PaletteControl'
import { PALETTE_STORAGE_KEY, setPalette, getPalette } from '@/features/themes/palette'
import { DEFAULT_PALETTE_ID, PALETTES } from '@/features/themes/palette-registry'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { THEME_STORAGE_KEY } from '@/components/theme/theme-context'

/** Render inside the real ThemeProvider so the light/dark toggle drives the one
 *  app-mode source of truth (not a divergent local copy). */
function renderControl(defaultTheme: 'dark' | 'light' = 'dark') {
  return render(
    <ThemeProvider defaultTheme={defaultTheme}>
      <PaletteControl />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-palette')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  setPalette(DEFAULT_PALETTE_ID)
  localStorage.clear()
})

afterEach(() => {
  setPalette(DEFAULT_PALETTE_ID)
  localStorage.clear()
  document.documentElement.removeAttribute('data-palette')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})

describe('PaletteControl', () => {
  it('renders a swatch grid with one radio per registered family (exactly three)', () => {
    renderControl()
    const group = screen.getByRole('radiogroup', { name: /theme/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(PALETTES.length)
    expect(radios).toHaveLength(3)
    // Each family's label is present.
    for (const p of PALETTES) {
      expect(screen.getByRole('radio', { name: new RegExp(p.label, 'i') })).toBeInTheDocument()
    }
  })

  it('marks the default family as checked initially', () => {
    renderControl()
    const claySky = screen.getByRole('radio', { name: /Clay & Sky/i })
    expect(claySky).toHaveAttribute('aria-checked', 'true')
  })

  it('lists Clay & Sky first and tags it as recommended', () => {
    renderControl()
    const group = screen.getByRole('radiogroup', { name: /theme/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios[0]).toHaveAccessibleName(/Clay & Sky/i)
    expect(within(radios[0]!).getByText(/recommended/i)).toBeInTheDocument()
  })

  it('applies a family live on selection (DOM attribute + store + persistence)', async () => {
    const user = userEvent.setup()
    renderControl()
    await user.click(screen.getByRole('radio', { name: /Warm Void/i }))

    expect(getPalette()).toBe('warm-void')
    expect(document.documentElement.getAttribute('data-palette')).toBe('warm-void')
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('warm-void')
    // The selection moves.
    expect(screen.getByRole('radio', { name: /Warm Void/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: /Clay & Sky/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('selecting the default family clears the attribute (clean DOM)', async () => {
    const user = userEvent.setup()
    renderControl()
    await user.click(screen.getByRole('radio', { name: /Indigo Atelier/i }))
    expect(document.documentElement.getAttribute('data-palette')).toBe('indigo-atelier')

    await user.click(screen.getByRole('radio', { name: /Clay & Sky/i }))
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
    expect(getPalette()).toBe('clay-sky')
  })

  it('reflects an external family change (shared store subscription)', async () => {
    renderControl()
    await Promise.resolve()
    screen.getByRole('radio', { name: /Clay & Sky/i })
    setPalette('indigo-atelier')
    expect(await screen.findByRole('radio', { name: /Indigo Atelier/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offers an accessible light/dark mode toggle reflecting the current mode', () => {
    renderControl('dark')
    // A governed two-option mode toggle (recognition, not a hidden control).
    const group = screen.getByRole('radiogroup', { name: /mode|appearance/i })
    const light = within(group).getByRole('radio', { name: /light/i })
    const dark = within(group).getByRole('radio', { name: /dark/i })
    expect(dark).toHaveAttribute('aria-checked', 'true')
    expect(light).toHaveAttribute('aria-checked', 'false')
  })

  it('switching the mode toggle drives the real, persisted app mode', async () => {
    const user = userEvent.setup()
    renderControl('dark')
    const group = screen.getByRole('radiogroup', { name: /mode|appearance/i })
    await user.click(within(group).getByRole('radio', { name: /light/i }))

    // The ONE app-mode source of truth flips: <html> attribute + class + storage.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    // The toggle reflects the new mode.
    expect(within(group).getByRole('radio', { name: /light/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('renders in isolation with no ThemeProvider; the mode toggle still drives <html>', async () => {
    const user = userEvent.setup()
    // No provider wrapper — exercises the graceful DOM fallback (hermetic render).
    render(<PaletteControl />)
    const group = screen.getByRole('radiogroup', { name: /mode|appearance/i })
    // Defaults to dark (the app's dark-default + the pre-paint guard).
    expect(within(group).getByRole('radio', { name: /dark/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(group).getByRole('radio', { name: /light/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(within(group).getByRole('radio', { name: /light/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('gives the mode-toggle segments a 44px mobile touch target (relaxed on sm+)', () => {
    renderControl('dark')
    const group = screen.getByRole('radiogroup', { name: /mode|appearance/i })
    for (const radio of within(group).getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 to keep the compact
      // desktop density.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })

  it('previews swatches in the active mode (light tones in light mode)', async () => {
    const user = userEvent.setup()
    renderControl('dark')
    const modeGroup = screen.getByRole('radiogroup', { name: /mode|appearance/i })
    await user.click(within(modeGroup).getByRole('radio', { name: /light/i }))

    // Clay & Sky's light primary is the deepened blue; the swatch chip should now
    // render the LIGHT tone, not the dark one.
    const claySky = screen.getByRole('radio', { name: /Clay & Sky/i })
    const chip = claySky.querySelector('[data-swatch-primary]') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip!.style.backgroundColor).toBe('rgb(47, 92, 140)') // #2F5C8C light
  })
})

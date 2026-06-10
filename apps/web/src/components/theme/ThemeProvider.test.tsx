import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from './ThemeProvider'
import { useTheme } from './theme-context'
import { ThemeToggle } from './ThemeToggle'

function setSystemPrefersDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function Probe() {
  const { theme, resolvedTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to dark mode: html gets .dark and data-theme="dark"', () => {
    setSystemPrefersDark(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    // Default selection is dark (the palette default is Clay & Sky; mode is separate).
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })

  it('honors system preference when theme is set to "system"', () => {
    setSystemPrefersDark(false)
    render(
      <ThemeProvider defaultTheme="system">
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByTestId('resolved').textContent).toBe('light')
  })

  it('the header toggle cycles light → dark → system and persists each selection', async () => {
    const user = userEvent.setup()
    // OS prefers light, so the 'system' step resolves to light below.
    setSystemPrefersDark(false)
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    )
    // Default selection is dark → first click advances to system (next in cycle).
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('theme').textContent).toBe('dark')

    await user.click(screen.getByRole('button', { name: /theme/i }))
    // 'system' is reachable from the chrome and persists.
    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(localStorage.getItem('agent-deck-theme')).toBe('system')
    // While system is selected, the resolved (OS-light) is what actually paints.
    expect(screen.getByTestId('resolved').textContent).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: /theme/i }))
    // system → light.
    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('agent-deck-theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: /theme/i }))
    // light → dark, completing the cycle.
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('a saved "system" choice survives the header toggle (it is reachable + restored)', () => {
    // Regression: the old 2-way toggle could never SET system and would clobber a
    // saved one. A persisted 'system' must restore and follow the OS.
    localStorage.setItem('agent-deck-theme', 'system')
    setSystemPrefersDark(true)
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // The control announces the resolved preview while following the system.
    expect(screen.getByRole('button', { name: /system \(currently dark\)/i })).toBeInTheDocument()
  })

  it('restores the persisted theme on mount', () => {
    localStorage.setItem('agent-deck-theme', 'light')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })

  it('throws if useTheme is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => act(() => render(<Probe />))).toThrow(/ThemeProvider/)
    spy.mockRestore()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { AppShell } from '@/components/layout/AppShell'
import { useHeaderStore, useHeaderSlot } from './headerStore'

function setViewport(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width') ? isMobile : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/** A surface that projects header content for as long as it is mounted. */
function SurfaceWithHeader({ label }: { label: string }) {
  useHeaderSlot(<span data-testid="projected">{label}</span>)
  return <div data-testid="surface">body</div>
}

// Render at an UNKNOWN route so the shell's surface-title fallback (which now
// fills an otherwise-empty header slot with the active surface name) resolves to
// null — keeping these tests focused purely on the useHeaderSlot mechanism (a
// projecting route's content vs. its absence), not the title fallback.
function renderShellWith(child: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/__no_surface__']}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppShell connection="online">{child}</AppShell>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('header slot', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    setViewport(false)
    // Reset the module-level store between tests.
    useHeaderStore.setState({ content: null })
  })

  it('is empty by default', () => {
    const { getByTestId } = renderShellWith(<div data-testid="surface">body</div>)
    const slot = getByTestId('header-slot')
    expect(slot).toBeInTheDocument()
    expect(slot).toBeEmptyDOMElement()
  })

  it('renders content a route projects via useHeaderSlot', () => {
    renderShellWith(<SurfaceWithHeader label="My session · gpt-5.5" />)
    const slot = screen.getByTestId('header-slot')
    expect(slot).toHaveTextContent('My session · gpt-5.5')
    expect(screen.getByTestId('projected')).toBeInTheDocument()
  })

  it('clears the slot when the projecting surface unmounts', () => {
    const { rerender } = renderShellWith(<SurfaceWithHeader label="Live header" />)
    expect(screen.getByTestId('header-slot')).toHaveTextContent('Live header')

    rerender(
      <MemoryRouter initialEntries={['/__no_surface__']}>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider>
            <AppShell connection="online">
              <div data-testid="surface">no header</div>
            </AppShell>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('header-slot')).toBeEmptyDOMElement()
  })
})

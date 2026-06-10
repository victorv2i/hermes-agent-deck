import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { toast } from '@/lib/toast'
import { Toaster } from './toaster'

function renderToaster() {
  return render(
    <ThemeProvider defaultTheme="dark">
      <Toaster />
    </ThemeProvider>,
  )
}

describe('Toaster + toast API', () => {
  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    toast.dismiss()
    cleanup()
  })

  it('mounts a bottom toaster region once a toast appears', async () => {
    renderToaster()
    toast('hello')
    await screen.findByText('hello')
    // sonner renders its toaster region (an aria-live list) when a toast exists.
    expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull()
  })

  it('shows a message when toast() is called', async () => {
    renderToaster()
    toast('Saved your changes')
    expect(await screen.findByText('Saved your changes')).toBeInTheDocument()
  })

  it('renders a semantic success toast', async () => {
    renderToaster()
    toast.success('Copied transcript')
    expect(await screen.findByText('Copied transcript')).toBeInTheDocument()
  })

  it('renders an error toast with a description', async () => {
    renderToaster()
    toast.error('Couldn’t delete', { description: 'Network error' })
    expect(await screen.findByText('Couldn’t delete')).toBeInTheDocument()
    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })
})

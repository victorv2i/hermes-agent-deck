import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShortcutsOverlay } from './ShortcutsOverlay'

describe('ShortcutsOverlay', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders the shortcut reference when open', () => {
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
    expect(screen.getByText(/Command palette/i)).toBeInTheDocument()
    expect(screen.getByText(/New chat/i)).toBeInTheDocument()
    // The right detail drawer was removed in v1; it is never advertised here.
    expect(screen.queryByText(/detail drawer/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Abort the running/i)).toBeInTheDocument()
  })

  it('lists the REAL full keyboard set (the overlay must not lie about bindings)', () => {
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    // Preview panel toggle (⌘⇧V). The retired Run-panel/Activity drawer is gone —
    // tool calls + approvals render inline in the chat stream, no drawer to toggle.
    expect(screen.getByText(/Preview panel/i)).toBeInTheDocument()
    expect(screen.queryByText(/Run panel/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Activity panel/i)).not.toBeInTheDocument()
    // Sessions pane toggle (⌘B)
    expect(screen.getByText(/sessions pane/i)).toBeInTheDocument()
    // j/k session navigation through the rail
    expect(screen.getByText(/Move through sessions/i)).toBeInTheDocument()
    // The slash command menu
    expect(screen.getByText(/command menu in the composer/i)).toBeInTheDocument()
    // The self-reference + abort row are present too
    expect(screen.getByText(/Show this shortcut reference/i)).toBeInTheDocument()
  })

  it('shows the j and k keys for session navigation', () => {
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    const keys = screen.getAllByText('j')
    expect(keys.length).toBeGreaterThan(0)
    expect(screen.getAllByText('k').length).toBeGreaterThan(0)
  })

  it('shows the "/" key for the composer command menu', () => {
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<ShortcutsOverlay open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('spells the modifier as ⌘ on Mac (C3 platform key)', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' } as Navigator)
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    // The command-palette row's modifier key cap reads ⌘ on Apple platforms.
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ctrl')).not.toBeInTheDocument()
  })

  it('spells the modifier as Ctrl on Linux/Windows (C3 platform key)', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' } as Navigator)
    render(<ShortcutsOverlay open onOpenChange={vi.fn()} />)
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0)
    expect(screen.queryByText('⌘')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MemoryStatus } from '@agent-deck/protocol'
import { MemoryProviderSection, type MemoryProviderSectionProps } from './MemoryProviderSection'

const MEMORY_STATUS: MemoryStatus = {
  active: 'mem0',
  providers: [{ name: 'mem0', description: 'Mem0 cloud memory', configured: true }],
  builtin_files: { memory: 1024 * 512, user: 0 },
}

const BUILTIN_MEMORY_STATUS: MemoryStatus = {
  active: '',
  providers: [{ name: 'mem0', description: 'Mem0 cloud memory', configured: true }],
  builtin_files: { memory: 1024 * 128, user: 1024 * 64 },
}

function setup(overrides: Partial<MemoryProviderSectionProps> = {}) {
  const props: MemoryProviderSectionProps = {
    memoryStatus: MEMORY_STATUS,
    isLoading: false,
    error: null,
    isSwitching: false,
    isResetting: false,
    switchResult: null,
    onSwitchProvider: vi.fn(),
    onResetMemory: vi.fn(),
    ...overrides,
  }
  render(<MemoryProviderSection {...props} />)
  return props
}

describe('MemoryProviderSection', () => {
  it('shows the active provider name', () => {
    setup()
    expect(screen.getByText('mem0')).toBeInTheDocument()
    expect(screen.getByText(/^Active:$/i)).toBeInTheDocument()
  })

  it('shows "Built-in" when no external provider is active', () => {
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS })
    // The "Built-in" label appears in the active provider display
    // (may appear multiple times — in the active chip and potentially in catalog)
    expect(screen.getAllByText(/built-in/i).length).toBeGreaterThan(0)
  })

  it('shows provider catalog when the toggle is clicked', () => {
    setup()
    // Initially the catalog is hidden
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    // The toggle button mentions "available" or "providers"
    const toggleBtn = screen.getByRole('button', { name: /provider.*available|hide provider/i })
    fireEvent.click(toggleBtn)
    // Now the catalog renders
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('shows a "Restart to apply" badge after switching providers', () => {
    setup({ switchResult: { active: 'mem0', restart_required: true } })
    expect(screen.getByText(/restart to apply/i)).toBeInTheDocument()
  })

  it('shows built-in file sizes', () => {
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS })
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument()
    expect(screen.getByText('USER.md')).toBeInTheDocument()
    // File sizes render (128 KiB and 64 KiB)
    expect(screen.getByText('128 KiB')).toBeInTheDocument()
    expect(screen.getByText('64 KiB')).toBeInTheDocument()
  })

  it('shows a Reset all memory button', () => {
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS })
    expect(screen.getByRole('button', { name: /reset all memory/i })).toBeInTheDocument()
  })

  it('opens a confirm dialog when Reset all memory is clicked', () => {
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS })
    fireEvent.click(screen.getByRole('button', { name: /reset all memory/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/permanently deletes/i)).toBeInTheDocument()
  })

  it('calls onResetMemory(all) when the confirm dialog is confirmed', () => {
    const onResetMemory = vi.fn()
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS, onResetMemory })
    fireEvent.click(screen.getByRole('button', { name: /reset all memory/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset memory/i }))
    expect(onResetMemory).toHaveBeenCalledWith('all')
  })

  it('closes the dialog without resetting when Cancel is clicked', () => {
    const onResetMemory = vi.fn()
    setup({ memoryStatus: BUILTIN_MEMORY_STATUS, onResetMemory })
    fireEvent.click(screen.getByRole('button', { name: /reset all memory/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onResetMemory).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a loading state', () => {
    setup({ memoryStatus: null, isLoading: true })
    expect(screen.getByText(/loading memory status/i)).toBeInTheDocument()
  })

  it('shows an error', () => {
    setup({ memoryStatus: null, isLoading: false, error: 'Could not reach Hermes.' })
    expect(screen.getByText(/could not reach hermes/i)).toBeInTheDocument()
  })

  it('shows the honest boundary note about "configured" vs "connected"', () => {
    setup()
    expect(screen.getByText(/configured.*not.*necessarily.*connected/i)).toBeInTheDocument()
  })
})

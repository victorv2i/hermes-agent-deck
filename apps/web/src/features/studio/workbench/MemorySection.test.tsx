import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MemoryStatus, StudioMemoryConfig } from '@agent-deck/protocol'
import { MemorySection } from './MemorySection'

const MEMORY_CONFIG: StudioMemoryConfig = {
  memory_enabled: true,
  user_profile_enabled: false,
  memory_char_limit: 2000,
  // Hermes types memory.write_approval as a boolean (false = apply automatically).
  write_approval: false,
}

const STATUS: MemoryStatus = {
  active: 'holographic_plus',
  providers: [{ name: 'holographic_plus', description: 'Hybrid memory', configured: true }],
  builtin_files: { memory: 0, user: 0 },
}

describe('MemorySection', () => {
  it('shows the memory config toggles from memory.* (no flat-file editor)', () => {
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={vi.fn()}
        providerStatus={STATUS}
        isActiveAgent
        onSwitchProvider={vi.fn()}
      />,
    )
    expect(screen.getByRole('switch', { name: /agent memory/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: /user profile/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    // CRUCIAL: no flat-file (MEMORY.md / USER.md) editor or reset is present.
    expect(screen.queryByText(/MEMORY\.md/)).not.toBeInTheDocument()
    expect(screen.queryByText(/USER\.md/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset.*memory/i })).not.toBeInTheDocument()
  })

  it('toggling memory_enabled writes the memory.* config patch', async () => {
    const onChangeConfig = vi.fn().mockResolvedValue(undefined)
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={onChangeConfig}
        providerStatus={STATUS}
        isActiveAgent
        onSwitchProvider={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('switch', { name: /agent memory/i }))
    expect(onChangeConfig).toHaveBeenCalledWith({ memory: { memory_enabled: false } })
  })

  it('write-approval toggle writes the boolean memory.write_approval patch', async () => {
    const onChangeConfig = vi.fn().mockResolvedValue(undefined)
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={onChangeConfig}
        providerStatus={STATUS}
        isActiveAgent
        onSwitchProvider={vi.fn()}
      />,
    )
    // Fixture is write_approval: false (Automatic selected). Choosing "Ask first"
    // writes write_approval: true (the boolean shape Hermes stores).
    await userEvent.click(screen.getByRole('button', { name: /ask first/i }))
    expect(onChangeConfig).toHaveBeenCalledWith({ memory: { write_approval: true } })
  })

  it('shows the active provider and lets the user switch it', async () => {
    const onSwitchProvider = vi.fn()
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={vi.fn()}
        providerStatus={STATUS}
        isActiveAgent
        onSwitchProvider={onSwitchProvider}
      />,
    )
    // The active provider is named in the "Active:" line (it also appears as a
    // disabled option in the catalog, so assert on the active line specifically).
    expect(screen.getByTestId('studio-memory-active-provider')).toHaveTextContent(
      'holographic_plus',
    )
    // The built-in option switches the provider to "" (the built-in store).
    await userEvent.click(screen.getByRole('button', { name: /built-in/i }))
    expect(onSwitchProvider).toHaveBeenCalledWith('')
  })

  it('renders the memory.* config even when the provider catalog is unavailable', () => {
    // The provider catalog (/memory-provider) can be missing on some Hermes
    // builds. The section must STILL render the memory.* config from /studio/config
    // and degrade by simply omitting the provider block, never blocking on it.
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={vi.fn()}
        providerStatus={null}
        isActiveAgent
        onSwitchProvider={vi.fn()}
      />,
    )
    // The config toggles render from /studio/config alone.
    expect(screen.getByRole('switch', { name: /agent memory/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /user profile/i })).toBeInTheDocument()
    // No loading skeleton (the section is not stuck waiting on the provider).
    expect(screen.queryByTestId('studio-memory-skeleton')).not.toBeInTheDocument()
    // The provider block is omitted (no "Memory provider" heading / Active line).
    expect(screen.queryByText(/memory provider/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('studio-memory-active-provider')).not.toBeInTheDocument()
  })

  it('disables provider controls and explains why when this is not the active agent', () => {
    render(
      <MemorySection
        memory={MEMORY_CONFIG}
        isLoading={false}
        error={null}
        onChangeConfig={vi.fn()}
        providerStatus={STATUS}
        isActiveAgent={false}
        onSwitchProvider={vi.fn()}
      />,
    )
    // The provider switch is scoped to the active agent (stock Hermes tracks one
    // memory provider), so it is honestly disabled with a note here.
    expect(screen.getByText(/switch to this agent/i)).toBeInTheDocument()
  })
})

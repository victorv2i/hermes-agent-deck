import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelPicker } from './ModelPicker'
import type { ModelEntry } from '@/features/models/types'

const MODELS: ModelEntry[] = [
  {
    id: 'claude-opus-4',
    qualifiedId: 'anthropic/claude-opus-4',
    label: 'Claude Opus 4',
    provider: 'anthropic',
    active: true,
    usable: true,
    source: 'config',
  },
  {
    id: 'gpt-5.5',
    qualifiedId: 'openai/gpt-5.5',
    label: 'GPT-5.5',
    provider: 'openai',
    active: false,
    usable: true,
    source: 'config',
  },
]

describe('ModelPicker', () => {
  it('shows the selected model label on the trigger chip (keyed by qualifiedId)', () => {
    render(<ModelPicker models={MODELS} value="openai/gpt-5.5" onSelect={() => {}} />)
    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('GPT-5.5')
  })

  it('uses a 44px mobile hit target for the trigger', () => {
    render(<ModelPicker models={MODELS} value="openai/gpt-5.5" onSelect={() => {}} />)
    expect(screen.getByTestId('model-picker-trigger').className).toContain('h-11')
  })

  it('opens a popover listing every model and calls onSelect with the chosen qualifiedId', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ModelPicker models={MODELS} value="anthropic/claude-opus-4" onSelect={onSelect} />)

    await user.click(screen.getByTestId('model-picker-trigger'))
    const list = await screen.findByRole('listbox', { name: /select a model/i })
    expect(within(list).getAllByRole('option')).toHaveLength(2)

    await user.click(within(list).getByRole('option', { name: /GPT-5\.5/ }))
    // Selection is by qualifiedId, never the bare id (which collides across providers).
    expect(onSelect).toHaveBeenCalledWith('openai/gpt-5.5')
  })

  it('disambiguates duplicate bare ids by qualifiedId (no key collision, distinct picks)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    // The real-world collision: `gpt-5.4` exists under two providers.
    const dupes: ModelEntry[] = [
      {
        id: 'gpt-5.4',
        qualifiedId: 'openai-codex/gpt-5.4',
        label: 'gpt-5.4',
        provider: 'openai-codex',
        active: true,
        usable: true,
        source: 'config',
      },
      {
        id: 'gpt-5.4',
        qualifiedId: 'copilot/gpt-5.4',
        label: 'gpt-5.4',
        provider: 'copilot',
        active: false,
        usable: true,
        source: 'config',
      },
    ]
    render(<ModelPicker models={dupes} value="openai-codex/gpt-5.4" onSelect={onSelect} />)
    await user.click(screen.getByTestId('model-picker-trigger'))
    const options = screen.getAllByRole('option')
    // Both render (no React key collision drops one) and exactly one is the current selection.
    expect(options).toHaveLength(2)
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    // Picking the copilot row commits ITS qualifiedId, not the shared bare id.
    await user.click(options[1]!)
    expect(onSelect).toHaveBeenCalledWith('copilot/gpt-5.4')
  })

  it('marks the active model as the current selection for screen readers', async () => {
    const user = userEvent.setup()
    render(<ModelPicker models={MODELS} value="anthropic/claude-opus-4" onSelect={() => {}} />)
    await user.click(screen.getByTestId('model-picker-trigger'))
    const selected = await screen.findByRole('option', { name: /Claude Opus 4/ })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected.className).toContain('min-h-11')
  })

  it('renders a non-usable model DISABLED with an honest hint, and never calls onSelect for it', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const withLocked: ModelEntry[] = [
      ...MODELS,
      {
        id: 'claude-sonnet-4.6',
        qualifiedId: 'copilot/claude-sonnet-4.6',
        label: 'claude-sonnet-4.6',
        provider: 'copilot',
        active: false,
        usable: false,
        source: 'config',
      },
    ]
    render(<ModelPicker models={withLocked} value="anthropic/claude-opus-4" onSelect={onSelect} />)
    await user.click(screen.getByTestId('model-picker-trigger'))
    const locked = screen.getByRole('option', { name: /claude-sonnet-4\.6/ })
    // It is honestly disabled — not a control that can only fail.
    expect(locked).toBeDisabled()
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    // The hint names the action needed (connect/switch the provider) so the user knows why.
    expect(locked).toHaveTextContent(/connect copilot/i)
    // Clicking it is a no-op — never a silent pick.
    await user.click(locked)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('strips the redundant vendor prefix from a qualified-id label (the brand mark carries the vendor)', async () => {
    const user = userEvent.setup()
    // The real aggregator case: the label IS the provider-qualified id, so without
    // stripping the rows read "anthropic/...", clip, and become indistinguishable.
    const aggregated: ModelEntry[] = [
      {
        id: 'anthropic/claude-opus-4.8',
        qualifiedId: 'nous/anthropic/claude-opus-4.8',
        label: 'anthropic/claude-opus-4.8',
        provider: 'nous',
        active: true,
        usable: true,
        source: 'config',
      },
    ]
    render(
      <ModelPicker models={aggregated} value="nous/anthropic/claude-opus-4.8" onSelect={() => {}} />,
    )
    const trigger = screen.getByTestId('model-picker-trigger')
    expect(trigger).toHaveTextContent('claude-opus-4.8')
    expect(trigger).not.toHaveTextContent('anthropic/')
    await user.click(trigger)
    const option = screen.getByRole('option', { name: /claude-opus-4\.8/ })
    expect(option).toHaveTextContent('claude-opus-4.8')
    expect(option).not.toHaveTextContent('anthropic/')
  })

  it('falls back to the short id when a model has no label, and renders nothing with no models', () => {
    const { rerender } = render(
      <ModelPicker
        models={[
          {
            id: 'raw',
            qualifiedId: 'local/raw',
            label: '',
            provider: 'local',
            active: true,
            usable: true,
            source: 'config',
          },
        ]}
        value="local/raw"
        onSelect={() => {}}
      />,
    )
    // The chip is space-constrained, so the provider-qualified id is trimmed.
    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('raw')

    rerender(<ModelPicker models={[]} value={null} onSelect={() => {}} />)
    expect(screen.queryByTestId('model-picker-trigger')).not.toBeInTheDocument()
  })
})

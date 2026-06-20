import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModelOptionsResponse } from '@agent-deck/protocol'
import { ModelSection } from './ModelSection'

const OPTIONS: ModelOptionsResponse = {
  providers: [
    {
      slug: 'anthropic',
      name: 'Anthropic',
      is_current: true,
      is_user_defined: false,
      models: ['claude-opus-4-8', 'claude-sonnet-4'],
      total_models: 2,
    },
    {
      slug: 'openrouter',
      name: 'OpenRouter',
      is_current: false,
      is_user_defined: false,
      models: ['x/y'],
      total_models: 1,
    },
  ],
  model: 'claude-opus-4-8',
  provider: 'anthropic',
}

describe('ModelSection', () => {
  it('shows the current provider + model', () => {
    render(<ModelSection options={OPTIONS} isLoading={false} error={null} onSet={vi.fn()} />)
    // The current model id is shown so the user sees what the agent runs. (It also
    // appears as the active pick in the list, so assert on the header element.)
    expect(screen.getByTestId('studio-model-current')).toHaveTextContent('claude-opus-4-8')
  })

  it('writes the chosen provider + model through onSet', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined)
    render(<ModelSection options={OPTIONS} isLoading={false} error={null} onSet={onSet} />)
    // Pick a model from the second provider and apply it.
    const openrouter = screen.getByTestId('studio-model-provider-openrouter')
    await userEvent.click(within(openrouter).getByRole('button', { name: /x\/y/ }))
    expect(onSet).toHaveBeenCalledWith({ provider: 'openrouter', model: 'x/y' })
  })

  it('marks the active model so the user can see the current selection', () => {
    render(<ModelSection options={OPTIONS} isLoading={false} error={null} onSet={vi.fn()} />)
    const active = screen.getByTestId('studio-model-anthropic-claude-opus-4-8')
    expect(active).toHaveAttribute('aria-pressed', 'true')
  })

  it('surfaces a restart-to-apply note (config applies on next session)', () => {
    render(<ModelSection options={OPTIONS} isLoading={false} error={null} onSet={vi.fn()} />)
    expect(screen.getByText(/restart/i)).toBeInTheDocument()
  })

  it('renders an error state without crashing', () => {
    render(<ModelSection options={undefined} isLoading={false} error="boom" onSet={vi.fn()} />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})

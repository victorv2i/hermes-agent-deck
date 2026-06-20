import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StudioConfigSubset } from '@agent-deck/protocol'
import { AdvancedModelSection } from './AdvancedModelSection'

const CONFIG: StudioConfigSubset = {
  model: 'gpt-5.5',
  model_context_length: 0,
  auxiliary: {
    vision: { provider: 'openrouter', model: 'g/v', base_url: '', timeout: 30 },
  },
  delegation: { model: '', provider: '', base_url: '', max_iterations: 45 },
}

describe('AdvancedModelSection', () => {
  it('renders an error state without crashing', () => {
    render(
      <AdvancedModelSection config={undefined} isLoading={false} error="boom" onSave={vi.fn()} />,
    )
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    render(<AdvancedModelSection config={undefined} isLoading error={null} onSave={vi.fn()} />)
    expect(screen.getByTestId('studio-advanced-skeleton')).toBeInTheDocument()
  })

  it('surfaces a restart-to-apply note (config applies on next session)', () => {
    render(<AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText(/restart your agent to apply/i)).toBeInTheDocument()
  })

  it('NEVER offers an api key or extra-body field (keys live in Env)', () => {
    render(<AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />)
    // No input is labelled as an API key or extra-body; the honest note points to Env.
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByLabelText(/extra.?body/i)).toBeNull()
    expect(screen.getByText(/keys are never set here/i)).toBeInTheDocument()
  })

  describe('context window override (item 1)', () => {
    it('writes the current model id alongside the new context length', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={onSave} />,
      )
      const input = screen.getByTestId('studio-context-length-input')
      await userEvent.type(input, '200000')
      await userEvent.click(screen.getByTestId('studio-context-length-save'))
      expect(onSave).toHaveBeenCalledWith({ model: 'gpt-5.5', model_context_length: 200000 })
    })

    it('keeps Save disabled until the value changes', () => {
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />,
      )
      // current is 0 (auto) → empty field, unchanged → disabled.
      expect(screen.getByTestId('studio-context-length-save')).toBeDisabled()
    })

    it('blocks the context save when no model is set yet', () => {
      render(
        <AdvancedModelSection
          config={{ model: undefined, model_context_length: 0 }}
          isLoading={false}
          error={null}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByText(/set a model first/i)).toBeInTheDocument()
    })
  })

  describe('auxiliary routing (item 2)', () => {
    it('renders the four surfaced tasks', () => {
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />,
      )
      expect(screen.getByTestId('studio-aux-vision')).toBeInTheDocument()
      expect(screen.getByTestId('studio-aux-web_extract')).toBeInTheDocument()
      expect(screen.getByTestId('studio-aux-approval')).toBeInTheDocument()
      expect(screen.getByTestId('studio-aux-compression')).toBeInTheDocument()
    })

    it('pre-fills a task from the config', () => {
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />,
      )
      expect(screen.getByTestId('studio-aux-vision-provider')).toHaveValue('openrouter')
      expect(screen.getByTestId('studio-aux-vision-model')).toHaveValue('g/v')
    })

    it('writes the full task block under auxiliary.<task> when a field changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={onSave} />,
      )
      const row = screen.getByTestId('studio-aux-web_extract')
      await userEvent.type(within(row).getByTestId('studio-aux-web_extract-provider'), 'openai')
      await userEvent.type(within(row).getByTestId('studio-aux-web_extract-model'), 'gpt-x')
      await userEvent.click(within(row).getByTestId('studio-aux-web_extract-save'))
      expect(onSave).toHaveBeenCalledWith({
        auxiliary: { web_extract: { provider: 'openai', model: 'gpt-x', base_url: '' } },
      })
    })

    it('keeps a task Save disabled until something changes', () => {
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={vi.fn()} />,
      )
      // vision row is pre-filled and unchanged → disabled.
      expect(screen.getByTestId('studio-aux-vision-save')).toBeDisabled()
    })

    it('rejects a negative timeout (no write, invalid marked)', async () => {
      const onSave = vi.fn()
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={onSave} />,
      )
      const row = screen.getByTestId('studio-aux-approval')
      const timeout = within(row).getByTestId('studio-aux-approval-timeout')
      await userEvent.type(timeout, '-5')
      expect(within(row).getByTestId('studio-aux-approval-save')).toBeDisabled()
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('delegation routing (item 2)', () => {
    it('writes delegation.* when a field changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={onSave} />,
      )
      const model = screen.getByTestId('studio-delegation-model')
      await userEvent.type(model, 'mini')
      await userEvent.click(screen.getByTestId('studio-delegation-save'))
      expect(onSave).toHaveBeenCalledWith({
        delegation: { provider: '', model: 'mini', base_url: '', max_iterations: 45 },
      })
    })

    it('rejects a non-integer max iterations (no write)', async () => {
      const onSave = vi.fn()
      render(
        <AdvancedModelSection config={CONFIG} isLoading={false} error={null} onSave={onSave} />,
      )
      const maxIter = screen.getByTestId('studio-delegation-max-iterations')
      await userEvent.clear(maxIter)
      await userEvent.type(maxIter, '1.5')
      expect(screen.getByTestId('studio-delegation-save')).toBeDisabled()
      expect(onSave).not.toHaveBeenCalled()
    })
  })
})

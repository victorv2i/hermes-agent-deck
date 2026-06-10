import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ModelsPage } from './ModelsPage'
import type { ModelsResponse } from './types'

const user = userEvent.setup()

function renderPage(props: Parameters<typeof ModelsPage>[0]) {
  return render(
    <ThemeProvider>
      <ModelsPage {...props} />
    </ThemeProvider>,
  )
}

const data: ModelsResponse = {
  activeModelId: 'anthropic/claude-opus-4',
  provider: { id: 'openrouter', label: 'OpenRouter' },
  models: [
    {
      id: 'anthropic/claude-opus-4',
      qualifiedId: 'openrouter/anthropic/claude-opus-4',
      label: 'anthropic/claude-opus-4',
      provider: 'openrouter',
      active: true,
      usable: true,
      source: 'built-in',
    },
    {
      id: 'openai/gpt-5',
      qualifiedId: 'openrouter/openai/gpt-5',
      label: 'openai/gpt-5',
      provider: 'openrouter',
      active: false,
      usable: true,
      source: 'built-in',
    },
    {
      id: 'google/gemini-3-pro',
      qualifiedId: 'google/google/gemini-3-pro',
      label: 'google/gemini-3-pro',
      provider: 'google',
      active: false,
      usable: true,
      source: 'built-in',
    },
  ],
  capabilities: {
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    modelFamily: 'claude',
    autoContextLength: 200000,
    configContextLength: 0,
    effectiveContextLength: 200000,
  },
  auxiliary: [
    { task: 'vision', provider: 'auto', model: '' },
    { task: 'compression', provider: 'openrouter', model: 'openai/gpt-5' },
  ],
  providerStatusUnknown: false,
}

describe('ModelsPage', () => {
  it('renders a heading and the model list', () => {
    renderPage({ status: 'success', data })
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument()
    // Rows are grouped by vendor (the id prefix becomes a section header), so the
    // row label drops the redundant vendor prefix.
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('gemini-3-pro')).toBeInTheDocument()
    expect(screen.getByTestId('model-row-openai/gpt-5')).toBeInTheDocument()
    expect(screen.getByTestId('model-row-google/gemini-3-pro')).toBeInTheDocument()
  })

  it('groups models by vendor with a section label per vendor', () => {
    renderPage({ status: 'success', data })
    expect(screen.getByRole('heading', { name: /anthropic/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /openai/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /google/i })).toBeInTheDocument()
  })

  it('shows the real provider brand mark beside each provider section header', () => {
    renderPage({ status: 'success', data })
    // Each provider section is a labelled region carrying a brand-mark <svg> in
    // its header — the page reads by provider at a glance, not as a flat list.
    for (const vendor of ['anthropic', 'openai', 'google']) {
      const section = screen.getByRole('region', { name: new RegExp(`${vendor} models`, 'i') })
      expect(within(section).getByTestId(`provider-mark-${vendor}`)).toBeInTheDocument()
    }
  })

  it('groups a mixed model list under the correct provider headers', () => {
    const mixed: ModelsResponse = {
      ...data,
      models: [
        { ...data.models[0]! },
        { ...data.models[1]! },
        { ...data.models[2]! },
        {
          id: 'xai/grok-4',
          qualifiedId: 'openrouter/xai/grok-4',
          label: 'xai/grok-4',
          provider: 'openrouter',
          active: false,
          usable: true,
          source: 'built-in',
        },
        {
          id: 'mistral/mistral-large',
          qualifiedId: 'openrouter/mistral/mistral-large',
          label: 'mistral/mistral-large',
          provider: 'openrouter',
          active: false,
          usable: true,
          source: 'built-in',
        },
      ],
    }
    renderPage({ status: 'success', data: mixed })
    const xaiSection = screen.getByRole('region', { name: /xai models/i })
    expect(within(xaiSection).getByText('grok-4')).toBeInTheDocument()
    const mistralSection = screen.getByRole('region', { name: /mistral models/i })
    expect(within(mistralSection).getByText('mistral-large')).toBeInTheDocument()
    // A model lands ONLY under its own provider header (not leaked into another).
    expect(within(xaiSection).queryByText('mistral-large')).not.toBeInTheDocument()
    expect(within(mistralSection).queryByText('grok-4')).not.toBeInTheDocument()
  })

  it('highlights the active model with an Active marker', () => {
    renderPage({ status: 'success', data })
    const activeRow = screen.getByTestId('model-row-anthropic/claude-opus-4')
    // The active row carries an "Active" badge (exact, not the "Active default" sublabel).
    expect(within(activeRow).getByText('Active')).toBeInTheDocument()
    expect(activeRow).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('model-row-openai/gpt-5')).toHaveAttribute('data-active', 'false')
  })

  it('surfaces the active provider in the summary strip', () => {
    renderPage({ status: 'success', data })
    expect(screen.getByText('OpenRouter')).toBeInTheDocument()
  })

  it('surfaces the active model capabilities (vision/tools/reasoning + context window)', () => {
    renderPage({ status: 'success', data })
    // Capability chips for the active model live in the summary strip.
    const caps = screen.getByTestId('model-capabilities')
    expect(within(caps).getByText(/vision/i)).toBeInTheDocument()
    expect(within(caps).getByText(/tools/i)).toBeInTheDocument()
    expect(within(caps).getByText(/reasoning/i)).toBeInTheDocument()
    // The effective context window is surfaced (humanized, e.g. "200K").
    expect(screen.getByText(/200K/i)).toBeInTheDocument()
  })

  it('renders the auxiliary task assignments (hermes signature slots)', () => {
    renderPage({ status: 'success', data })
    const aux = screen.getByTestId('auxiliary-models')
    expect(within(aux).getByRole('heading', { name: /secondary task models/i })).toBeInTheDocument()
    expect(within(aux).getByText(/specific tasks like vision/i)).toBeInTheDocument()
    // Slot names are humanized for display.
    expect(within(aux).getByText('Vision')).toBeInTheDocument()
    expect(within(aux).getByText('Compression')).toBeInTheDocument()
    // A slot that follows the main model reads as "Main model" / auto.
    // (The description also contains "main model", so use getAllByText.)
    expect(within(aux).getAllByText(/main model/i).length).toBeGreaterThanOrEqual(1)
    // A slot with an explicit model shows that model id.
    expect(within(aux).getByText(/gpt-5/i)).toBeInTheDocument()
  })

  it('omits the auxiliary section entirely when there are no slots', () => {
    renderPage({ status: 'success', data: { ...data, auxiliary: [] } })
    expect(screen.queryByTestId('auxiliary-models')).not.toBeInTheDocument()
  })

  it('shows skeletons while loading (no error, no list)', () => {
    renderPage({ status: 'pending' })
    expect(screen.queryByText('openai/gpt-5')).not.toBeInTheDocument()
    expect(screen.getByTestId('models-skeleton')).toBeInTheDocument()
  })

  it('shows a calm error state with a retry affordance', () => {
    let retried = false
    renderPage({ status: 'error', onRetry: () => (retried = true) })
    expect(screen.getByText(/couldn’t load models|couldn't load models/i)).toBeInTheDocument()
    expect(screen.getByText(/agent runtime/i)).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry|try again/i })
    expect(retry).toBeInTheDocument()
    retry.click()
    expect(retried).toBe(true)
  })

  it('shows an empty state when no models are configured', () => {
    renderPage({
      status: 'success',
      data: { ...data, activeModelId: '', models: [] },
    })
    expect(screen.getByText(/no models configured/i)).toBeInTheDocument()
    expect(screen.getByText(/check your agent configuration/i)).toBeInTheDocument()
  })

  it('points the empty state at provider setup when the connect action is available', () => {
    renderPage({
      status: 'success',
      data: { ...data, activeModelId: '', models: [] },
      connect: { status: 'idle', onConnect: () => {} },
    })
    expect(screen.getByText(/use Connect a provider/i)).toBeInTheDocument()
    expect(screen.getByText(/your agent stores provider credentials/i)).toBeInTheDocument()
  })

  it('offers a "Set as active" action on each usable, non-active model and routes the pick', async () => {
    const onSetActive = vi.fn()
    renderPage({ status: 'success', data, setActive: { status: 'idle', onSetActive } })
    // The active model has no action (it is already active).
    const activeRow = screen.getByTestId('model-row-anthropic/claude-opus-4')
    expect(
      within(activeRow).queryByRole('button', { name: /set as active/i }),
    ).not.toBeInTheDocument()
    // A non-active, usable model exposes the action; clicking it routes provider+model.
    const gptRow = screen.getByTestId('model-row-openai/gpt-5')
    const setBtn = within(gptRow).getByRole('button', { name: /set as active/i })
    await user.click(setBtn)
    expect(onSetActive).toHaveBeenCalledWith({ provider: 'openrouter', model: 'openai/gpt-5' })
  })

  it('disables the "Set as active" action for a non-usable model with an honest hint', () => {
    const locked: ModelsResponse = {
      ...data,
      models: [data.models[0]!, { ...data.models[1]!, usable: false }, data.models[2]!],
    }
    renderPage({
      status: 'success',
      data: locked,
      setActive: { status: 'idle', onSetActive: vi.fn() },
    })
    const gptRow = screen.getByTestId('model-row-openai/gpt-5')
    const setBtn = within(gptRow).getByRole('button', { name: /connect openrouter|set as active/i })
    expect(setBtn).toBeDisabled()
    // The reason is conveyed via an accessible name (not title alone), since a
    // disabled button's title tooltip is not reliably exposed to a screen reader.
    expect(setBtn).toHaveAccessibleName(/connect openrouter to use this model/i)
  })

  it('omits the "Set as active" actions entirely when the feature is not wired', () => {
    renderPage({ status: 'success', data })
    expect(screen.queryByRole('button', { name: /set as active/i })).not.toBeInTheDocument()
    expect(screen.getByText(/change the default in your agent configuration/i)).toBeInTheDocument()
  })

  it('marks exactly one model as the default with an Active indicator', () => {
    renderPage({ status: 'success', data })
    // The default/active model is the only one carrying the "Active" marker.
    const active = screen.getAllByText('Active')
    expect(active).toHaveLength(1)
    expect(screen.getByText('Active default')).toBeInTheDocument()
  })

  it('shows the single amber "Connect a provider" action when the feature is wired', () => {
    renderPage({
      status: 'success',
      data,
      connect: { status: 'idle', onConnect: () => {} },
    })
    expect(screen.getByRole('button', { name: /connect a provider/i })).toBeInTheDocument()
  })

  it('omits the connect action when the feature is not provided', () => {
    renderPage({ status: 'success', data })
    expect(screen.queryByRole('button', { name: /connect a provider/i })).not.toBeInTheDocument()
  })

  it('opens the connect dialog from the action and routes a submit to onConnect', async () => {
    const onConnect = vi.fn()
    renderPage({
      status: 'success',
      data,
      connect: { status: 'idle', onConnect },
    })
    await user.click(screen.getByRole('button', { name: /connect a provider/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^provider$/i), 'openrouter')
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-from-page-XYZ')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(onConnect).toHaveBeenCalledWith({ provider: 'openrouter', apiKey: 'sk-from-page-XYZ' })
  })

  it('never echoes a submitted key back, even on success', async () => {
    const onConnect = vi.fn()
    const { rerender } = renderPage({
      status: 'success',
      data,
      connect: { status: 'idle', onConnect },
    })
    await user.click(screen.getByRole('button', { name: /connect a provider/i }))
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-leak-check-9999')
    rerender(
      <ThemeProvider>
        <ModelsPage
          status="success"
          data={data}
          connect={{
            status: 'success',
            result: { provider: 'openrouter', connected: true },
            onConnect,
          }}
        />
      </ThemeProvider>,
    )
    expect(document.body.textContent).not.toContain('sk-leak-check-9999')
  })

  it('warns with a dismissible banner when provider status could not be verified', async () => {
    renderPage({ status: 'success', data: { ...data, providerStatusUnknown: true } })
    const banner = screen.getByTestId('provider-status-unknown')
    expect(
      within(banner).getByText(/couldn’t be verified|could not be verified/i),
    ).toBeInTheDocument()
    expect(within(banner).getByText(/may not actually be usable/i)).toBeInTheDocument()
    // It is dismissible — clicking the dismiss control removes it.
    await user.click(within(banner).getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByTestId('provider-status-unknown')).not.toBeInTheDocument()
  })

  it('does NOT show the provider-status banner when status was verified', () => {
    renderPage({ status: 'success', data: { ...data, providerStatusUnknown: false } })
    expect(screen.queryByTestId('provider-status-unknown')).not.toBeInTheDocument()
  })

  it('exposes the connect action even when there are no models', () => {
    renderPage({
      status: 'success',
      data: { ...data, activeModelId: '', models: [] },
      connect: { status: 'idle', onConnect: () => {} },
    })
    expect(screen.getByText(/no models configured/i)).toBeInTheDocument()
    expect(screen.getByText(/use Connect a provider/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect a provider/i })).toBeInTheDocument()
  })

  describe('model search/filter (long rosters)', () => {
    // A roster long enough that an unfiltered scroll is unusable (e.g. an
    // OpenRouter catalog runs to hundreds) → the search field appears.
    function manyModels(): ModelsResponse {
      const models = Array.from({ length: 12 }, (_, i) => {
        const id = i < 6 ? `openai/gpt-${i}` : `anthropic/claude-${i}`
        const provider = 'openrouter'
        return {
          id,
          qualifiedId: `${provider}/${id}`,
          label: id,
          provider,
          active: i === 0,
          usable: true,
          source: 'built-in',
        }
      })
      return { ...data, models, activeModelId: 'openai/gpt-0' }
    }

    it('shows no search field for a short roster', () => {
      renderPage({ status: 'success', data })
      expect(screen.queryByRole('searchbox', { name: /search models/i })).not.toBeInTheDocument()
    })

    it('filters the roster by query and reports a live count', async () => {
      renderPage({ status: 'success', data: manyModels() })
      const box = screen.getByRole('searchbox', { name: /search models/i })
      expect(box).toBeInTheDocument()
      await user.type(box, 'claude')
      // Anthropic rows survive; OpenAI rows are filtered out.
      expect(screen.getByTestId('model-row-anthropic/claude-7')).toBeInTheDocument()
      expect(screen.queryByTestId('model-row-openai/gpt-2')).not.toBeInTheDocument()
    })

    it('shows an honest no-matches state with a clear affordance', async () => {
      renderPage({ status: 'success', data: manyModels() })
      const box = screen.getByRole('searchbox', { name: /search models/i })
      await user.type(box, 'no-such-model-xyz')
      const noMatches = screen.getByTestId('models-no-matches')
      expect(noMatches).toBeInTheDocument()
      await user.click(within(noMatches).getByRole('button', { name: /clear search/i }))
      // Clearing restores the full roster.
      expect(screen.queryByTestId('models-no-matches')).not.toBeInTheDocument()
      expect(screen.getByTestId('model-row-openai/gpt-2')).toBeInTheDocument()
    })
  })
})

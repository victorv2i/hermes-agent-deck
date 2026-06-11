import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ModelsRoute } from './ModelsRoute'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ModelsRoute />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('ModelsRoute', () => {
  it('loads the BFF payload and renders the active model highlighted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          activeModelId: 'anthropic/claude-opus-4',
          provider: { id: 'openrouter', label: 'OpenRouter' },
          models: [
            {
              id: 'anthropic/claude-opus-4',
              label: 'anthropic/claude-opus-4',
              provider: 'openrouter',
              active: true,
              source: 'built-in',
            },
            {
              id: 'openai/gpt-5',
              label: 'openai/gpt-5',
              provider: 'openrouter',
              active: false,
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
          auxiliary: [{ task: 'vision', provider: 'auto', model: '' }],
        }),
      ),
    )

    renderRoute()
    // Skeleton first.
    expect(screen.getByTestId('models-skeleton')).toBeInTheDocument()

    // Rows are grouped by vendor, so the label drops the redundant prefix.
    await waitFor(() => expect(screen.getByText('gpt-5')).toBeInTheDocument())
    const activeRow = screen.getByTestId('model-row-anthropic/claude-opus-4')
    expect(activeRow).toHaveAttribute('data-active', 'true')
  })

  it('renders the error state when the BFF call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    renderRoute()
    await waitFor(() =>
      expect(screen.getByText(/couldn’t load models|couldn't load models/i)).toBeInTheDocument(),
    )
  })

  it('connects a provider via the live setup route and never echoes the key', async () => {
    const user = userEvent.setup()
    const modelsBody = {
      activeModelId: 'a/b',
      provider: { id: 'openrouter', label: 'OpenRouter' },
      models: [
        { id: 'a/b', label: 'a/b', provider: 'openrouter', active: true, source: 'built-in' },
      ],
      capabilities: { supportsTools: true },
      auxiliary: [],
    }
    let modelsReads = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/setup/provider-key')) {
        // The request body must carry the key; the response NEVER does.
        expect(JSON.parse(init!.body as string)).toEqual({
          provider: 'openrouter',
          apiKey: 'sk-route-secret-7777',
        })
        return Response.json({ provider: 'openrouter', connected: true })
      }
      modelsReads += 1
      return Response.json(modelsBody)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByRole('button', { name: /connect a provider/i })))
    const readsBeforeConnect = modelsReads

    await user.click(screen.getByRole('button', { name: /connect a provider/i }))
    await user.type(screen.getByLabelText(/^provider$/i), 'openrouter')
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-route-secret-7777')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    // Honest success surfaces; the key is nowhere in the DOM.
    await waitFor(() => expect(screen.getByText(/^connected$/i)).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('sk-route-secret-7777')

    // The roster was re-checked (models query invalidated → at least one more read).
    await waitFor(() => expect(modelsReads).toBeGreaterThan(readsBeforeConnect))
  })

  it('sets a non-active model as active via /model/set and re-checks the roster', async () => {
    const user = userEvent.setup()
    const initial = {
      activeModelId: 'opus',
      provider: { id: 'anthropic', label: 'Anthropic' },
      models: [
        { id: 'opus', label: 'opus', provider: 'anthropic', active: true, usable: true },
        { id: 'sonnet', label: 'sonnet', provider: 'anthropic', active: false, usable: true },
      ],
      capabilities: {},
      auxiliary: [],
    }
    let setCalls = 0
    let modelsReads = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/model/set')) {
        setCalls += 1
        // The REAL switch carries the provider + the bare model id.
        expect(init?.method).toBe('POST')
        expect(JSON.parse(init!.body as string)).toEqual({ provider: 'anthropic', model: 'sonnet' })
        return Response.json({ ok: true })
      }
      modelsReads += 1
      return Response.json(initial)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByTestId('model-row-sonnet')).toBeInTheDocument())
    const readsBefore = modelsReads

    const sonnetRow = screen.getByTestId('model-row-sonnet')
    await user.click(within(sonnetRow).getByRole('button', { name: /set as active/i }))

    await waitFor(() => expect(setCalls).toBe(1))
    // The roster is re-checked so the active flag reflects the pick (no stale state).
    await waitFor(() => expect(modelsReads).toBeGreaterThan(readsBefore))
  })

  it('surfaces the expensive-model confirm and only switches on "Switch anyway"', async () => {
    const { toast } = await import('@/lib/toast')
    vi.mocked(toast.success).mockClear()
    const user = userEvent.setup()
    const initial = {
      activeModelId: 'opus',
      provider: { id: 'anthropic', label: 'Anthropic' },
      models: [
        { id: 'opus', label: 'opus', provider: 'anthropic', active: true, usable: true },
        { id: 'sonnet', label: 'sonnet', provider: 'anthropic', active: false, usable: true },
      ],
      capabilities: {},
      auxiliary: [],
    }
    const setBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/model/set')) {
        const body = JSON.parse(init!.body as string) as Record<string, unknown>
        setBodies.push(body)
        // The gateway's expensive-model guard: a 200 that did NOT switch.
        if (body.confirmExpensiveModel !== true) {
          return Response.json({
            ok: false,
            confirm_required: true,
            confirm_message: 'sonnet costs $25/M input tokens. Confirm to switch.',
          })
        }
        return Response.json({ ok: true })
      }
      return Response.json(initial)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByTestId('model-row-sonnet')).toBeInTheDocument())
    const sonnetRow = screen.getByTestId('model-row-sonnet')
    await user.click(within(sonnetRow).getByRole('button', { name: /set as active/i }))

    // The guard's own message surfaces in the confirm dialog; no fake success.
    expect(await screen.findByText(/costs \$25\/M input tokens/i)).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()

    // Only the explicit "Switch anyway" re-posts with the confirm flag.
    await user.click(screen.getByRole('button', { name: /switch anyway/i }))
    await waitFor(() => expect(setBodies).toHaveLength(2))
    expect(setBodies[0]).toEqual({ provider: 'anthropic', model: 'sonnet' })
    expect(setBodies[1]).toEqual({
      provider: 'anthropic',
      model: 'sonnet',
      confirmExpensiveModel: true,
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Switched to sonnet'))
  })

  it('declining the expensive-model confirm makes no switch and claims none', async () => {
    const { toast } = await import('@/lib/toast')
    vi.mocked(toast.success).mockClear()
    const user = userEvent.setup()
    const initial = {
      activeModelId: 'opus',
      provider: { id: 'anthropic', label: 'Anthropic' },
      models: [
        { id: 'opus', label: 'opus', provider: 'anthropic', active: true, usable: true },
        { id: 'sonnet', label: 'sonnet', provider: 'anthropic', active: false, usable: true },
      ],
      capabilities: {},
      auxiliary: [],
    }
    let setCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/model/set')) {
        setCalls += 1
        return Response.json({
          ok: false,
          confirm_required: true,
          confirm_message: 'sonnet costs $25/M input tokens. Confirm to switch.',
        })
      }
      return Response.json(initial)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByTestId('model-row-sonnet')).toBeInTheDocument())
    const sonnetRow = screen.getByTestId('model-row-sonnet')
    await user.click(within(sonnetRow).getByRole('button', { name: /set as active/i }))
    expect(await screen.findByText(/costs \$25\/M input tokens/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() =>
      expect(screen.queryByText(/costs \$25\/M input tokens/i)).not.toBeInTheDocument(),
    )
    // No confirmed re-POST, no success claim: the active model truthfully stands.
    expect(setCalls).toBe(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('model-row-opus')).toHaveAttribute('data-active', 'true')
  })

  it('surfaces an honest toast (no silent no-op) when /model/set is rejected', async () => {
    const { toast } = await import('@/lib/toast')
    const user = userEvent.setup()
    const initial = {
      activeModelId: 'opus',
      provider: { id: 'anthropic', label: 'Anthropic' },
      models: [
        { id: 'opus', label: 'opus', provider: 'anthropic', active: true, usable: true },
        { id: 'sonnet', label: 'sonnet', provider: 'anthropic', active: false, usable: true },
      ],
      capabilities: {},
      auxiliary: [],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/model/set')) {
        return new Response(
          JSON.stringify({ error: 'Unable to switch the model on the hermes dashboard.' }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        )
      }
      return Response.json(initial)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByTestId('model-row-sonnet')).toBeInTheDocument())
    const sonnetRow = screen.getByTestId('model-row-sonnet')
    await user.click(within(sonnetRow).getByRole('button', { name: /set as active/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Couldn’t switch the model',
        expect.objectContaining({ description: expect.stringMatching(/unable to switch/i) }),
      ),
    )
  })

  it('refreshes the roster after a browser OAuth sign-in completes (fixes the stale-roster bug)', async () => {
    const user = userEvent.setup()
    const modelsBody = {
      activeModelId: 'nous/hermes',
      provider: { id: 'nous', label: 'Nous Portal' },
      models: [{ id: 'hermes', label: 'hermes', provider: 'nous', active: true, usable: true }],
      capabilities: {},
      auxiliary: [],
    }
    let modelsReads = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/provider-oauth/nous/start')) {
        // Hermes immediately reports the session connected.
        return Response.json({ status: 'connected', provider: 'nous' })
      }
      if (typeof url === 'string' && url.endsWith('/provider-oauth')) {
        // The live oauth-capable list (used to drive the dialog's oauth set).
        return Response.json({ providers: [{ id: 'nous', status: { logged_in: true } }] })
      }
      modelsReads += 1
      return Response.json(modelsBody)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByRole('button', { name: /connect a provider/i })))
    const readsBefore = modelsReads

    await user.click(screen.getByRole('button', { name: /connect a provider/i }))
    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))

    // Sign-in completion invalidates the roster AND triggers the usable-model
    // re-probe — both re-read models, so the count climbs past the baseline.
    await waitFor(() => expect(modelsReads).toBeGreaterThan(readsBefore))
    expect(
      await screen.findByText(/sign-in completed|reporting a usable model/i),
    ).toBeInTheDocument()
  })

  it('shows an honest failure (no fake success) when the add is rejected', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/setup/provider-key')) {
        return new Response(JSON.stringify({ message: 'Hermes could not add the credential.' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        })
      }
      return Response.json({
        activeModelId: '',
        provider: { id: 'unknown', label: 'unknown' },
        models: [],
        capabilities: {},
        auxiliary: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await waitFor(() => expect(screen.getByRole('button', { name: /connect a provider/i })))
    await user.click(screen.getByRole('button', { name: /connect a provider/i }))
    await user.type(screen.getByLabelText(/^provider$/i), 'openrouter')
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-bad')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() =>
      expect(screen.getByText(/could not add the credential/i)).toBeInTheDocument(),
    )
    // No fake "Connected" verdict on failure.
    expect(screen.queryByText(/^connected$/i)).not.toBeInTheDocument()
  })
})

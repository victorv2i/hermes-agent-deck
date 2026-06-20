import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ConnectProviderDialog } from './ConnectProviderDialog'

function renderDialog(props: Partial<Parameters<typeof ConnectProviderDialog>[0]> = {}) {
  const onConnect = props.onConnect ?? vi.fn()
  const onOpenChange = props.onOpenChange ?? vi.fn()
  render(
    <ThemeProvider>
      <ConnectProviderDialog
        open
        status="idle"
        onConnect={onConnect}
        onOpenChange={onOpenChange}
        {...props}
      />
    </ThemeProvider>,
  )
  return { onConnect, onOpenChange }
}

describe('ConnectProviderDialog', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders a common provider catalog instead of a raw slug-first flow', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // A radio's accessible name concatenates its label + badge + description, so
    // matchers must disambiguate where one name is a substring of another (e.g.
    // "OpenAI" vs "OpenAI (Codex)"). The default selection is an API-key provider
    // (OpenRouter), so the API-key form is the one shown initially.
    for (const name of [
      /Nous Portal/i,
      /Anthropic/i,
      /OpenRouter/i,
      /Use an OpenAI API key for GPT models/i,
      /OpenAI \(Codex\)/i,
      /Qwen/i,
      /MiniMax/i,
      /Google AI Studio/i,
      /xAI/i,
      /Custom \/ other/i,
    ]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getByLabelText(/^api key$/i)).toHaveAttribute('type', 'password')
  })

  it('exposes the provider catalog as a single-tab-stop radiogroup with arrow-key selection', async () => {
    const user = userEvent.setup()
    renderDialog()
    const group = screen.getByRole('radiogroup')
    const radios = within(group).getAllByRole('radio')
    // Roving tabindex: exactly one option (the checked one) is in the tab order.
    const tabbable = radios.filter((r) => r.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAttribute('aria-checked', 'true')
    // The default selection is OpenRouter; ArrowRight moves selection to the next option.
    const openRouter = screen.getByRole('radio', { name: /openrouter/i })
    expect(openRouter).toHaveAttribute('aria-checked', 'true')
    openRouter.focus()
    await user.keyboard('{ArrowRight}')
    // Selection (and the single tab stop) moved off OpenRouter to a different option.
    expect(openRouter).toHaveAttribute('aria-checked', 'false')
    expect(openRouter).toHaveAttribute('tabindex', '-1')
    const nowChecked = within(group)
      .getAllByRole('radio')
      .find((r) => r.getAttribute('aria-checked') === 'true')
    expect(nowChecked).toBeDefined()
    expect(nowChecked).toHaveAttribute('tabindex', '0')
  })

  it('ties the API key input to its storage note via aria-describedby', () => {
    renderDialog()
    const key = screen.getByLabelText(/^api key$/i)
    const describedBy = key.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const note = document.getElementById(describedBy!)
    expect(note?.textContent).toMatch(/sent to hermes for credential storage/i)
  })

  it('submits an API key for the selected catalog provider without requiring a typed slug', async () => {
    const user = userEvent.setup()
    const { onConnect } = renderDialog()
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-secret-123')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(onConnect).toHaveBeenCalledWith({ provider: 'openrouter', apiKey: 'sk-secret-123' })
  })

  it('uses Hermes gemini provider id for Google AI Studio API keys', async () => {
    const user = userEvent.setup()
    const { onConnect } = renderDialog()
    await user.click(screen.getByRole('radio', { name: /google ai studio/i }))
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-google-123')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(onConnect).toHaveBeenCalledWith({ provider: 'gemini', apiKey: 'sk-google-123' })
  })

  it('Nous Portal tile includes plain-language context (INFO-ACC-4): what it is with a real portal link', async () => {
    // "Nous Portal" as a bare name with no explanation is a honesty issue — a
    // user unfamiliar with NousResearch won't know what it is. The description
    // must explain what it is (free, NousResearch) and the OAuth launcher must
    // show the real provider URL (portal.nousresearch.com) so users can create an
    // account. Without the link, the flow "points nowhere" for new users.
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    // The OAuth launcher must show a real provider URL link.
    const link = screen.getByTestId('provider-docs-link')
    expect(link).toHaveAttribute('href', 'https://portal.nousresearch.com')
    expect(link).toHaveAttribute('target', '_blank')
    // The tile description or page text should explain what Nous Portal is.
    const bodyText = document.body.textContent?.toLowerCase() ?? ''
    expect(
      bodyText.includes('nousresearch') ||
        bodyText.includes('free') ||
        bodyText.includes('free account'),
    ).toBe(true)
  })

  it('keeps the advanced custom provider slug path available', async () => {
    const user = userEvent.setup()
    const { onConnect } = renderDialog()
    await user.click(screen.getByRole('radio', { name: /custom \/ other/i }))
    await user.type(screen.getByLabelText(/^provider$/i), 'my-provider')
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-custom-123')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(onConnect).toHaveBeenCalledWith({ provider: 'my-provider', apiKey: 'sk-custom-123' })
  })

  it('can reveal then re-hide the api key without rendering it as text elsewhere', async () => {
    const user = userEvent.setup()
    renderDialog()
    const key = screen.getByLabelText(/^api key$/i)
    await user.type(key, 'sk-secret-123')
    expect(key).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: /show api key/i }))
    expect(key).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: /hide api key/i }))
    expect(key).toHaveAttribute('type', 'password')
    expect(document.body.textContent).not.toContain('sk-secret-123')
  })

  it('shows a busy submit while submitting and disables the field', () => {
    renderDialog({ status: 'submitting' })
    const connect = screen.getByRole('button', { name: /connecting|connect/i })
    expect(connect).toBeDisabled()
    expect(screen.getByLabelText(/^api key$/i)).toBeDisabled()
  })

  it('renders an honest success that NEVER echoes the key back', () => {
    renderDialog({
      status: 'success',
      result: { provider: 'openrouter', connected: true },
      submittedKey: 'sk-super-secret-XYZ',
    })
    expect(screen.getByText(/^connected$/i)).toBeInTheDocument()
    expect(screen.getByText(/openrouter/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sk-super-secret-XYZ')
  })

  it('is honest when the add succeeded but no usable model is reported yet', () => {
    renderDialog({
      status: 'success',
      result: { provider: 'openrouter', connected: false },
    })
    expect(screen.getByText(/no usable model|not reporting|may need/i)).toBeInTheDocument()
  })

  it('surfaces an honest failure without echoing the key', () => {
    renderDialog({
      status: 'error',
      error: 'Hermes could not add the credential.',
      submittedKey: 'sk-super-secret-XYZ',
    })
    expect(screen.getByText(/could not add the credential/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sk-super-secret-XYZ')
  })

  it('uses a browser launcher for Hermes-owned OAuth and removes the old terminal-only copy', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () =>
      Response.json({
        url: 'https://portal.example/start',
        session_id: 'sess-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://portal.example/device',
        poll_interval_ms: 60000,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    const launcher = screen.getByTestId('oauth-browser-launcher')
    expect(within(launcher).getByText(/agentdeck launches hermes-owned oauth/i)).toBeInTheDocument()
    expect(within(launcher).getByText(/api-key fallback/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/oauth.*can.?t be driven from here/i)
    expect(document.body.textContent).not.toContain('hermes setup --portal')

    await user.click(within(launcher).getByRole('button', { name: /launch browser sign-in/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent-deck/provider-oauth/nous/start',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(window.open).toHaveBeenCalledWith(
      'https://portal.example/start',
      '_blank',
      'noopener,noreferrer',
    )
    expect(await within(launcher).findByText('ABCD-EFGH')).toBeInTheDocument()
    expect(within(launcher).getByText(/if no new tab opened/i)).toBeInTheDocument()
    expect(within(launcher).getByText('https://portal.example/device')).toBeInTheDocument()
    expect(within(launcher).getByRole('button', { name: /cancel sign-in/i })).toBeEnabled()
  })

  it('explains offline or blocked OAuth without turning terminal into the primary path', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))

    expect(await screen.findByText(/could not reach Hermes provider sign-in/i)).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByText(/use a terminal only/i)).toBeInTheDocument()
  })

  it('polls a returned OAuth session id and reports completion', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/start')) {
        return Response.json({
          sessionId: 'sess-2',
          userCode: 'WXYZ-1234',
          pollIntervalMs: 1000,
        })
      }
      if (url.endsWith('/poll/sess-2')) {
        return Response.json({ sessionId: 'sess-2', status: 'connected' })
      }
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))
    expect(await screen.findByText('WXYZ-1234')).toBeInTheDocument()

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/agent-deck/provider-oauth/nous/poll/sess-2',
          expect.any(Object),
        ),
      { timeout: 2500 },
    )
    expect(await screen.findByText(/sign-in completed/i)).toBeInTheDocument()
  })

  it('offers browser sign-in for Anthropic (now an oauth+api-key provider, oauth default)', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('radio', { name: /Anthropic/i }))
    // Anthropic now defaults to the OAuth launcher (the verified-live browser path).
    expect(screen.getByTestId('oauth-browser-launcher')).toBeInTheDocument()
    // The method switch is present because Anthropic supports BOTH paths.
    expect(screen.getByRole('radiogroup', { name: /connection method/i })).toBeInTheDocument()
  })

  it('drives the oauth-capable set from the live provider-oauth list (catalog can’t hide it)', async () => {
    const user = userEvent.setup()
    // xAI is api-key ONLY in the static catalog, but the LIVE Hermes list reports
    // it as oauth-capable — the dialog must OFFER the browser path (the method
    // switch) and reveal the launcher when the user picks it.
    renderDialog({ oauthProviders: new Set(['xai']) })
    await user.click(screen.getByRole('radio', { name: /xAI/i }))
    // The method switch surfaces because the live list made xAI oauth-capable.
    const methodGroup = screen.getByRole('radiogroup', { name: /connection method/i })
    await user.click(within(methodGroup).getByRole('radio', { name: /browser sign-in/i }))
    expect(screen.getByTestId('oauth-browser-launcher')).toBeInTheDocument()
  })

  it('fires onOAuthConnected and re-probes a usable model after sign-in completes', async () => {
    const user = userEvent.setup()
    const onOAuthConnected = vi.fn()
    const probeOAuthModel = vi.fn(async () => true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'connected' })),
    )
    renderDialog({ onOAuthConnected, probeOAuthModel })

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))

    // The route is notified so it can refresh the roster (fixes the stale roster).
    await waitFor(() => expect(onOAuthConnected).toHaveBeenCalledWith('nous'))
    // The honest verdict comes from the re-probe, not from logged_in alone.
    await waitFor(() => expect(probeOAuthModel).toHaveBeenCalledWith('nous'))
    expect(await screen.findByText(/reporting a usable model/i)).toBeInTheDocument()
  })

  it('is honest after OAuth when sign-in completes but NO usable model is reported yet', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'connected' })),
    )
    renderDialog({ probeOAuthModel: vi.fn(async () => false) })

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))

    expect(await screen.findByText(/no usable model is reporting yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/reporting a usable model\./i)).not.toBeInTheDocument()
  })

  it('cancels an OAuth session through the BFF when a session id exists', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/start')) return Response.json({ session_id: 'sess-3' })
      if (url.endsWith('/sessions/sess-3')) return Response.json({ ok: true })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /nous portal/i }))
    await user.click(screen.getByRole('button', { name: /launch browser sign-in/i }))
    await user.click(await screen.findByRole('button', { name: /cancel sign-in/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent-deck/provider-oauth/sessions/sess-3',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
    expect(screen.getByText(/sign-in was cancelled/i)).toBeInTheDocument()
  })
})

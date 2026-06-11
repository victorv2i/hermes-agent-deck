import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { AppShell } from '@/components/layout/AppShell'
import { ChatRoute } from './ChatRoute'
import { useChatStore } from '@/state/useChatStore'
import { useHeaderStore } from '@/state/headerStore'
import { initialChatState } from '@/state/chatStore'
import type { ChatOutletContext } from '@/app/navigation'
import type { SetModelResult } from '@/features/models/api'

// Keep the surface hermetic: stub the models query so the header's active-model
// label is deterministic and no fetch is attempted. `useSetModel` is stubbed so
// a cross-provider pick's /model/set call is observable without a real fetch.
// It resolves the honest SetModelResult shape; a test can resolve
// `confirm-required` to simulate the gateway's expensive-model guard.
const mockUseModels = vi.fn()
const mockSetModelMutateAsync = vi.fn<(vars?: unknown) => Promise<SetModelResult>>(async () => ({
  status: 'switched',
}))
vi.mock('@/features/models/useModels', () => ({
  useModels: () => mockUseModels(),
  useSetModel: () => ({ mutateAsync: mockSetModelMutateAsync, isPending: false }),
}))

// Stub the profiles roster so the chat surface threads a deterministic active
// agent (face + name) into the header without a BFF read. Each test sets the
// active agent via `mockUseProfiles.mockReturnValue(...)`.
const mockUseProfiles = vi.fn()
vi.mock('@/features/profiles/useProfiles', () => ({
  useProfiles: () => mockUseProfiles(),
  profileKeys: { all: ['profiles'] as const },
}))

// Stub the deck-own /health probe that gates the unreachable notice's one-click
// recovery: resolving with reachable:false = deck server up + agent down (the
// button can land); rejecting = the deck server itself is down (no button). The
// default rejection mirrors "no BFF in jsdom" for all unrelated tests.
const mockFetchHealth = vi.fn<() => Promise<unknown>>(async () => {
  throw new Error('no BFF in jsdom')
})
vi.mock('@/lib/api', () => ({
  fetchHealth: () => mockFetchHealth(),
  homeHealthKey: ['agent-deck', 'home', 'health'] as const,
  chatHealthKey: ['agent-deck', 'chat', 'health'] as const,
}))

function renderChatRoute(
  over?: Partial<ChatOutletContext>,
  /** Seed react-router location.state (the Home → Chat first-run hand-off). */
  locationState?: unknown,
) {
  const context: ChatOutletContext = {
    send: () => {},
    stop: () => {},
    respondApproval: () => {},
    retry: () => {},
    editTurn: () => {},
    connection: 'connected',
    newChat: () => {},
    clearChat: () => {},
    openPalette: () => {},
    ...over,
  }
  // Mount ChatRoute inside the AppShell so the header slot it projects is
  // observable in the shell's header (the real composition).
  function Layout() {
    return (
      <AppShell connection="online">
        <Outlet context={context} />
      </AppShell>
    )
  }
  const routes: RouteObject[] = [
    { path: '/', element: <Layout />, children: [{ index: true, element: <ChatRoute /> }] },
  ]
  const router = createMemoryRouter(routes, {
    initialEntries: [{ pathname: '/', state: locationState }],
  })
  // The AppShell's rail mounts SessionList (useSessions); supply a QueryClient.
  // No BFF in jsdom → those queries stay empty, which is fine for header asserts.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

/** A roster with one named active agent (the chat surface threads its identity). */
function profilesWith(active: { name: string; isDefault?: boolean; avatar?: string | null }) {
  return {
    data: {
      active: active.name,
      profiles: [
        {
          name: active.name,
          path: `/p/${active.name}`,
          isDefault: active.isDefault ?? false,
          isActive: true,
          model: 'claude-opus-4',
          provider: 'anthropic',
          hasEnv: false,
          skillCount: 0,
          gatewayRunning: true,
          avatar: active.avatar ?? null,
        },
      ],
    },
    loading: false,
    error: null,
    refetch: async () => {},
  }
}

describe('ChatRoute — live header (T1.3)', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockSetModelMutateAsync.mockReset()
    mockSetModelMutateAsync.mockResolvedValue({ status: 'switched' })
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    mockUseModels.mockReturnValue({
      data: {
        activeModelId: 'claude-opus-4',
        provider: { id: 'anthropic', label: 'Anthropic' },
        models: [
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
        ],
      },
    })
  })

  it('projects a "New chat" header with the active model for a fresh chat', () => {
    renderChatRoute()
    const slot = screen.getByTestId('header-slot')
    expect(slot).toHaveTextContent('New chat')
    // Model label reads the active model (shortened, provider stripped).
    expect(screen.getByTestId('chat-header-model')).toHaveTextContent('claude-opus-4')
  })

  it('threads the active agent face + friendly name into the header (A1)', () => {
    renderChatRoute()
    const header = screen.getByTestId('chat-header')
    // The friendly name appears BEFORE the title in the header.
    const name = within(header).getByTestId('chat-header-agent-name')
    expect(name).toHaveTextContent('Sol')
    // A face rides alongside it (the governed Avatar primitive — a decorative <img>).
    const face = within(header).getByTestId('chat-header-avatar')
    const img = face.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/avatars/v2.webp')
  })

  it('shows no header identity name for the unnamed default agent (honest fallback)', () => {
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'default', isDefault: true }))
    renderChatRoute()
    const header = screen.getByTestId('chat-header')
    expect(within(header).queryByTestId('chat-header-agent-name')).not.toBeInTheDocument()
    // Still falls back gracefully to the title.
    expect(header).toHaveTextContent('New chat')
  })

  it('carries the resumed session title + model into the header (Continue identity)', () => {
    // Simulate a "Continue" having seeded the prior session's identity.
    useChatStore.setState({
      ...initialChatState,
      sessionTitle: 'Refactor the auth flow',
      sessionModel: 'gpt-5.5',
      turns: [{ id: 'u1', role: 'user', content: 'where were we?' }],
    })
    renderChatRoute()
    const slot = screen.getByTestId('header-slot')
    expect(slot).toHaveTextContent('Refactor the auth flow')
    // The resumed session's own model wins over the globally-active one.
    expect(screen.getByTestId('chat-header-model')).toHaveTextContent('gpt-5.5')
    expect(slot).not.toHaveTextContent('New chat')
  })

  it('mounts the composer model picker defaulting to the active model (T1.2)', () => {
    renderChatRoute()
    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('Claude Opus 4')
  })

  it('switches the provider (POST /model/set) before the run when a cross-provider model is picked', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    // Persist a cross-provider pick (openai gpt-5.5 while anthropic is active) so
    // the composer resolves it on mount.
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    renderChatRoute({ send })

    // The composer footer composer is the floating one; type + send.
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hello')
    await user.keyboard('{Enter}')

    // The REAL switch fires first (provider + bare model id), then the run carries
    // the bare id — never a silent no-op on a cross-provider pick.
    await waitFor(() =>
      expect(mockSetModelMutateAsync).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-5.5',
      }),
    )
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello', 'gpt-5.5', undefined))
  })

  it('does NOT switch when the picked model IS the active (provider, model) pair', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    // The active model (anthropic) is the default selection — same pair.
    renderChatRoute({ send })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hi')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(send).toHaveBeenCalledWith('hi', 'claude-opus-4', undefined))
    // No needless /model/set when the active pair is unchanged.
    expect(mockSetModelMutateAsync).not.toHaveBeenCalled()
  })

  it('switches (POST /model/set) for a SAME-provider model change — never a silent no-op', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    // Two models under the active provider: picking the inactive one must still
    // hit /model/set (the run's body.model alone is cosmetic to the gateway).
    mockUseModels.mockReturnValue({
      data: {
        activeModelId: 'claude-opus-4',
        provider: { id: 'anthropic', label: 'Anthropic' },
        models: [
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
            id: 'claude-sonnet-4',
            qualifiedId: 'anthropic/claude-sonnet-4',
            label: 'Claude Sonnet 4',
            provider: 'anthropic',
            active: false,
            usable: true,
            source: 'config',
          },
        ],
      },
    })
    localStorage.setItem('agent-deck:selected-model', 'anthropic/claude-sonnet-4')
    renderChatRoute({ send })

    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hello')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(mockSetModelMutateAsync).toHaveBeenCalledWith({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      }),
    )
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello', 'claude-sonnet-4', undefined))
  })

  it('still sends when the model switch FAILS (gateway/dashboard unreachable) instead of blocking the chat', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    // The model service is down (network error, not a confirm). Only the
    // gateway's explicit confirm_required may hold a run; any other switch
    // failure degrades to an honest toast and the message still goes out.
    mockSetModelMutateAsync.mockRejectedValueOnce(new Error('fetch failed'))
    renderChatRoute({ send })

    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hello')
    await user.keyboard('{Enter}')

    // The run proceeds on the picked model; the gateway falls back to its
    // active model if the switch truly did not land. Never a dead send.
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello', 'gpt-5.5', undefined))
    // No confirm dialog for a non-confirm failure.
    expect(screen.queryByRole('button', { name: /switch anyway/i })).not.toBeInTheDocument()
  })

  it('holds the run behind the expensive-model confirm and switches only on "Switch anyway"', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    // The gateway's expensive-model guard declines the first POST (a 200 that
    // did NOT switch), then the confirmed re-POST goes through.
    mockSetModelMutateAsync
      .mockResolvedValueOnce({
        status: 'confirm-required',
        confirmMessage: 'gpt-5.5 costs $30/M input tokens. Confirm to switch.',
      })
      .mockResolvedValueOnce({ status: 'switched' })
    renderChatRoute({ send })

    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hello')
    await user.keyboard('{Enter}')

    // The guard's own warning surfaces; the run is HELD (nothing sent yet,
    // because the picked model is not actually set).
    expect(await screen.findByText(/costs \$30\/M input tokens/i)).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()

    // Only the explicit "Switch anyway" re-posts with the confirm flag, and the
    // held run then proceeds on the confirmed model.
    await user.click(screen.getByRole('button', { name: /switch anyway/i }))
    await waitFor(() =>
      expect(mockSetModelMutateAsync).toHaveBeenLastCalledWith({
        provider: 'openai',
        model: 'gpt-5.5',
        confirmExpensiveModel: true,
      }),
    )
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello', 'gpt-5.5', undefined))
  })

  it('declining the expensive-model confirm reverts the picker and runs on the ACTIVE model', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    mockSetModelMutateAsync.mockResolvedValue({
      status: 'confirm-required',
      confirmMessage: 'gpt-5.5 costs $30/M input tokens. Confirm to switch.',
    })
    renderChatRoute({ send })

    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    await user.type(textarea, 'hello')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/costs \$30\/M input tokens/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    // No confirmed re-POST (one declined attempt only) and the held run carries
    // the gateway's ACTUAL active model — never the model that was not set.
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello', 'claude-opus-4', undefined))
    expect(mockSetModelMutateAsync).toHaveBeenCalledTimes(1)
    // The picker reverts to the active model so the UI never claims a phantom pick.
    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('Claude Opus 4')
  })

  it('reports context tokens honestly in the header ring (no false %)', () => {
    useChatStore.setState({
      ...initialChatState,
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'hello',
          toolCalls: [],
          reasoning: [],
          streaming: false,
          usage: { input_tokens: 9000, output_tokens: 3500, total_tokens: 12_500 },
        },
      ],
    })
    renderChatRoute()
    // The header ring (the composer footer renders one too — scope to the header).
    const ring = within(screen.getByTestId('header-slot')).getByTestId('context-ring')
    expect(ring).toHaveAttribute('data-approx', 'true')
    expect(ring.getAttribute('aria-label')).toMatch(/12\.5K tokens.*approx/i)
  })
})

// --- Header context-ring real-limit gating ------------------------------------
// The route derives `contextLimit` from the models query's capabilities, which
// describe the gateway's ACTIVE model only. The real limit (fraction mode) is
// supplied just when this conversation targets that model; any mismatch keeps
// the ring honest in approximate mode. A resumed session's own model takes
// precedence over the composer's selected entry.
describe('ChatRoute header context-ring limit (active-model gating)', () => {
  /** Seed a transcript whose latest assistant turn carries token usage so the
   * header ring renders (it returns null at 0 tokens). */
  function seedUsageTurns() {
    useChatStore.setState({
      ...useChatStore.getState(),
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'hello',
          toolCalls: [],
          reasoning: [],
          streaming: false,
          usage: { input_tokens: 9000, output_tokens: 3500, total_tokens: 12_500 },
        },
      ],
    })
  }

  /** The standard models payload plus the active model's capabilities. */
  function modelsWithCapabilities() {
    return {
      data: {
        activeModelId: 'claude-opus-4',
        provider: { id: 'anthropic', label: 'Anthropic' },
        capabilities: {
          supportsVision: false,
          // effectiveContextLength must be preferred over contextWindow.
          effectiveContextLength: 100_000,
          contextWindow: 200_000,
        },
        models: [
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
        ],
      },
    }
  }

  function headerRing() {
    return within(screen.getByTestId('header-slot')).getByTestId('context-ring')
  }

  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockSetModelMutateAsync.mockReset()
    mockSetModelMutateAsync.mockResolvedValue({ status: 'switched' })
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    mockUseModels.mockReturnValue(modelsWithCapabilities())
    seedUsageTurns()
  })

  it('conversation on the active model → the ring gets the REAL limit (fraction mode), preferring effectiveContextLength', () => {
    // Fresh chat: no sessionModel, the picker defaults to the active model.
    renderChatRoute()
    const ring = headerRing()
    expect(ring).toHaveAttribute('data-approx', 'false')
    // 12.5K of the EFFECTIVE 100K (not the raw 200K contextWindow).
    expect(ring.getAttribute('aria-label')).toMatch(/% of memory used/i)
    expect(ring.getAttribute('aria-label')).toMatch(/of 100K tokens/)
    expect(ring.getAttribute('aria-label')).not.toMatch(/200K/)
  })

  it('conversation targeting a DIFFERENT model → no limit (honest approximate mode)', () => {
    // The composer's selected model is not the gateway's active model, so the
    // capabilities describe another model's window: never divide by it.
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    renderChatRoute()
    const ring = headerRing()
    expect(ring).toHaveAttribute('data-approx', 'true')
    expect(ring.getAttribute('aria-label')).toMatch(/approx/i)
    expect(ring.getAttribute('aria-label')).not.toMatch(/% of memory used/i)
  })

  it('a resumed session model takes precedence over the selected entry', () => {
    // The picker holds a MISMATCHING selection, but the resumed session itself
    // ran on the active model: the session's own model wins, so the real limit
    // still applies. (If the selected entry won, this would be approximate.)
    localStorage.setItem('agent-deck:selected-model', 'openai/gpt-5.5')
    useChatStore.setState({ ...useChatStore.getState(), sessionModel: 'claude-opus-4' })
    renderChatRoute()
    const ring = headerRing()
    expect(ring).toHaveAttribute('data-approx', 'false')
    expect(ring.getAttribute('aria-label')).toMatch(/of 100K tokens/)
  })
})

describe('ChatRoute — first-run hand-off from Home (SW3)', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockSetModelMutateAsync.mockReset()
    mockSetModelMutateAsync.mockResolvedValue({ status: 'switched' })
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    mockUseModels.mockReturnValue({ data: undefined })
  })

  it('seeds a starter prompt from location.state.draft into the composer', () => {
    renderChatRoute(undefined, { draft: 'summarize this repository' })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveValue('summarize this repository')
  })

  it('focuses the composer when location.state.focusComposer is set', () => {
    renderChatRoute(undefined, { focusComposer: true, draft: 'start here' })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveFocus()
  })

  it('does nothing for a plain navigation with no hand-off state', () => {
    renderChatRoute()
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveValue('')
    expect(textarea).not.toHaveFocus()
  })

  it('does not clobber an in-progress draft already in storage (stale state on back/refresh)', () => {
    localStorage.setItem('agent-deck:draft:new', 'half-typed message')
    renderChatRoute(undefined, { draft: 'starter prompt' })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveValue('half-typed message')
  })
})

// --- Per-conversation composer draft (P2) ------------------------------------
// The Outlet's activeSessionId threads down to the composer's sessionKey, so each
// conversation keeps its OWN persisted draft instead of all sharing the `:new`
// one. This proves the wiring App.tsx → ChatRoute → ChatView → Composer.
describe('ChatRoute — per-conversation composer draft (P2)', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockSetModelMutateAsync.mockReset()
    mockSetModelMutateAsync.mockResolvedValue({ status: 'switched' })
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    mockUseModels.mockReturnValue({ data: undefined })
  })

  it('keys the composer draft to the active session id from the Outlet context', () => {
    // A draft saved under the ACTIVE session restores; the `:new` draft does NOT
    // leak into a session that has its own id.
    localStorage.setItem('agent-deck:draft:sess-7', 'draft for session 7')
    localStorage.setItem('agent-deck:draft:new', 'unsent new-chat draft')
    renderChatRoute({ activeSessionId: 'sess-7' })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveValue('draft for session 7')
  })

  it('falls back to the :new draft when there is no active session (fresh chat)', () => {
    localStorage.setItem('agent-deck:draft:new', 'unsent new-chat draft')
    renderChatRoute({ activeSessionId: null })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveValue('unsent new-chat draft')
  })
})

// --- Fork from here, end-to-end through the real store (Lane D) ---------------
// Drives the store-backed fork → return loop so the ORIGINAL continuation is
// provably reachable, and the honest local-fork banner appears with no fake DAG
// claim.
describe('ChatRoute — fork from here (store-backed)', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...initialChatState,
      nodes: undefined,
      branches: undefined,
      activeBranchId: null,
    })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockSetModelMutateAsync.mockReset()
    mockSetModelMutateAsync.mockResolvedValue({ status: 'switched' })
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    mockUseModels.mockReturnValue({ data: undefined })
    useChatStore.setState({
      turns: [
        { id: 'u1', role: 'user', content: 'first question' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'first answer',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
        { id: 'u2', role: 'user', content: 'second question' },
        {
          id: 'a2',
          role: 'assistant',
          content: 'the original continuation',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
    })
  })

  it('forks to the ancestor path, shows the honest banner, and the original is reachable again', async () => {
    const user = userEvent.setup()
    renderChatRoute()

    // Fork from the FIRST assistant turn (a1). The transcript projects only the
    // ancestor path u1 → a1; the original continuation disappears from view.
    const forkButtons = await screen.findAllByRole('button', { name: 'Fork from here' })
    await user.click(forkButtons[0]!)
    await waitFor(() =>
      expect(screen.queryByText('the original continuation')).not.toBeInTheDocument(),
    )
    // The ancestor path is projected: the first user turn (plain text) is present,
    // and the second question (a descendant of the fork point) is gone.
    expect(screen.getByText('first question')).toBeInTheDocument()
    expect(screen.queryByText('second question')).not.toBeInTheDocument()

    // The honest local-fork banner appears — local means local, no DAG claim.
    const banner = screen.getByTestId('fork-banner')
    expect(banner).toHaveTextContent(/forked locally/i)
    expect(banner).toHaveTextContent(/your original chat is still saved/i)
    expect(banner.textContent ?? '').not.toMatch(/persisted|\bdag\b/i)

    // Return to the original chat → the full original path is back (the second
    // question, a descendant of the fork point, is reachable again).
    await user.click(screen.getByTestId('fork-return'))
    await waitFor(() => expect(screen.getByText('second question')).toBeInTheDocument())
    expect(await screen.findByText('the original continuation')).toBeInTheDocument()
    // The banner clears (the original branch is not a fork).
    expect(screen.queryByTestId('fork-banner')).not.toBeInTheDocument()
  })
})

describe('ChatRoute — honest chat-readiness from the models query', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
  })

  it('no usable model (reachable, empty list) → shows the connect-a-model notice', () => {
    mockUseModels.mockReturnValue({ data: { models: [] }, isError: false, isSuccess: true })
    renderChatRoute()
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(notice).toHaveTextContent(/model/i)
    expect(within(notice).getByRole('button', { name: /connect a model/i })).toBeInTheDocument()
  })

  it('agent unreachable (models query errored) → shows the unreachable notice', () => {
    mockUseModels.mockReturnValue({ data: undefined, isError: true, isSuccess: false })
    renderChatRoute()
    expect(screen.getByTestId('chat-blocked-notice')).toHaveTextContent(/reach|running|hermes/i)
  })

  it('still loading (no error, no success yet) → does NOT block', () => {
    mockUseModels.mockReturnValue({ data: undefined, isError: false, isSuccess: false })
    renderChatRoute()
    expect(screen.queryByTestId('chat-blocked-notice')).not.toBeInTheDocument()
  })

  it('a usable model is present → no notice', () => {
    mockUseModels.mockReturnValue({
      data: {
        models: [
          {
            id: 'claude-opus-4',
            qualifiedId: 'anthropic/claude-opus-4',
            label: 'Claude Opus 4',
            provider: 'anthropic',
            active: true,
            usable: true,
            source: 'config',
          },
        ],
      },
      isError: false,
      isSuccess: true,
    })
    renderChatRoute()
    expect(screen.queryByTestId('chat-blocked-notice')).not.toBeInTheDocument()
  })
})

describe('ChatRoute — one-click recovery gating (deck-server-up vs agent-down)', () => {
  const HEALTH_DOWN = {
    status: 'degraded',
    hermes: { reachable: false, endpoint: null, platform: null },
    bind: { remote: false, terminalEnabled: true, authRequired: false },
    version: '0.1.0',
  }

  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
    useHeaderStore.setState({ content: null })
    localStorage.clear()
    mockUseProfiles.mockReturnValue(profilesWith({ name: 'Sol' }))
    // Unreachable agent: the models read failed (the BFF-proxied probe).
    mockUseModels.mockReturnValue({ data: undefined, isError: true, isSuccess: false })
    mockFetchHealth.mockReset()
  })

  it('deck server up + agent down (/health resolves reachable:false) → offers Start my agent', async () => {
    mockFetchHealth.mockResolvedValue(HEALTH_DOWN)
    renderChatRoute()
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(
      await within(notice).findByRole('button', { name: /start my agent/i }),
    ).toBeInTheDocument()
  })

  it('deck server down (/health itself fails) → NO button, the honest no-action copy stands', async () => {
    // A restart POST could not land on a down deck server, so offering the
    // button would be a lie. The notice keeps its self-help copy instead.
    mockFetchHealth.mockRejectedValue(new Error('connection refused'))
    renderChatRoute()
    const notice = screen.getByTestId('chat-blocked-notice')
    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled())
    expect(within(notice).queryByRole('button', { name: /start my agent/i })).toBeNull()
    expect(notice).toHaveTextContent(/make sure hermes is running/i)
  })

  it('agent reachable per /health (a transient models failure) → no start button', async () => {
    mockFetchHealth.mockResolvedValue({
      ...HEALTH_DOWN,
      status: 'ok',
      hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
    })
    renderChatRoute()
    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled())
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(within(notice).queryByRole('button', { name: /start my agent/i })).toBeNull()
  })
})

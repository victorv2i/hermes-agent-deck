import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useOutletContext } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { resetOnboarded, markOnboarded } from '@/lib/useOnboarded'
import type { ChatOutletContext } from '@/app/navigation'
import App from './App'

// App owns the live `/chat-run` socket via useChatRun. We don't have a BFF in
// jsdom; the socket simply stays in 'connecting' and never emits, which is fine
// for asserting the global keyboard chrome (palette + shortcuts overlay).

/** A stand-in routed surface that consumes the App's Outlet context and fires
 * its `openPalette` action: the seam the Home hero's ⌘K hint chip drives. */
function OpenPaletteProbe() {
  const { openPalette } = useOutletContext<ChatOutletContext>()
  return (
    <button type="button" onClick={openPalette}>
      open palette probe
    </button>
  )
}

function renderApp(initialEntries: string[] = ['/chat']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          // Home owns the index ('/'); Chat lives at '/chat' (+ '/chat/:id' for the
          // URL-addressable, refresh-safe conversation — mirrors router.tsx).
          { index: true, element: <div>home</div> },
          { path: 'chat/:id?', element: <div>chat</div> },
          { path: 'files', element: <div>files</div> },
          // A probe surface for the App-owned `openPalette` Outlet-context action.
          { path: 'palette-probe', element: <OpenPaletteProbe /> },
        ],
      },
    ],
    { initialEntries },
  )
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

/** Stub fetch so the App's sessions query (and any status/usage reads) resolve
 * deterministically. `sessions` controls the first-run "no sessions" gate. */
function stubFetch(sessions: { total: number; sessions: unknown[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const health = {
        status: 'ok',
        hermes: {
          reachable: true,
          endpoint: 'http://127.0.0.1:8643',
          platform: 'hermes-agent',
        },
        bind: { remote: false, terminalEnabled: true, authRequired: false },
        version: '0.1.0',
      }
      const body = url.includes('/health')
        ? health
        : url.includes('/sessions')
          ? sessions
          : { error: 'not found' }
      return new Response(JSON.stringify(body), {
        status: url.includes('/health') || url.includes('/sessions') ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

/** Render App with the real route shape: Home owns the index ('/'), Chat lives
 * at '/chat'. Returns the router so tests can read the settled path. */
function renderAppWithHome(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          { index: true, element: <div>home front door</div> },
          { path: 'chat/:id?', element: <div>chat surface</div> },
          { path: 'files', element: <div>files surface</div> },
        ],
      },
    ],
    { initialEntries },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

/** matchMedia mock: desktop + wide (clears the sessions-pane width gate AND the
 * 1280px wide-cockpit gate). */
function setWideDesktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/** matchMedia mock: a mid-width desktop — clears the 1024px sessions-pane gate
 * but is BELOW the 1280px cockpit gate. So the split rail keeps its slim
 * ICON-nav (labels appear only at the wider cockpit width). */
function setMidDesktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width') && !query.includes('1280'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('App global keyboard chrome', () => {
  beforeEach(() => {
    localStorage.clear()
    resetOnboarded()
    // These exercise the chrome, not onboarding — opt out of the first-run
    // front-door redirect so the layout renders Chat directly.
    markOnboarded()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    stubFetch({ total: 0, sessions: [] })
  })

  it('opens the command palette on Cmd/Ctrl+K', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(screen.queryByRole('combobox', { name: /command menu/i })).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('combobox', { name: /command menu/i })).toBeInTheDocument()
  })

  it("the Outlet context's openPalette action opens the command palette (the Home ⌘K chip seam)", async () => {
    const user = userEvent.setup()
    renderApp(['/palette-probe'])
    expect(screen.queryByRole('combobox', { name: /command menu/i })).not.toBeInTheDocument()
    // A routed surface (the way Home's hero chip does) fires the App-owned action.
    await user.click(await screen.findByRole('button', { name: /open palette probe/i }))
    expect(await screen.findByRole('combobox', { name: /command menu/i })).toBeInTheDocument()
  })

  it('opens the shortcuts overlay on "?"', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('navigation', { name: /^sidebar$/i })
    await user.keyboard('?')
    expect(await screen.findByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
  })
})

describe('App surface-aware split rail', () => {
  beforeEach(() => {
    localStorage.clear()
    resetOnboarded()
    // Rail morphology tests — opt out of the first-run redirect.
    markOnboarded()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    // Mid-width desktop: the sessions pane shows, but below the cockpit gate the
    // split nav stays the slim ICON-nav. (The wide labeled-nav case is tested
    // separately below.)
    setMidDesktop()
    stubFetch({ total: 0, sessions: [] })
  })

  it('renders the split rail (stable labeled nav + dedicated sessions pane) on Chat', async () => {
    // §2(a) — the desktop split nav is the stable labeled treatment at every
    // width (no icon-rail shapeshift); the dedicated pane shows beside it.
    renderApp(['/chat'])
    const nav = await screen.findByRole('navigation', { name: /^sidebar$/i })
    expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
    expect(screen.getByTestId('sessions-pane')).toHaveAttribute('data-sessions-collapsed', 'false')
  })

  it('keeps exactly ONE interactive "New chat" control on Chat (the rail action; the pane carries no duplicate)', async () => {
    renderApp(['/chat'])
    const pane = await screen.findByTestId('sessions-pane')
    // The pane is list-only: no duplicate "New chat" button at its top, and the
    // dense list's indicator row stays NON-interactive (no colliding accessible
    // name with the rail's real action button).
    expect(within(pane).queryByRole('button', { name: /new chat/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /new chat/i })).toHaveLength(1)
  })

  it('a WIDE window keeps the same stable LABELED nav on Chat (no shapeshift)', async () => {
    // §2(a) — the split nav reads identically at every desktop width: the full
    // labeled surface nav, WHILE keeping the dedicated sessions pane.
    setWideDesktop()
    renderApp(['/chat'])
    const nav = await screen.findByRole('navigation', { name: /^sidebar$/i })
    expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
    expect(screen.getByTestId('sessions-pane')).toBeInTheDocument()
    // It never collapses to a slim icon-nav.
    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
  })

  it('uses the single labeled rail on the Home front door (the index)', async () => {
    renderApp(['/'])
    // Home keeps the single labeled rail; no slim icon-nav / dedicated pane.
    expect(await screen.findByRole('navigation', { name: /^sidebar$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
  })

  it('uses the single labeled rail on a non-chat surface (Files)', async () => {
    renderApp(['/files'])
    // The labeled Sidebar is the desktop chrome; no slim icon-nav / dedicated pane.
    expect(await screen.findByRole('navigation', { name: /^sidebar$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
  })

  it('collapses and re-expands the sessions pane on Cmd/Ctrl+B', async () => {
    const user = userEvent.setup()
    renderApp(['/chat'])
    const pane = await screen.findByTestId('sessions-pane')
    expect(pane).toHaveAttribute('data-sessions-collapsed', 'false')
    await user.keyboard('{Control>}b{/Control}')
    expect(pane).toHaveAttribute('data-sessions-collapsed', 'true')
    await user.keyboard('{Control>}b{/Control}')
    expect(pane).toHaveAttribute('data-sessions-collapsed', 'false')
  })
})

describe('App header terminal-dock toggle responsive shedding', () => {
  beforeEach(() => {
    localStorage.clear()
    resetOnboarded()
    markOnboarded()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    setWideDesktop()
    // terminalEnabled: true (from stubFetch's /health) so the toggle mounts.
    stubFetch({ total: 0, sessions: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides the terminal-dock toggle below sm and reveals it at sm+ (responsive shedding)', async () => {
    // mobile-header-crowding: at 375px the right-cluster already carries the
    // burn-rate pill + connection dot + theme + preview + new-chat; the dock
    // toggle is a desktop/power affordance, so it sheds below sm (Tailwind
    // `hidden`) and returns as a real 44px target at sm+ (`sm:inline-flex` +
    // `sm:size-10`). The full /terminal surface stays reachable from the nav.
    renderApp(['/chat'])
    const toggle = await screen.findByTestId('terminal-dock-toggle')
    expect(toggle).toHaveClass('hidden')
    expect(toggle).toHaveClass('sm:inline-flex')
    // Real 44px touch target where shown.
    expect(toggle).toHaveClass('size-11')
  })
})

describe('App §1 one-click resume from the sessions pane', () => {
  beforeEach(() => {
    localStorage.clear()
    resetOnboarded()
    markOnboarded()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    setMidDesktop()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A pane fixture: two web-originated sessions, plus the detail/messages reads
   * that the resume seed performs. */
  function stubPaneSessions() {
    const now = Math.floor(Date.now() / 1000)
    const row = (id: string, title: string) => ({
      id,
      source: 'web',
      model: 'anthropic/claude-sonnet-4',
      title,
      preview: 'preview',
      started_at: now,
      last_active: now,
      message_count: 1,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      cost_usd: null,
      is_active: false,
    })
    const list = { total: 2, sessions: [row('sess-a', 'First chat'), row('sess-b', 'Second chat')] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        const json = (b: unknown) =>
          new Response(JSON.stringify(b), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        if (url.includes('/health'))
          return json({
            status: 'ok',
            hermes: {
              reachable: true,
              endpoint: 'http://127.0.0.1:8643',
              platform: 'hermes-agent',
            },
            bind: { remote: false, terminalEnabled: true, authRequired: false },
            version: '0.1.0',
          })
        if (url.includes('/organization')) return json({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return json({ results: [] })
        if (/\/sessions\/[^/]+\/messages/.test(url)) return json({ session_id: 'x', messages: [] })
        if (/\/sessions\/[^/]+$/.test(url))
          return json({ ...row('sess-a', 'First chat'), ended_at: now, tool_call_count: 0 })
        if (url.includes('/sessions')) return json(list)
        return json({})
      }),
    )
  }

  it('clicking a pane session RESUMES in place (→ /chat/<id>), not the transcript page', async () => {
    const user = userEvent.setup()
    stubPaneSessions()
    const router = renderAppWithHome(['/chat'])
    await screen.findByText('chat surface')

    // The pane lists the session; click the row (not its overflow action).
    const row = await screen.findByRole('button', {
      name: (name) =>
        name.includes('First chat') &&
        !name.startsWith('Pin ') &&
        !name.startsWith('Delete ') &&
        !name.startsWith('More actions'),
    })
    await user.click(row)

    // Resumes in place onto the URL-addressable chat (/chat/:id) — the refresh-safe
    // restore key — and never routes to a read-only /sessions/:id transcript page.
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/sess-a'))
    expect(router.state.location.pathname).not.toMatch(/^\/sessions\//)
  })

  it('re-resuming the same session after New chat seeds it AGAIN (consume guard resets)', async () => {
    // Regression: the seed effect consumes a continue id exactly once via
    // consumedRef. New chat must clear that guard, else clicking the just-left
    // session again early-returns and the click silently does nothing.
    const user = userEvent.setup()
    stubPaneSessions()
    renderAppWithHome(['/chat'])
    await screen.findByText('chat surface')

    const sessARow = () =>
      screen.findByRole('button', {
        name: (name) =>
          name.includes('First chat') &&
          !name.startsWith('Pin ') &&
          !name.startsWith('Delete ') &&
          !name.startsWith('More actions'),
      })
    // Count how many times the resume seed fetched sess-a's transcript.
    const seedCount = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        ([input]) => String(input).includes('/sessions/sess-a/messages'),
      ).length

    await user.click(await sessARow())
    await waitFor(() => expect(seedCount()).toBe(1))

    // The rail owns the single "New chat" action (the pane carries no duplicate);
    // getByRole also fails on multiple matches, guarding the one-control invariant.
    await user.click(screen.getByRole('button', { name: /new chat/i }))

    await user.click(await sessARow())
    await waitFor(() => expect(seedCount()).toBe(2))
  })

  it('mounting directly at /chat/:id (a browser refresh) rehydrates that conversation', async () => {
    // The lost-on-refresh fix: a refresh lands on /chat/:id with an EMPTY store;
    // the seed effect must reload the transcript from the durable sessions API so
    // the conversation (and its rail highlight) come back, not a blank chat.
    stubPaneSessions()
    renderAppWithHome(['/chat/sess-a'])
    await screen.findByText('chat surface')
    const seedCount = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        ([input]) => String(input).includes('/sessions/sess-a/messages'),
      ).length
    await waitFor(() => expect(seedCount()).toBe(1))
  })
})

describe('App first-run front door (spec §2/§3)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetOnboarded()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    setWideDesktop()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    resetOnboarded()
  })

  it('lands first-run users (no flag, no sessions) on the Home index — no redirect', async () => {
    stubFetch({ total: 0, sessions: [] })
    const router = renderAppWithHome(['/'])
    // Home owns the index, so a newcomer simply stays on '/' (the welcoming front
    // door) — there is no redirect dance anymore.
    expect(await screen.findByText('home front door')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.pathname).toBe('/')
  })

  it('opening the index always shows Home, even when sessions exist', async () => {
    stubFetch({ total: 1, sessions: [{ id: 'sess-a' }] })
    const router = renderAppWithHome(['/'])
    await screen.findByText('home front door')
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.pathname).toBe('/')
  })

  it('does not redirect when deep-linked to a non-home surface', async () => {
    stubFetch({ total: 0, sessions: [] })
    const router = renderAppWithHome(['/files'])
    await screen.findByText('files surface')
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.pathname).toBe('/files')
  })
})

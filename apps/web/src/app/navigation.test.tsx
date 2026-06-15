import { Suspense } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  NAV,
  NAV_GROUPS,
  NAV_GROUP_LABELS,
  CHAT_PATH,
  navByGroup,
  pinnedNavItems,
  pinnedTopNavItems,
  surfaceTitle,
  type ChatOutletContext,
} from './navigation'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { Sidebar } from '@/components/layout/Sidebar'

describe('NAV registry', () => {
  it('mounts the Home front door at the index path as a STANDALONE top item', () => {
    const home = NAV.find((i) => i.key === 'home')!
    expect(home.label).toBe('Home')
    expect(home.path).toBe('/')
    expect(home.hidden).toBeUndefined()
    // Home floats ABOVE the grouped nav as a pinned-top standalone item.
    expect(home.pinnedTop).toBe(true)
  })

  it('promotes Chat to a STANDALONE pinned-top item at /chat (beside Home)', () => {
    const chat = NAV.find((i) => i.key === 'chat')!
    expect(chat.label).toBe('Chat')
    expect(chat.path).toBe('/chat')
    // Chat is no longer a group member — it's pinned to the top with Home.
    expect(chat.pinnedTop).toBe(true)
    expect(chat.hidden).toBeUndefined()
  })

  it('keeps the History surface ROUTED but HIDDEN from the rail (folded into Chat)', () => {
    const history = NAV.find((i) => i.key === 'chats')!
    // The data term stays "session" + the stable key stays `chats`; the label +
    // path stay "History"/'/history'. It folded into Chat in the nav, so it's
    // `hidden` (routed for deep-links + ⌘K + the mobile "Past chats" button), not
    // a rail link.
    expect(history.label).toBe('History')
    expect(history.path).toBe('/history')
    expect(history.hidden).toBe(true)
  })

  it('registers every integrated surface', () => {
    expect(NAV.map((i) => i.key)).toEqual([
      'home',
      'chat',
      'chats',
      'sessions',
      'files',
      'jobs',
      'kanban',
      'terminal',
      'profiles',
      'tools',
      'connections',
      'agent-detail',
      'usage',
      'logs',
      'system',
      'settings',
    ])
    // The dynamic Sessions History route is routed but hidden from the rail.
    expect(NAV.find((i) => i.key === 'sessions')?.hidden).toBe(true)
    // The per-agent hub (/profiles/:name) is routed but hidden — reached from the
    // Agents list / chip, not a rail link. (Memory/Soul + Skills folded into it.)
    expect(NAV.find((i) => i.key === 'agent-detail')?.hidden).toBe(true)
    // Terminal + Workspaces UNIFIED into one surface: the separate Workspaces rail
    // entry and the standalone single-workspace route are gone (saved sets live in
    // a switcher inside the Terminal surface; the `/workspaces` + `/workspaces/:id`
    // paths alias to it via router.tsx).
    expect(NAV.find((i) => i.key === 'workspaces')).toBeUndefined()
    expect(NAV.find((i) => i.key === 'workspace-detail')).toBeUndefined()
    expect(NAV.find((i) => i.key === 'memory')).toBeUndefined()
    // Skills retired as a standalone surface — folded into the agent hub.
    expect(NAV.find((i) => i.key === 'skills')).toBeUndefined()
    // Voice/Messaging/MCP folded into the ONE tabbed Connections surface — they're
    // no longer standalone NAV entries (their Routes mount inside Connections; the
    // old paths redirect via router.tsx).
    expect(NAV.find((i) => i.key === 'voice')).toBeUndefined()
    expect(NAV.find((i) => i.key === 'messaging')).toBeUndefined()
    expect(NAV.find((i) => i.key === 'mcp')).toBeUndefined()
    // Connections is a real routed rail surface, PROMOTED to the top-level "Your
    // agent" group (its outward reach), out of Advanced.
    const connections = NAV.find((i) => i.key === 'connections')!
    expect(connections.path).toBe('/connections')
    expect(connections.group).toBe('agent')
    expect(connections.hidden).toBeUndefined()
    // System is a VISIBLE Activity rail row again — it holds the recovery actions
    // (restart, updates, health), which must be findable from the rail exactly
    // when the agent is down. Being non-hidden also puts it back in the palette's
    // auto "Go to" rows. Logs stays DEMOTED: routed (so /logs works + stays
    // reachable from ⌘K / Settings / System) but never a rail row.
    expect(NAV.find((i) => i.key === 'system')?.hidden).toBeUndefined()
    expect(NAV.find((i) => i.key === 'logs')?.hidden).toBe(true)
  })

  it('pins Usage + Settings to the bottom of the rail (Usage just above Settings)', () => {
    expect(NAV.find((i) => i.key === 'settings')?.pinned).toBe(true)
    // Usage is metering, not the agent's "Activity" — floated to the pinned-bottom
    // cluster, in registry order so it sits just above Settings.
    expect(NAV.find((i) => i.key === 'usage')?.pinned).toBe(true)
    expect(pinnedNavItems().map((i) => i.key)).toEqual(['usage', 'settings'])
    // The grouped rail nav never re-lists a pinned surface.
    const grouped = navByGroup().flatMap((g) => g.items.map((i) => i.key))
    expect(grouped).not.toContain('settings')
    expect(grouped).not.toContain('usage')
  })

  it('pins Home + Chat to the TOP of the rail as standalone items', () => {
    expect(NAV.find((i) => i.key === 'home')?.pinnedTop).toBe(true)
    expect(NAV.find((i) => i.key === 'chat')?.pinnedTop).toBe(true)
    expect(pinnedTopNavItems().map((i) => i.key)).toEqual(['home', 'chat'])
    // The grouped rail nav never re-lists the pinned-top Home/Chat.
    const grouped = navByGroup().flatMap((g) => g.items.map((i) => i.key))
    expect(grouped).not.toContain('home')
    expect(grouped).not.toContain('chat')
  })

  it('gives each group a friendly (non-jargon) header label', () => {
    expect(NAV_GROUP_LABELS.workspace).toBe('Workspace')
    expect(NAV_GROUP_LABELS.agent).toBe('Your agent')
    expect(NAV_GROUP_LABELS.activity).toBe('Activity')
    // The raw "system" jargon group is gone, and so is the "chat" group (Home +
    // Chat are pinned-top standalone items now).
    expect(NAV_GROUPS).not.toContain('system')
    expect(NAV_GROUPS).not.toContain('chat')
  })

  it('every NavItem declares a known group, a unique key, and a path', () => {
    const keys = new Set<string>()
    for (const item of NAV) {
      expect(NAV_GROUPS).toContain(item.group)
      expect(item.path).toMatch(/^\//)
      expect(keys.has(item.key)).toBe(false)
      keys.add(item.key)
    }
  })

  it('navByGroup orders by NAV_GROUPS, drops empty + hidden + pinned + pinnedTop, preserves order', () => {
    const grouped = navByGroup()
    // The collapsible "Advanced" group was REMOVED — its surfaces flattened into the
    // three visible groups: Files + Terminal into "Workspace", Tools into "Your
    // agent", Usage into "Activity". Home/Chat are pinned-top; History/Sessions/
    // Logs hidden; Settings pinned-bottom.
    // "Your agent" leads (identity + capabilities, the personalization core), then
    // Workspace, then Activity.
    expect(grouped.map((g) => g.group)).toEqual(['agent', 'workspace', 'activity'])
    expect(grouped.map((g) => g.label)).toEqual(['Your agent', 'Workspace', 'Activity'])
    // "Your agent" = who the agent is + what it can do (Agents, Tools, Connections).
    expect(grouped.find((g) => g.group === 'agent')!.items.map((i) => i.key)).toEqual([
      'profiles',
      'tools',
      'connections',
    ])
    // Workspace = the daily work surfaces (Files, Terminal). Terminal is now the
    // UNIFIED surface (Scratch + saved workspaces in one); the separate Workspaces
    // rail entry was removed.
    expect(grouped.find((g) => g.group === 'workspace')!.items.map((i) => i.key)).toEqual([
      'files',
      'terminal',
    ])
    // Activity = the agent's ongoing work (Tasks, Board) plus the System recovery
    // surface (after Board, just above the pinned bottom). Usage moved to the
    // pinned-bottom cluster; hidden Logs excluded.
    expect(grouped.find((g) => g.group === 'activity')!.items.map((i) => i.key)).toEqual([
      'jobs',
      'kanban',
      'system',
    ])
    // Grouping preserves the NAV_GROUPS order for any populated groups.
    const order = grouped.map((g) => NAV_GROUPS.indexOf(g.group))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('surfaceTitle resolves the friendly active-surface name from a pathname', () => {
    expect(surfaceTitle('/')).toBe('Home')
    expect(surfaceTitle('/chat')).toBe('Chat')
    expect(surfaceTitle('/history')).toBe('History')
    expect(surfaceTitle('/files')).toBe('Files')
    expect(surfaceTitle('/settings')).toBe('Settings')
    // System (a rail row) and the demoted Logs both resolve their friendly titles.
    expect(surfaceTitle('/system')).toBe('System')
    expect(surfaceTitle('/logs')).toBe('Logs')
    // The folded Connections surface resolves its title; Voice/Messaging/MCP now
    // redirect here, so the live path the header reads is always /connections.
    expect(surfaceTitle('/connections')).toBe('Connections')
    // The Tools surface resolves its title.
    expect(surfaceTitle('/tools')).toBe('Tools')
    // Nested paths resolve to their parent surface's label.
    expect(surfaceTitle('/profiles/scout')).toBe('Agents')
    // A session-history deep link reads as its conceptual home (History).
    expect(surfaceTitle('/sessions/abc123')).toBe('History')
    // An unknown path yields no title (the header stays a plain spacer).
    expect(surfaceTitle('/nope')).toBeNull()
  })
})

describe('History folds into Chat (no rail link)', () => {
  // History folded into Chat: on desktop the chat surface's session pane is the
  // history; on mobile the chat header's "Past chats" button is the way in. The
  // rail therefore never lists a History link, regardless of viewport — but the
  // promoted Chat link is always present.
  function stubPaneVisible(visible: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width') ? visible : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  function renderSidebar() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('never lists a History rail link when the sessions pane is visible (>=1024px)', () => {
    stubPaneVisible(true)
    renderSidebar()
    expect(screen.queryByRole('link', { name: /^history$/i })).not.toBeInTheDocument()
    // Chat is promoted to a primary pinned-top rail link — always present.
    expect(screen.getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
  })

  it('still lists no History rail link below the pane breakpoint (<1024px)', () => {
    stubPaneVisible(false)
    renderSidebar()
    expect(screen.queryByRole('link', { name: /^history$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
  })

  it('lists System as a visible rail link (the recovery surface), while Logs stays off the rail', () => {
    stubPaneVisible(true)
    renderSidebar()
    // The rail picks System up automatically from the registry (non-hidden,
    // Activity group) — users whose agent is down can find the restart/update/
    // health actions without knowing ⌘K.
    expect(screen.getByRole('link', { name: /^system$/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^logs$/i })).not.toBeInTheDocument()
  })
})

describe('Chat surface routing', () => {
  // A stand-in layout that supplies the Outlet context the real App provides,
  // without opening a live `/chat-run` socket — this isolates the route wiring.
  // A Suspense boundary covers the lazy Home (index) surface.
  function StubLayout() {
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
    }
    return (
      <Suspense fallback={<div data-testid="surface-fallback">loading</div>}>
        <Outlet context={context} />
      </Suspense>
    )
  }

  // The real NAV-derived routes: Home owns the index ('/'), Chat lives at
  // '/chat', every other surface maps its path — mirrors app/router.tsx exactly.
  function navRoutes(): RouteObject[] {
    return [
      {
        path: '/',
        element: <StubLayout />,
        children: NAV.map((item) =>
          item.path === '/'
            ? { index: true, element: item.element }
            : { path: item.path.replace(/^\//, ''), element: item.element },
        ),
      },
    ]
  }

  // Surfaces (Home/Chat) read live data via React Query and branch on media
  // queries; the real app always mounts a QueryClient + has matchMedia, so the
  // route-wiring tests supply both. No BFF in jsdom → queries stay empty, fine.
  function stubMatchMedia() {
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
  }

  function renderAt(initial: string) {
    stubMatchMedia()
    const router = createMemoryRouter(navRoutes(), { initialEntries: [initial] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>,
    )
  }

  it('renders the Home front door at the index route "/"', async () => {
    renderAt('/')
    // Home is code-split, so the Suspense fallback shows first…
    expect(screen.getByTestId('surface-fallback')).toBeInTheDocument()
    // …then the lazy Home chunk resolves and the welcoming hero appears. With no
    // resolved active profile in this bare render, the hero shows the wordmark.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /agent deck/i })).toBeInTheDocument(),
    )
    // The index is the front door, NOT the chat composer.
    expect(screen.queryByRole('textbox', { name: /message your agent/i })).not.toBeInTheDocument()
  })

  it('renders the Chat surface (composer) at "/chat"', () => {
    renderAt(CHAT_PATH)
    // Chat is eager, so the composer is present without awaiting a chunk.
    expect(screen.getByRole('textbox', { name: /message your agent/i })).toBeInTheDocument()
  })
})

describe('Route-level code-splitting', () => {
  it('lazy-loads a non-chat surface behind a Suspense fallback, then resolves it', async () => {
    // jsdom has no fetch backend; surfaces that query simply stay loading/empty,
    // which is fine — we only assert the chunk resolves past the Suspense gate.
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
    const settings = NAV.find((i) => i.key === 'settings')!
    const routes: RouteObject[] = [
      {
        path: '/',
        element: (
          <Suspense fallback={<div data-testid="surface-fallback">loading</div>}>
            <Outlet />
          </Suspense>
        ),
        children: [{ path: 'settings', element: settings.element }],
      },
    ]
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] })
    render(
      <ThemeProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>,
    )
    // The Settings surface is code-split, so the Suspense fallback shows first…
    expect(screen.getByTestId('surface-fallback')).toBeInTheDocument()
    // …then the lazy chunk resolves and the real surface header appears.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument(),
    )
  })
})

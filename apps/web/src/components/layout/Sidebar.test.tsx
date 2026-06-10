import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { NAV_GROUP_LABELS, pinnedNavItems } from '@/app/navigation'

// The Sidebar hosts the AgentChip (reads the profile roster via React Query), so
// it needs a QueryClient. With no fetch backend the chip stays empty (renders
// nothing), leaving the nav assertions unaffected.
function renderSidebar(props?: Partial<React.ComponentProps<typeof Sidebar>>, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Sidebar {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Sidebar', () => {
  it('is NAV-ONLY by default — no embedded session list', () => {
    renderSidebar()
    // The rail no longer mounts the session list; recents live on Home + History + ⌘K.
    expect(screen.queryByRole('searchbox', { name: /search sessions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /sessions/i })).not.toBeInTheDocument()
  })

  it('shows the friendly group headers (no raw workspace/agent/system jargon)', () => {
    const { container } = renderSidebar()
    // The group headers are the `.ad-section-label` spans. Their text spells the
    // friendly labels. Home + Chat are pinned-top standalone items, so there's no
    // "Conversations"/chat group header.
    const headers = Array.from(container.querySelectorAll('.ad-section-label')).map(
      (el) => el.textContent,
    )
    // The collapsible "Advanced" group was removed; its surfaces flattened into the
    // three visible groups, so the rail now shows Workspace · Your agent · Activity.
    expect(headers).toContain(NAV_GROUP_LABELS.workspace)
    expect(headers).toContain(NAV_GROUP_LABELS.agent)
    expect(headers).toContain(NAV_GROUP_LABELS.activity)
    // No raw jargon survived.
    expect(headers).not.toContain('system')
    expect(headers).not.toContain('workspace')
    expect(headers).not.toContain('agent')
  })

  it('promotes Chat to a primary rail link and lists no History link (folded into Chat)', () => {
    renderSidebar()
    // Chat is a pinned-top primary destination.
    expect(screen.getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
    // History folded into Chat (desktop session pane + the mobile "Past chats"
    // button), so the rail no longer lists it.
    expect(screen.queryByRole('link', { name: /^history$/i })).not.toBeInTheDocument()
  })

  it('pins Settings to the BOTTOM of the rail (after the grouped nav)', () => {
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    const settingsLink = screen.getByRole('link', { name: /^settings$/i })
    // Settings is rendered outside the grouped <nav> (in the pinned bottom slot),
    // and the pinned registry carries Usage then Settings (Usage just above it).
    expect(nav.contains(settingsLink)).toBe(false)
    expect(pinnedNavItems().map((i) => i.key)).toEqual(['usage', 'settings'])
  })

  it('keeps Settings inside the scrollable rail when sessions are embedded', () => {
    renderSidebar({ showSessions: true })
    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    const settingsLink = screen.getByRole('link', { name: /^settings$/i })
    // Mobile slide-over mode carries nav + sessions in one scroll region, so a
    // pinned footer cannot cover lower surface rows on short screens.
    expect(nav.contains(settingsLink)).toBe(true)
  })

  it('fires onNewChat from the rail New chat action', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    renderSidebar({ onNewChat })
    await user.click(screen.getByRole('button', { name: /new chat/i }))
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })

  it('can still embed the session list when showSessions is set (mobile slide-over)', () => {
    renderSidebar({ showSessions: true })
    expect(screen.getByRole('searchbox', { name: /search sessions/i })).toBeInTheDocument()
  })

  it('§1 — the embedded list RESUMES a session in place (→ /chat?continue=), not the transcript page', async () => {
    const user = userEvent.setup()
    const now = Math.floor(Date.now() / 1000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        const json = (b: unknown) =>
          new Response(JSON.stringify(b), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        if (url.includes('/organization')) return json({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return json({ results: [] })
        if (url.includes('/sessions'))
          return json({
            total: 1,
            sessions: [
              {
                id: 'sess-m',
                source: 'web',
                model: 'm',
                title: 'Mobile chat',
                preview: 'p',
                started_at: now,
                last_active: now,
                message_count: 1,
                input_tokens: 1,
                output_tokens: 1,
                total_tokens: 2,
                cost_usd: null,
                is_active: false,
              },
            ],
          })
        return json({})
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const routes: RouteObject[] = [
      { path: '/', element: <Sidebar showSessions /> },
      { path: '/chat', element: <div data-testid="chat">chat</div> },
      { path: '/sessions/:id', element: <Sidebar showSessions /> },
    ]
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const row = await screen.findByRole('button', {
      name: (name) =>
        name.includes('Mobile chat') &&
        !name.startsWith('Pin ') &&
        !name.startsWith('Delete ') &&
        !name.startsWith('More actions'),
    })
    await user.click(row)
    expect(router.state.location.pathname).toBe('/chat')
    expect(router.state.location.search).toBe('?continue=sess-m')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('groups the surface nav under the friendly headers in order', () => {
    const { container } = renderSidebar()
    const headers = Array.from(container.querySelectorAll('.ad-section-label')).map(
      (el) => el.textContent,
    )
    expect(headers).toEqual([
      NAV_GROUP_LABELS.agent,
      NAV_GROUP_LABELS.workspace,
      NAV_GROUP_LABELS.activity,
    ])
  })

  it('renders all surfaces as flat top-level rail links — no collapsible "Advanced" group', () => {
    localStorage.clear()
    renderSidebar()
    // The "Advanced" collapsible toggle is gone entirely.
    expect(screen.queryByRole('button', { name: /^advanced$/i })).not.toBeInTheDocument()
    // The ex-Advanced surfaces are now visible top-level links (no expand needed):
    // Files + Terminal (Workspace), Tools (Your agent), Usage (Activity).
    expect(screen.getByRole('link', { name: /^files$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^terminal$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^tools$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^usage$/i })).toBeInTheDocument()
    // The promoted Tasks · Board · Connections remain visible top-level links.
    expect(screen.getByRole('link', { name: /^tasks$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^board$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^connections$/i })).toBeInTheDocument()
  })
})

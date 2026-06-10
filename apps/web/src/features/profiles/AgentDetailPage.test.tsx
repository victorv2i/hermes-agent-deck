import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AgentDetailPage } from './AgentDetailPage'
import type { ProfilesResponse } from './types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
// Shiki highlighter pulls real WASM; stub the read viewer to keep the test light.
vi.mock('@/features/files/CodeView', () => ({
  CodeView: ({ code }: { code: string }) => <pre data-testid="code-view">{code}</pre>,
}))

const profiles: ProfilesResponse = {
  active: 'default',
  profiles: [
    {
      name: 'atlas',
      displayPath: 'profiles/atlas',
      isDefault: false,
      isActive: false,
      model: 'sonnet',
      provider: 'anthropic',
      hasEnv: true,
      skillCount: 3,
      gatewayRunning: false,
      avatar: 'v2',
      displayName: null,
    },
  ],
}

/** A fetch router: /profiles → roster; /soul → a file. */
function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/profiles'))
        return { ok: true, status: 200, json: async () => profiles } as Response
      if (url.includes('/soul'))
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: '# Atlas soul', exists: true }),
        } as Response
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: '', exists: false }),
      } as Response
    }),
  )
}

function renderAt(name: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // A data router (RouterProvider) — AgentDetailPage's unsaved-Soul useBlocker
  // requires one, matching the app's createBrowserRouter.
  const router = createMemoryRouter(
    [
      { path: '/profiles/:name', element: <AgentDetailPage /> },
      { path: '/profiles', element: <div>roster</div> },
    ],
    { initialEntries: [`/profiles/${name}`] },
  )
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('AgentDetailPage (per-agent hub)', () => {
  it('plays the Hatch ceremony when arriving from a hatch (router state)', async () => {
    mockApi()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter(
      [
        { path: '/profiles/:name', element: <AgentDetailPage /> },
        { path: '/profiles', element: <div>roster</div> },
      ],
      { initialEntries: [{ pathname: '/profiles/atlas', state: { hatched: true } }] },
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/atlas has hatched/i))
  })

  it('holds the skeleton (never "no agent") while a just-hatched agent is still materializing', async () => {
    // The post-create roster refetch has not landed yet: the agent is absent
    // from the (stale) roster, but loading is false because cached data exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/profiles'))
          return {
            ok: true,
            status: 200,
            json: async () => ({ active: 'default', profiles: [] }),
          } as Response
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: '', exists: false }),
        } as Response
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter(
      [
        { path: '/profiles/:name', element: <AgentDetailPage /> },
        { path: '/profiles', element: <div>roster</div> },
      ],
      { initialEntries: [{ pathname: '/profiles/atlas', state: { hatched: true } }] },
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('agent-detail-loading')).toBeInTheDocument())
    // The birth must never flash the not-found message.
    expect(screen.queryByText(/no agent named/i)).not.toBeInTheDocument()
  })

  it('does NOT play the Hatch ceremony on a normal visit (no router state)', async () => {
    mockApi()
    renderAt('atlas')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'atlas' })).toBeInTheDocument())
    expect(screen.queryByText(/has hatched/i)).not.toBeInTheDocument()
  })

  it('renders the identity header (face + name + facts) and an editable avatar', async () => {
    mockApi()
    const { container } = renderAt('atlas')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'atlas' })).toBeInTheDocument())
    // Facts surface.
    expect(screen.getByText('sonnet')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText(/3 skills/i)).toBeInTheDocument()
    // The identity is editable (a button opening the face + display-name picker).
    expect(
      screen.getByRole('button', { name: /edit atlas's identity \(face & display name\)/i }),
    ).toBeInTheDocument()
    // The chosen face (v2) renders as a decorative <img> (aria-hidden).
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.some((i) => i.src.includes('/avatars/v2.webp'))).toBe(true)
  })

  it('shows an "Agents › <name>" breadcrumb with a Back-to-agents link', async () => {
    mockApi()
    renderAt('atlas')
    await screen.findByRole('heading', { name: 'atlas' })
    const nav = screen.getByRole('navigation', { name: /breadcrumb/i })
    // The parent crumb links back to the Agents roster…
    const back = within(nav).getByRole('link', { name: /agents/i })
    expect(back).toHaveAttribute('href', '/profiles')
    // …and the current agent name is the trailing crumb.
    expect(nav).toHaveTextContent(/atlas/)
  })

  it('offers an honest Switch on a non-active agent', async () => {
    mockApi()
    renderAt('atlas')
    await screen.findByRole('heading', { name: 'atlas' })
    expect(screen.getByRole('button', { name: /switch to this agent/i })).toBeInTheDocument()
  })

  it('mounts the agent Soul/Memory/User/Skills tabs scoped to this agent', async () => {
    mockApi()
    renderAt('atlas')
    await screen.findByRole('heading', { name: 'atlas' })
    const tablist = await screen.findByRole('tablist', { name: /agent files & skills/i })
    expect(within(tablist).getByRole('tab', { name: 'Soul' })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: 'Memory' })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: 'User' })).toBeInTheDocument()
    // Skills are folded into the hub as a 4th tab alongside the files.
    expect(within(tablist).getByRole('tab', { name: 'Skills' })).toBeInTheDocument()
    // The honest boundary line is present.
    expect(screen.getByTestId('agent-memory-boundary')).toBeInTheDocument()
    // The lifted Soul content renders.
    await waitFor(() => expect(screen.getByTestId('code-view')).toHaveTextContent('# Atlas soul'))
  })

  it('offers a real rename affordance on a non-default agent', async () => {
    mockApi()
    renderAt('atlas')
    await screen.findByRole('heading', { name: 'atlas' })
    expect(screen.getByRole('button', { name: /rename atlas/i })).toBeInTheDocument()
  })

  it('shows a calm not-found when the agent name is unknown', async () => {
    mockApi()
    renderAt('ghost')
    await waitFor(() => expect(screen.getByText(/no agent named/i)).toBeInTheDocument())
  })

  it('renders the agent + environment facts through the shared StatusDot (governed semantic, not the accent)', async () => {
    mockApi()
    renderAt('atlas')
    await screen.findByRole('heading', { name: 'atlas' })
    // The atlas fixture has gatewayRunning:false (→ idle) and hasEnv:true (→ info).
    const dots = screen.getAllByTestId('status-dot')
    expect(dots.length).toBeGreaterThanOrEqual(2)
    // Each shared dot is a governed semantic, never the amber action accent.
    for (const dot of dots) {
      const marker = dot.querySelector('[data-slot="status-dot-marker"]')
      // shape-tone markers have no bg dot; round-dot tones do. Either way: not the accent.
      const cls = marker?.className ?? dot.className
      expect(cls).not.toMatch(/\bbg-primary\b/)
      expect(cls).not.toMatch(/\btext-primary\b/)
    }
    // The agent-stopped fact is the muted/idle tone; .env-present is the info tone.
    expect(screen.getByText('Agent stopped')).toBeInTheDocument()
    expect(screen.getByText('.env present')).toBeInTheDocument()
  })
})

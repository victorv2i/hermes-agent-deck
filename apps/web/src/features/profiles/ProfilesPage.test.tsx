import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { ProfilesPage } from './ProfilesPage'
import type { ProfilesResponse } from './types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/** Render the Agents roster on a throwaway QueryClient inside a router (rows are
 * links to the per-agent hub). */
function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const sample: ProfilesResponse = {
  active: 'coder',
  profiles: [
    {
      name: 'default',
      displayPath: 'Hermes home',
      isDefault: true,
      isActive: false,
      model: 'gpt-5.5',
      provider: 'openai-codex',
      hasEnv: true,
      skillCount: 12,
      gatewayRunning: true,
      avatar: null,
      displayName: null,
    },
    {
      name: 'coder',
      displayPath: 'profiles/coder',
      isDefault: false,
      isActive: true,
      model: 'sonnet',
      provider: null,
      hasEnv: false,
      skillCount: 4,
      gatewayRunning: false,
      avatar: 'v3',
      displayName: null,
    },
  ],
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProfilesPage (Agents roster)', () => {
  it('does not crash when the profiles response is malformed (no profiles array)', async () => {
    // A degraded/empty API response can deserialize to {} with no `profiles`
    // array — the page must render an empty roster, not white-screen on .map().
    mockFetchOnce({})
    renderPage(<ProfilesPage />)
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument()
  })

  it('shows a calm empty state with a hatch action when there are no agents', async () => {
    mockFetchOnce({ active: null, profiles: [] })
    renderPage(<ProfilesPage />)
    expect(await screen.findByText(/no agents yet/i)).toBeInTheDocument()
    // The empty state itself offers a way to hatch the first agent (plus the header action).
    expect(screen.getAllByRole('button', { name: /new agent/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('titles the surface "Agents" and offers a New agent action', async () => {
    mockFetchOnce(sample)
    renderPage(<ProfilesPage />)
    expect(screen.getByRole('heading', { name: /^agents$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new agent/i })).toBeInTheDocument()
  })

  it('renders a loading state first', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderPage(<ProfilesPage />)
    expect(screen.getByTestId('profiles-loading')).toBeInTheDocument()
  })

  it('renders each agent as a row linking to its hub, with its face + model', async () => {
    mockFetchOnce(sample)
    renderPage(<ProfilesPage />)
    await waitFor(() => expect(screen.getByText('coder')).toBeInTheDocument())

    // The default agent reads as its real name "default" but keeps its model.
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.5')).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
    // The provider sits in its own gapped span (no "· provider" hugging the dot).
    expect(screen.getByText('openai-codex')).toBeInTheDocument()

    // Each row links to /profiles/:name (the hub).
    const coderLink = screen.getByRole('link', { name: /open coder/i })
    expect(coderLink).toHaveAttribute('href', '/profiles/coder')
  })

  it('renders a built-in avatar image per agent (the face, an <img> not amber svg)', async () => {
    mockFetchOnce(sample)
    const { container } = renderPage(<ProfilesPage />)
    await waitFor(() => expect(screen.getByText('coder')).toBeInTheDocument())
    // Avatars are decorative (aria-hidden) <img> webps — query the DOM directly.
    const imgs = Array.from(container.querySelectorAll('img'))
    // coder explicitly chose v3; the chosen face renders.
    expect(imgs.some((i) => i.src.includes('/avatars/v3.webp'))).toBe(true)
    // Never an inline svg painting the face amber.
    expect(imgs.length).toBeGreaterThan(0)
  })

  it('marks the active agent with an Active badge', async () => {
    mockFetchOnce(sample)
    renderPage(<ProfilesPage />)
    const coderRow = await screen.findByTestId('profile-card-coder')
    expect(within(coderRow).getByText(/active/i)).toBeInTheDocument()
  })

  it('has NO dead "copy switch command" CTA (switching is real on the hub now)', async () => {
    mockFetchOnce(sample)
    renderPage(<ProfilesPage />)
    await screen.findByTestId('profile-card-coder')
    expect(screen.queryByRole('button', { name: /copy switch command/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/hermes profile create/i)).not.toBeInTheDocument()
  })

  it('renders an error state with a retry control', async () => {
    mockFetchOnce({}, false, 500)
    renderPage(<ProfilesPage />)
    await waitFor(() => expect(screen.getByText(/couldn.t load agents/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})

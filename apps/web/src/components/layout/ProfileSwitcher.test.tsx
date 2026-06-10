import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { ProfileSwitcher } from './ProfileSwitcher'
import type { ProfileSummary } from '@/features/profiles/types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function renderSwitcher(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const profiles: ProfileSummary[] = [
  {
    name: 'default',
    displayPath: 'Hermes home',
    isDefault: true,
    isActive: false,
    model: 'gpt-5.5',
    provider: null,
    hasEnv: true,
    skillCount: 1,
    gatewayRunning: false,
    avatar: null,
    displayName: null,
  },
  {
    name: 'atlas',
    displayPath: 'profiles/atlas',
    isDefault: false,
    isActive: true,
    model: 'sonnet',
    provider: null,
    hasEnv: false,
    skillCount: 2,
    gatewayRunning: true,
    avatar: 'v3',
    displayName: null,
  },
]

afterEach(() => vi.restoreAllMocks())

describe('ProfileSwitcher', () => {
  it('lists agents active-first, with the active marked (amber check)', () => {
    renderSwitcher(
      <ProfileSwitcher open onOpenChange={() => {}} profiles={profiles} activeName="atlas" />,
    )
    const items = screen.getAllByRole('listitem')
    // Active (atlas) is first.
    expect(within(items[0]!).getByText('atlas')).toBeInTheDocument()
    expect(within(items[0]!).getByLabelText(/active/i)).toBeInTheDocument()
  })

  it('switching a non-active agent shows the honest restart action and re-probed state', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/agent-deck/system/gateway/restart') {
        return { ok: true, status: 200, json: async () => ({ status: 'running' }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ active: 'default' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSwitcher(
      <ProfileSwitcher open onOpenChange={() => {}} profiles={profiles} activeName="atlas" />,
    )
    await user.click(screen.getByRole('button', { name: /default/i }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'Switched to default. Hermes runs one agent at a time, so restart to make default the active agent.',
        ),
      ).toBeInTheDocument(),
    )
    // Honest, not a fake "all done": the one-agent-at-a-time constraint + the
    // still-required restart are spelled out.
    expect(screen.getByText(/one agent at a time/i)).toBeInTheDocument()
    expect(screen.queryByText('hermes gateway restart')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /restart your agent/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent-deck/system/gateway/restart',
        expect.any(Object),
      ),
    )
    expect(screen.getByText(/your agent reports/i)).toHaveTextContent(/running/i)
  })

  it('is calm at N=1 — "Your agent", no upsell/scarcity, with a quiet New-agent entry', () => {
    renderSwitcher(
      <ProfileSwitcher
        open
        onOpenChange={() => {}}
        profiles={[profiles[0]!]}
        activeName="default"
      />,
    )
    expect(screen.getByRole('heading', { name: /your agent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new agent/i })).toBeInTheDocument()
    // No scarcity framing.
    expect(screen.queryByText(/0 others|no other agents/i)).not.toBeInTheDocument()
  })
})

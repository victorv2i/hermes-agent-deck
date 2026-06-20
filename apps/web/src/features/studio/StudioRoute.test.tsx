import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProfilesResponse } from '@/features/profiles/types'
import { StudioRoute } from './StudioRoute'

const ROSTER: ProfilesResponse = {
  active: 'mercury',
  profiles: [
    {
      name: 'mercury',
      displayPath: '~/.hermes/profiles/mercury',
      isDefault: false,
      isActive: true,
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      hasEnv: true,
      skillCount: 3,
      gatewayRunning: true,
      avatar: null,
      displayName: 'Mercury',
    },
    {
      name: 'scout',
      displayPath: '~/.hermes/profiles/scout',
      isDefault: false,
      isActive: false,
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      hasEnv: false,
      skillCount: 1,
      gatewayRunning: false,
      avatar: null,
      displayName: null,
    },
  ],
}

// Stub the workbench (its own test covers it) so route selection is what we test.
vi.mock('./StudioWorkbench', () => ({
  StudioWorkbench: ({ agent, section }: { agent: string; section: string }) => (
    <div data-testid="stub-workbench">
      {agent}/{section}
    </div>
  ),
}))

// useProfiles → the fixed roster; status hooks → undefined (calm) so the
// launchpad still renders Start a chat.
vi.mock('@/features/profiles/useProfiles', async (orig) => {
  const actual = (await orig()) as object
  return {
    ...actual,
    useProfiles: () => ({ data: ROSTER, loading: false, error: null, refetch: vi.fn() }),
  }
})
vi.mock('@/features/activity/useStatus', () => ({
  useStatus: () => ({ data: undefined, isError: false }),
  statusKey: ['agent-deck', 'status'],
}))
vi.mock('@/features/jobs/hooks', () => ({ useJobs: () => ({ data: undefined }) }))
vi.mock('@/features/kanban/hooks', () => ({ useKanbanBoard: () => ({ data: undefined }) }))

// The Hatch dialog is heavy + navigates; stub it to a simple marker we can detect.
vi.mock('@/features/profiles/NewAgentDialog', () => ({
  NewAgentDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="hatch-dialog">hatch</div> : null,
}))

// The embedded global Connections surface is heavy (mounts Voice/Messaging/MCP/…);
// stub it to a marker so the view-switch wiring is what we test.
vi.mock('@/features/connections', () => ({
  ConnectionsRoute: () => <div data-testid="stub-connections">connections</div>,
}))

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderRoute(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <LocationProbe />
        <Routes>
          <Route path="/" element={<StudioRoute />} />
          <Route path="/chat" element={<div data-testid="chat">chat</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StudioRoute', () => {
  it('opens the active agent by default', () => {
    renderRoute('/')
    expect(screen.getByTestId('stub-workbench')).toHaveTextContent('mercury/identity')
  })

  it('opens the agent named in the ?agent= deep link', () => {
    renderRoute('/?agent=scout')
    expect(screen.getByTestId('stub-workbench')).toHaveTextContent('scout/identity')
  })

  it('opens the section named in the ?section= deep link', () => {
    renderRoute('/?agent=mercury&section=model')
    expect(screen.getByTestId('stub-workbench')).toHaveTextContent('mercury/model')
  })

  it('falls back to the active agent for an unknown ?agent=', () => {
    renderRoute('/?agent=ghost')
    expect(screen.getByTestId('stub-workbench')).toHaveTextContent('mercury/identity')
  })

  it('selecting another agent writes ?agent= to the URL', async () => {
    renderRoute('/')
    await userEvent.click(screen.getByTestId('studio-roster-card-scout'))
    expect(screen.getByTestId('location')).toHaveTextContent('agent=scout')
  })

  it('Start a chat navigates to the Chat surface', async () => {
    renderRoute('/')
    await userEvent.click(screen.getByRole('button', { name: /start a chat/i }))
    expect(screen.getByTestId('chat')).toBeInTheDocument()
  })

  it('New agent opens the Hatch dialog', async () => {
    renderRoute('/')
    await userEvent.click(screen.getByRole('button', { name: /new agent/i }))
    expect(screen.getByTestId('hatch-dialog')).toBeInTheDocument()
  })

  it('opens the embedded global Connections surface for ?view=connections', async () => {
    renderRoute('/?view=connections')
    // The lazy Connections surface resolves behind Suspense.
    expect(await screen.findByTestId('stub-connections')).toBeInTheDocument()
    // The Agents view's workbench is not shown in the Connections view.
    expect(screen.queryByTestId('stub-workbench')).not.toBeInTheDocument()
  })

  it('the launchpad Connections action writes ?view=connections to the URL', async () => {
    renderRoute('/')
    await userEvent.click(screen.getByRole('button', { name: /connections/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('view=connections')
    expect(await screen.findByTestId('stub-connections')).toBeInTheDocument()
  })

  it('the Connections back link clears ?view= (clean default URL)', async () => {
    renderRoute('/?view=connections')
    await userEvent.click(await screen.findByRole('button', { name: /^agent studio$/i }))
    // The default view drops the param rather than leaving ?view=agents lingering.
    expect(screen.getByTestId('location')).not.toHaveTextContent('view=')
    expect(screen.getByTestId('stub-workbench')).toBeInTheDocument()
  })
})

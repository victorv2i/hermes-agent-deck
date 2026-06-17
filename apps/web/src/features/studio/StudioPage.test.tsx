import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProfileSummary } from '@/features/profiles/types'
import { StudioPage, type StudioPageProps } from './StudioPage'

// The workbench is exercised in its own test; stub it so this layout test stays
// about the master-detail composition (launchpad + roster + workbench slot).
vi.mock('./StudioWorkbench', () => ({
  StudioWorkbench: ({ agent }: { agent: string }) => (
    <div data-testid="stub-workbench">workbench for {agent}</div>
  ),
}))

const ROSTER: ProfileSummary[] = [
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
]

function base(): StudioPageProps {
  return {
    view: 'agents',
    onViewChange: vi.fn(),
    connections: <div data-testid="stub-connections">connections surface</div>,
    profiles: ROSTER,
    loading: false,
    error: null,
    selectedAgent: 'mercury',
    selectedProfile: ROSTER[0]!,
    section: 'identity',
    launchpadStatus: { tone: 'ok', label: 'Connected', facts: [] },
    onSelectAgent: vi.fn(),
    onSectionChange: vi.fn(),
    onStartChat: vi.fn(),
    onNewAgent: vi.fn(),
    onCloneSelected: vi.fn(),
    onImport: vi.fn(),
    onRetry: vi.fn(),
  }
}

function renderPage(props = base()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudioPage {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('StudioPage', () => {
  it('renders the slim launchpad strip with Start a chat', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders the roster and the workbench for the selected agent', () => {
    renderPage()
    expect(screen.getByTestId('studio-roster-card-mercury')).toBeInTheDocument()
    expect(screen.getByTestId('stub-workbench')).toHaveTextContent('workbench for mercury')
  })

  it('shows a roster loading skeleton while the roster loads', () => {
    renderPage({ ...base(), loading: true, profiles: [], selectedAgent: null, selectedProfile: null })
    expect(screen.getByTestId('studio-loading')).toBeInTheDocument()
  })

  it('shows an error state with retry when the roster fails to load', () => {
    renderPage({ ...base(), error: 'down', profiles: [], selectedAgent: null, selectedProfile: null })
    expect(screen.getByText('down')).toBeInTheDocument()
  })

  it('does not render a workbench when no agent is selected (empty roster)', () => {
    renderPage({ ...base(), profiles: [], selectedAgent: null, selectedProfile: null })
    expect(screen.queryByTestId('stub-workbench')).not.toBeInTheDocument()
    // The roster's own empty state covers the "no agents" guidance.
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument()
  })

  it('reaches Connections from the launchpad action, NOT a top-level view switch', () => {
    renderPage()
    // The old [ Agents | Connections ] segmented control is gone.
    expect(screen.queryByRole('tablist', { name: /studio view/i })).not.toBeInTheDocument()
    // Connections is a quiet global action in the launchpad strip instead.
    expect(screen.getByRole('button', { name: /connections/i })).toBeInTheDocument()
  })

  it('shows the hero + roster on the Agents view, NOT the embedded connections surface', () => {
    renderPage()
    // The roster/workbench are present, and the global connections surface is not.
    expect(screen.getByTestId('studio-roster-card-mercury')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-connections')).not.toBeInTheDocument()
  })

  it('embeds the GLOBAL connections surface on the Connections view (roster hidden)', () => {
    renderPage({ ...base(), view: 'connections' })
    expect(screen.getByTestId('stub-connections')).toBeInTheDocument()
    // The roster/workbench + launchpad are not rendered in the Connections view.
    expect(screen.queryByTestId('studio-roster-card-mercury')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start a chat/i })).not.toBeInTheDocument()
    // An honest caption notes the global scope.
    expect(screen.getByText(/apply to all your agents/i)).toBeInTheDocument()
  })

  it('opens the Connections view from the launchpad Connections button', async () => {
    const onViewChange = vi.fn()
    renderPage({ ...base(), onViewChange })
    await userEvent.click(screen.getByRole('button', { name: /connections/i }))
    expect(onViewChange).toHaveBeenCalledWith('connections')
  })

  it('returns to the Agents view from the Connections back link', async () => {
    const onViewChange = vi.fn()
    renderPage({ ...base(), view: 'connections', onViewChange })
    await userEvent.click(screen.getByRole('button', { name: /^agent studio$/i }))
    expect(onViewChange).toHaveBeenCalledWith('agents')
  })
})

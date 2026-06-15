import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})

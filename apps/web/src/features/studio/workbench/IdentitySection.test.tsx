import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IdentitySection } from './IdentitySection'
import type { ProfileSummary } from '@/features/profiles/types'

const PROFILE: ProfileSummary = {
  name: 'mercury',
  displayPath: '~/.hermes/profiles/mercury',
  isDefault: false,
  isActive: false,
  model: 'claude-opus-4-8',
  provider: 'anthropic',
  hasEnv: true,
  skillCount: 3,
  gatewayRunning: true,
  avatar: null,
  displayName: 'Mercury',
}

function renderSection(profile: ProfileSummary = PROFILE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IdentitySection profile={profile} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IdentitySection', () => {
  it('shows the agent name + running and env status', () => {
    renderSection()
    expect(screen.getByText('Mercury')).toBeInTheDocument()
    expect(screen.getByText(/agent running/i)).toBeInTheDocument()
    expect(screen.getByText(/\.env present/i)).toBeInTheDocument()
  })

  it('offers a switch-to-this-agent affordance when not active', () => {
    renderSection()
    expect(screen.getByRole('button', { name: /switch to this agent/i })).toBeInTheDocument()
  })

  it('does NOT offer switch when this agent is already active', () => {
    renderSection({ ...PROFILE, isActive: true })
    expect(screen.queryByRole('button', { name: /switch to this agent/i })).not.toBeInTheDocument()
  })

  it('offers an edit-identity affordance (face + display name)', () => {
    renderSection()
    expect(screen.getByRole('button', { name: /edit.*identity/i })).toBeInTheDocument()
  })

  it('offers rename for a non-default agent', () => {
    renderSection()
    expect(screen.getByRole('button', { name: /rename/i })).toBeInTheDocument()
  })

  it('hides rename for the reserved default agent', () => {
    renderSection({ ...PROFILE, name: 'default', isDefault: true, displayName: null })
    expect(screen.queryByRole('button', { name: /rename/i })).not.toBeInTheDocument()
  })
})

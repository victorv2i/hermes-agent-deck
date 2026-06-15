import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudioRoster } from './StudioRoster'
import type { ProfileSummary } from '@/features/profiles/types'

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
  {
    name: 'default',
    displayPath: '~/.hermes',
    isDefault: true,
    isActive: false,
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    hasEnv: false,
    skillCount: 1,
    gatewayRunning: false,
    avatar: null,
    displayName: null,
  },
]

describe('StudioRoster', () => {
  it('renders an agent card per profile with name + model', () => {
    render(
      <StudioRoster
        profiles={ROSTER}
        selected="mercury"
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onCloneSelected={vi.fn()}
      />,
    )
    const mercury = screen.getByTestId('studio-roster-card-mercury')
    expect(within(mercury).getByText('Mercury')).toBeInTheDocument()
    expect(within(mercury).getByText('claude-opus-4-8')).toBeInTheDocument()
  })

  it('shows the Active and Default badges', () => {
    render(
      <StudioRoster
        profiles={ROSTER}
        selected="mercury"
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onCloneSelected={vi.fn()}
      />,
    )
    expect(within(screen.getByTestId('studio-roster-card-mercury')).getByText('Active')).toBeInTheDocument()
    expect(within(screen.getByTestId('studio-roster-card-default')).getByText('Default')).toBeInTheDocument()
  })

  it('marks the selected card with aria-current', () => {
    render(
      <StudioRoster
        profiles={ROSTER}
        selected="mercury"
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onCloneSelected={vi.fn()}
      />,
    )
    expect(screen.getByTestId('studio-roster-card-mercury')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('studio-roster-card-default')).not.toHaveAttribute('aria-current')
  })

  it('selecting a card fires onSelect with that agent', async () => {
    const onSelect = vi.fn()
    render(
      <StudioRoster
        profiles={ROSTER}
        selected="mercury"
        onSelect={onSelect}
        onNewAgent={vi.fn()}
        onCloneSelected={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByTestId('studio-roster-card-default'))
    expect(onSelect).toHaveBeenCalledWith('default')
  })

  it('offers New agent and Clone actions', async () => {
    const onNewAgent = vi.fn()
    const onCloneSelected = vi.fn()
    render(
      <StudioRoster
        profiles={ROSTER}
        selected="mercury"
        onSelect={vi.fn()}
        onNewAgent={onNewAgent}
        onCloneSelected={onCloneSelected}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /new agent/i }))
    expect(onNewAgent).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /clone/i }))
    expect(onCloneSelected).toHaveBeenCalledWith('mercury')
  })

  it('renders an empty state with a New agent action when there are no agents', () => {
    render(
      <StudioRoster
        profiles={[]}
        selected={null}
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onCloneSelected={vi.fn()}
      />,
    )
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument()
  })
})

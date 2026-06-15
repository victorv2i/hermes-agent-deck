import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SkillsSection } from './SkillsSection'
import type { StudioSkill } from '../data/api'

const SKILLS: StudioSkill[] = [
  { name: 'web-search', description: 'Search the web for answers.', category: 'research', enabled: true },
  { name: 'shell', description: 'Run shell commands in the workspace.', category: 'system', enabled: false },
]

describe('SkillsSection', () => {
  it('lists each skill as a collapsed row with name + category', () => {
    render(<SkillsSection skills={SKILLS} isLoading={false} error={null} onToggle={vi.fn()} />)
    expect(screen.getByText('web-search')).toBeInTheDocument()
    expect(screen.getByText('shell')).toBeInTheDocument()
    // The description is collapsed until the row is expanded.
    expect(screen.queryByText(/search the web for answers/i)).not.toBeInTheDocument()
  })

  it('reflects each skill enabled state on its switch', () => {
    render(<SkillsSection skills={SKILLS} isLoading={false} error={null} onToggle={vi.fn()} />)
    expect(screen.getByRole('switch', { name: /disable web-search/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: /enable shell/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('expands a row on click to reveal the description', async () => {
    render(<SkillsSection skills={SKILLS} isLoading={false} error={null} onToggle={vi.fn()} />)
    const row = screen.getByRole('button', { name: /web-search/i })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/search the web for answers/i)).toBeInTheDocument()
  })

  it('toggles a skill by name (no active-agent gate; any agent can be changed)', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<SkillsSection skills={SKILLS} isLoading={false} error={null} onToggle={onToggle} />)
    const sw = screen.getByRole('switch', { name: /enable shell/i })
    // The switch is NOT disabled regardless of which agent is selected.
    expect(sw).not.toBeDisabled()
    await userEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith('shell', true)
  })

  it('locks only the pending skill switch while its toggle is in flight', () => {
    render(
      <SkillsSection
        skills={SKILLS}
        isLoading={false}
        error={null}
        onToggle={vi.fn()}
        pending={new Set(['shell'])}
      />,
    )
    expect(screen.getByRole('switch', { name: /enable shell/i })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /disable web-search/i })).not.toBeDisabled()
  })

  it('surfaces an honest restart-to-apply note + the enabled count', () => {
    render(<SkillsSection skills={SKILLS} isLoading={false} error={null} onToggle={vi.fn()} />)
    expect(screen.getByText(/restart your agent to apply skill changes/i)).toBeInTheDocument()
    expect(screen.getByText(/1/)).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    render(<SkillsSection skills={undefined} isLoading error={null} onToggle={vi.fn()} />)
    expect(screen.getByTestId('studio-skills-skeleton')).toBeInTheDocument()
  })

  it('shows an error state with the message', () => {
    render(
      <SkillsSection
        skills={undefined}
        isLoading={false}
        error="The hermes dashboard may be offline."
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByText("Couldn't load skills")).toBeInTheDocument()
    expect(screen.getByText(/hermes dashboard may be offline/i)).toBeInTheDocument()
  })

  it('shows an empty state when the agent has no skills', () => {
    render(<SkillsSection skills={[]} isLoading={false} error={null} onToggle={vi.fn()} />)
    expect(screen.getByText('No skills yet')).toBeInTheDocument()
  })
})

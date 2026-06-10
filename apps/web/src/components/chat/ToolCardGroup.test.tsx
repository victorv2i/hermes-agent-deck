import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ToolCall } from '@/state/chatStore'
import { ToolCardGroup } from './ToolCardGroup'

const calls: ToolCall[] = [
  { tool: 'bash', status: 'completed', preview: 'ls', duration: 0.2 },
  { tool: 'web_search', status: 'completed', preview: 'cats', duration: 1.1 },
]

describe('ToolCardGroup', () => {
  it('renders one card per tool call', () => {
    render(<ToolCardGroup calls={calls} />)
    // Chips show the plain-language labels for the known tools.
    expect(screen.getByText('Run command')).toBeInTheDocument()
    expect(screen.getByText('Search the web')).toBeInTheDocument()
  })

  it('renders nothing for an empty turn', () => {
    const { container } = render(<ToolCardGroup calls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows no expand-all control for a single tool call', () => {
    render(<ToolCardGroup calls={[calls[0]!]} />)
    expect(screen.queryByRole('button', { name: /expand all/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collapse all/i })).not.toBeInTheDocument()
  })

  it('expands all cards, then collapses all, via one affordance', async () => {
    const user = userEvent.setup()
    render(<ToolCardGroup calls={calls} />)

    // All collapsed initially — affordance offers "Expand all".
    const panels = screen.getAllByTestId('toolcard-content')
    expect(panels.every((p) => p.getAttribute('data-state') === 'closed')).toBe(true)

    const expand = screen.getByRole('button', { name: /expand all/i })
    expect(expand.className).toContain('min-h-11')
    await user.click(expand)
    expect(
      screen
        .getAllByTestId('toolcard-content')
        .every((p) => p.getAttribute('data-state') === 'open'),
    ).toBe(true)

    // Now it offers "Collapse all".
    await user.click(screen.getByRole('button', { name: /collapse all/i }))
    expect(
      screen
        .getAllByTestId('toolcard-content')
        .every((p) => p.getAttribute('data-state') === 'closed'),
    ).toBe(true)
  })

  it('opens every card on mount when defaultOpen is set (detailed verbosity)', () => {
    render(<ToolCardGroup calls={calls} defaultOpen />)
    expect(
      screen
        .getAllByTestId('toolcard-content')
        .every((p) => p.getAttribute('data-state') === 'open'),
    ).toBe(true)
  })

  it('keeps the "Expand all" baseline label on mount even when defaultOpen seeds cards open', () => {
    // defaultOpen must NOT seed the group `forced` state, or the button would
    // mislabel as "Collapse all" on first paint.
    render(<ToolCardGroup calls={calls} defaultOpen />)
    expect(screen.getByRole('button', { name: /expand all/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collapse all/i })).not.toBeInTheDocument()
  })

  it('lets an individual card be toggled without breaking the group control', async () => {
    const user = userEvent.setup()
    render(<ToolCardGroup calls={calls} />)
    const triggers = screen.getAllByTestId('toolcard-trigger')
    await user.click(triggers[0]!)
    const panels = screen.getAllByTestId('toolcard-content')
    expect(panels[0]).toHaveAttribute('data-state', 'open')
    expect(panels[1]).toHaveAttribute('data-state', 'closed')
    // The group control still works afterwards.
    await user.click(screen.getByRole('button', { name: /expand all/i }))
    expect(
      screen
        .getAllByTestId('toolcard-content')
        .every((p) => p.getAttribute('data-state') === 'open'),
    ).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasoningBlock } from './ReasoningBlock'

describe('ReasoningBlock', () => {
  it('renders nothing when there are no segments', () => {
    const { container } = render(<ReasoningBlock segments={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed by default with a one-line summary of the thought', () => {
    render(<ReasoningBlock segments={['First I will inspect the files, then plan the fix.']} />)
    const trigger = screen.getByTestId('reasoning-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('reasoning-content')).toHaveAttribute('data-state', 'closed')
    // Collapsed summary previews the reasoning inline.
    expect(trigger).toHaveTextContent(/First I will inspect the files/)
  })

  it('truncates a long collapsed summary', () => {
    const long = 'x'.repeat(200)
    render(<ReasoningBlock segments={[long]} />)
    const trigger = screen.getByTestId('reasoning-trigger')
    expect(trigger).toHaveTextContent('…')
  })

  it('expands the full reasoning on click', async () => {
    const user = userEvent.setup()
    render(<ReasoningBlock segments={['step one', 'step two']} />)
    await user.click(screen.getByTestId('reasoning-trigger'))
    const content = screen.getByTestId('reasoning-content')
    expect(content).toHaveAttribute('data-state', 'open')
    expect(content).toHaveTextContent('step one')
    expect(content).toHaveTextContent('step two')
  })

  it('opens on mount when defaultOpen is set (detailed verbosity)', () => {
    render(<ReasoningBlock segments={['the full reasoning']} defaultOpen />)
    expect(screen.getByTestId('reasoning-trigger')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('reasoning-content')).toHaveAttribute('data-state', 'open')
  })

  it('joins multiple segments with " / " in the collapsed summary', () => {
    render(<ReasoningBlock segments={['inspect the files', 'plan the fix']} />)
    const trigger = screen.getByTestId('reasoning-trigger')
    expect(trigger).toHaveTextContent('inspect the files / plan the fix')
  })
})

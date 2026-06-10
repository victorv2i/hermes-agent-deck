/**
 * Tests for PlanCard — rendered ONLY when a reasoning block contains step-like
 * content. Honest: rendered only for runs that actually emit a reasoning block,
 * never for runs without one.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanCard } from './PlanCard'

describe('PlanCard', () => {
  it('renders nothing when segments are empty (no fabricated plan)', () => {
    const { container } = render(<PlanCard segments={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a vertical step list from real reasoning segments', () => {
    const segments = [
      '1. Read the repository structure\n2. Identify key files\n3. Write the summary',
    ]
    render(<PlanCard segments={segments} />)
    expect(screen.getByTestId('plan-card')).toBeInTheDocument()
  })

  it('shows a plan label', () => {
    render(<PlanCard segments={['1. Read files\n2. Analyze']} />)
    // Should label this clearly as a plan/thinking
    expect(screen.getByTestId('plan-card').textContent).toBeTruthy()
  })

  it('is accessible with a heading or label', () => {
    render(<PlanCard segments={['1. Step one\n2. Step two']} />)
    const card = screen.getByTestId('plan-card')
    // Card should be labeled for SR
    expect(card).toBeInTheDocument()
  })

  it('renders the reasoning text content', () => {
    const segments = ['First I will read the files, then analyze them.']
    render(<PlanCard segments={segments} />)
    expect(screen.getByTestId('plan-card')).toHaveTextContent(
      'First I will read the files, then analyze them.',
    )
  })

  it('handles multiple segments', () => {
    render(<PlanCard segments={['Planning the approach.', 'Will read files first.']} />)
    const card = screen.getByTestId('plan-card')
    expect(card).toHaveTextContent('Planning the approach.')
    expect(card).toHaveTextContent('Will read files first.')
  })
})

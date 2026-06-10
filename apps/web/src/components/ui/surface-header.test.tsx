import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SquareTerminal } from 'lucide-react'
import { SurfaceHeader } from './surface-header'

describe('SurfaceHeader', () => {
  it('renders the title as a level-1 heading', () => {
    render(<SurfaceHeader icon={SquareTerminal} title="Terminal" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Terminal' })).toBeInTheDocument()
  })

  it('renders the subtitle when provided', () => {
    render(<SurfaceHeader icon={SquareTerminal} title="Terminal" subtitle="workspace shell" />)
    expect(screen.getByText('workspace shell')).toBeInTheDocument()
  })

  it('renders the actions slot', () => {
    render(
      <SurfaceHeader
        icon={SquareTerminal}
        title="Terminal"
        actions={<span data-testid="dot">●</span>}
      />,
    )
    expect(screen.getByTestId('dot')).toBeInTheDocument()
  })

  it('marks the leading glyph decorative (icon, never emoji)', () => {
    const { container } = render(<SurfaceHeader icon={SquareTerminal} title="Files" />)
    const glyph = container.querySelector('[aria-hidden] svg')
    expect(glyph).not.toBeNull()
  })

  it('truncates long tool titles inside the dense header row', () => {
    render(
      <SurfaceHeader
        icon={SquareTerminal}
        title="Terminal attached to a very long generated workspace path"
        actions={<span data-testid="dot">●</span>}
      />,
    )
    expect(screen.getByRole('heading').className).toContain('truncate')
    expect(screen.getByTestId('dot').parentElement?.className).toContain('justify-end')
  })
})

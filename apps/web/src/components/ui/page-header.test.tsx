import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Boxes } from 'lucide-react'
import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('renders the title as a level-1 heading', () => {
    render(<PageHeader icon={Boxes} title="Models" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Models' })).toBeInTheDocument()
  })

  it('renders the subtitle when provided', () => {
    render(
      <PageHeader icon={Boxes} title="Models" subtitle="The models configured for your agent." />,
    )
    expect(screen.getByText('The models configured for your agent.')).toBeInTheDocument()
  })

  it('renders the actions slot', () => {
    render(
      <PageHeader
        icon={Boxes}
        title="Usage"
        actions={<button type="button">Last 30 days</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument()
  })

  it('marks the leading glyph decorative (icon, never emoji)', () => {
    const { container } = render(<PageHeader icon={Boxes} title="Settings" />)
    const glyph = container.querySelector('[aria-hidden] svg')
    expect(glyph).not.toBeNull()
  })

  it('stacks actions below the title on small screens to protect heading width', () => {
    render(
      <PageHeader
        icon={Boxes}
        title="A very long generated profile name that should wrap instead of pushing the viewport"
        actions={<button type="button">Action</button>}
      />,
    )
    expect(screen.getByRole('heading').className).toContain('break-words')
    const actions = screen.getByRole('button', { name: 'Action' }).parentElement
    expect(actions?.className).toContain('w-full')
    expect(actions?.className).toContain('sm:w-auto')
    expect(actions?.className).toContain('max-sm:[&_[data-slot=button]]:min-h-11')
  })
})

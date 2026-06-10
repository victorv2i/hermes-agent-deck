import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, badgeVariants } from './badge'

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge>12</Badge>)
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('uses tabular-nums so numeric chips do not shimmy (P2.6)', () => {
    // The base vocabulary carries fixed-width digits regardless of variant.
    expect(badgeVariants()).toContain('tabular-nums')
    expect(badgeVariants({ variant: 'muted' })).toContain('tabular-nums')
  })

  it('uses the canonical .ad-focus ring (consistent focus app-wide, P1.9)', () => {
    expect(badgeVariants()).toContain('ad-focus')
    // The ad-hoc ring width/alpha is gone — focus is owned by the shared utility.
    expect(badgeVariants()).not.toContain('focus-visible:ring-[3px]')
  })
})

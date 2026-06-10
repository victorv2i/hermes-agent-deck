import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  it('renders a decorative shimmer block', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)
    const el = container.firstElementChild as HTMLElement
    expect(el).not.toBeNull()
    expect(el.className).toContain('ad-skeleton-shimmer')
    expect(el.className).toContain('h-4')
    expect(el.className).toContain('rounded')
    // Decorative: not announced to AT (the container owns aria-busy).
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a circle variant', () => {
    const { container } = render(<Skeleton circle className="size-11" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('rounded-full')
    expect(el.className).not.toMatch(/\brounded\b(?!-full)/)
  })

  it('injects the scoped shimmer style exactly once', () => {
    render(
      <>
        <Skeleton />
        <Skeleton />
      </>,
    )
    const styles = document.querySelectorAll('#ad-skeleton-shimmer-style')
    expect(styles).toHaveLength(1)
    // The keyframe + the reduced-motion gate are present in the scoped CSS.
    expect(styles[0]!.textContent).toContain('@keyframes ad-skeleton-shimmer')
    expect(styles[0]!.textContent).toContain('prefers-reduced-motion: no-preference')
    // Neutral only — never the accent.
    expect(styles[0]!.textContent).not.toContain('--primary')
  })

  it('keeps the decorative primitive hidden even if incidental aria props are passed', () => {
    const { getByTestId } = render(<Skeleton data-testid="sk" aria-hidden={false} />)

    expect(getByTestId('sk')).toHaveAttribute('aria-hidden', 'true')
  })

  it('forwards extra props (e.g. data-testid)', () => {
    const { getByTestId } = render(<Skeleton data-testid="sk" />)
    expect(getByTestId('sk')).toBeInTheDocument()
  })
})

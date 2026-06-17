import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConnectionDot } from './ConnectionDot'

/**
 * The header connection dot is a SEMANTIC status indicator built on the shared
 * {@link StatusDot} primitive, never the action accent (design spine §2): a
 * *connection* being online is SUCCESS (a calm round green dot, not the live
 * accent), connecting is the in-progress `info` heartbeat (pulsing), offline is
 * `error`. The non-OK states carry a distinguishing SHAPE (not a hue alone) so a
 * colorblind / at-a-glance operator can't conflate them with the live sky-blue
 * accent. The chrome contract is preserved: `connection-dot` testid + a
 * `data-status` attribute.
 */
function dot() {
  return screen.getByTestId('connection-dot')
}
function marker() {
  return dot().querySelector('[data-slot="status-dot-marker"]')!
}

describe('ConnectionDot', () => {
  it('keeps the chrome contract: connection-dot testid + data-status + an SR label', () => {
    render(<ConnectionDot status="online" />)
    expect(dot()).toHaveAttribute('data-status', 'online')
    expect(dot()).toHaveAttribute('aria-label', 'Connected')
  })

  it('online uses the success semantic, a calm round dot, not the action accent', () => {
    render(<ConnectionDot status="online" />)
    expect(marker()).toHaveClass('bg-success')
    expect(marker().className).not.toMatch(/\bbg-primary\b/)
    // A connection being connected is calm — no shape glyph, no pulse.
    expect(screen.queryByTestId('status-dot-shape')).not.toBeInTheDocument()
    expect(marker().className).not.toContain('animate-pulse')
  })

  it('connecting uses the info (in-progress) semantic, pulsing, with a shape cue', () => {
    render(<ConnectionDot status="connecting" />)
    const m = marker()
    expect(m).toHaveClass('text-info')
    expect(m).toHaveClass('motion-safe:animate-pulse')
    expect(m.className).not.toMatch(/\bbg-primary\b/)
    expect(screen.getByTestId('status-dot-shape')).toBeInTheDocument()
  })

  it('offline uses the destructive semantic with a shape cue', () => {
    render(<ConnectionDot status="offline" />)
    expect(marker()).toHaveClass('text-destructive')
    expect(marker().className).not.toMatch(/\bbg-primary\b/)
    expect(screen.getByTestId('status-dot-shape')).toBeInTheDocument()
  })
})

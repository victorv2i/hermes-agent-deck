import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusDot, type StatusTone } from './StatusDot'

/**
 * StatusDot is the ONE governed status-dot primitive (design spine §2): tone →
 * SEMANTIC color, never the action accent — EXCEPT the sanctioned `live` stream
 * pulse, which is the one place a dot may carry the `--primary` accent (a live
 * data stream IS "live/active state"). Non-OK tones also carry a SHAPE cue (not a
 * hue alone) so a colorblind / at-a-glance operator can't conflate a degraded
 * state with the live accent, mirroring the original ActiveRecentlyBand markers.
 */

// The governed semantic hue per tone. ok + idle are calm round dots (bg-*); the
// alerting tones (info/warn/error) are shape glyphs colored via text-*.
const TONE_HUE: Record<StatusTone, string> = {
  ok: 'bg-success',
  idle: 'bg-foreground-tertiary',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-destructive',
}

describe('StatusDot', () => {
  it('maps each tone to its SEMANTIC color, never the action accent', () => {
    for (const [tone, hue] of Object.entries(TONE_HUE) as [StatusTone, string][]) {
      const { unmount } = render(<StatusDot tone={tone} label={`${tone} state`} />)
      const dot = screen.getByTestId('status-dot')
      // The marker (round dot for ok/idle, shape glyph for the rest) carries the hue.
      const marker = dot.querySelector('[data-slot="status-dot-marker"]')!
      expect(marker.className).toContain(hue)
      expect(marker.className).not.toMatch(/\bbg-primary\b/)
      expect(marker.className).not.toMatch(/\btext-primary\b/)
      unmount()
    }
  })

  it('renders a SHAPE cue (not a hue alone) for every non-OK tone', () => {
    // ok + idle are calm round dots (no shape glyph); the alerting tones get a
    // distinct shape so the state is legible without color.
    for (const tone of ['ok', 'idle'] as const) {
      const { unmount } = render(<StatusDot tone={tone} label={`${tone}`} />)
      expect(screen.queryByTestId('status-dot-shape')).not.toBeInTheDocument()
      unmount()
    }
    for (const tone of ['info', 'warn', 'error'] as const) {
      const { unmount } = render(<StatusDot tone={tone} label={`${tone}`} />)
      expect(screen.getByTestId('status-dot-shape')).toBeInTheDocument()
      unmount()
    }
  })

  it('exposes the label to assistive tech and reflects the tone on data-tone', () => {
    render(<StatusDot tone="error" label="Gateway down" />)
    const dot = screen.getByTestId('status-dot')
    expect(dot).toHaveAttribute('data-tone', 'error')
    expect(screen.getByRole('img', { name: 'Gateway down' })).toBeInTheDocument()
  })

  it('pulses only when asked, and only motion-safely', () => {
    const { rerender } = render(<StatusDot tone="ok" label="Live" pulse />)
    const marker = () => screen.getByTestId('status-dot').querySelector('[data-slot="status-dot-marker"]')!
    expect(marker().className).toContain('motion-safe:animate-pulse')
    rerender(<StatusDot tone="ok" label="Connected" />)
    expect(marker().className).not.toContain('animate-pulse')
  })

  it('uses the SANCTIONED live accent (not a semantic hue) only when live', () => {
    // The one governed exception: a genuine live data-stream dot may carry the
    // --primary action/live accent. It is opt-in via `live` and pairs with pulse.
    render(<StatusDot tone="ok" label="Live" live pulse />)
    const marker = screen.getByTestId('status-dot').querySelector('[data-slot="status-dot-marker"]')!
    expect(marker.className).toContain('bg-primary')
    expect(marker.className).toContain('motion-safe:animate-pulse')
  })
})

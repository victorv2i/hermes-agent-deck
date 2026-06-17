import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import {
  platformIcon,
  hasBrandMark,
  DEFAULT_PLATFORM_ICON,
  NEUTRAL_PLATFORM_IDS,
} from './platformIcons'

/**
 * The Messaging hub uses BRAND MARKS for identity — ACCURATE official path data
 * from the CC0-licensed `simple-icons` package (telegram/discord/whatsapp/signal),
 * with a clean lettermark fallback for a platform absent from simple-icons (Slack).
 * The spine: brand logos are identity, rendered in their OWN brand colors, NEVER
 * wired to the sky-blue `--primary` accent. These tests pin:
 *  - each real platform resolves to a labelled brand SVG;
 *  - brand marks carry a hard-coded brand-color hex (true identity, not a token,
 *    not the sky-blue accent);
 *  - email/SMTP + unknown ids fall back to a neutral glyph (no garbled guess).
 */

const BRAND_PLATFORMS = ['telegram', 'discord', 'slack', 'whatsapp', 'signal'] as const

describe('platformIcon — local-SVG brand marks (identity, brand colors)', () => {
  it.each(BRAND_PLATFORMS)('resolves %s to a labelled brand SVG mark', (id) => {
    const Icon = platformIcon(id)
    const { container } = render(createElement(Icon, { className: 'size-5' }))
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    // The mark identifies the platform by name (nominative use).
    expect(svg?.getAttribute('aria-label')?.toLowerCase()).toContain(
      id === 'whatsapp' ? 'whatsapp' : id,
    )
  })

  it.each(BRAND_PLATFORMS)('renders %s in its OWN brand color, NEVER the amber accent', (id) => {
    const Icon = platformIcon(id)
    const { container } = render(createElement(Icon))
    const markup = container.innerHTML
    // A hard-coded brand-color hex is present — true brand identity.
    expect(markup).toMatch(/fill="#[0-9A-Fa-f]{6}"/)
    // The spine: a brand logo is NEVER wired to the sky-blue action accent.
    expect(markup).not.toContain('--primary')
    expect(markup).not.toContain('text-primary')
    expect(markup).not.toContain('bg-primary')
    expect(markup).not.toContain('fill-primary')
  })

  it('these platforms report as real brand marks (not neutral fallbacks)', () => {
    for (const id of BRAND_PLATFORMS) expect(hasBrandMark(id)).toBe(true)
  })

  it.each(['telegram', 'discord', 'whatsapp', 'signal'] as const)(
    'renders %s as an accurate simple-icons glyph (a substantial fill path, not hand-drawn)',
    (id) => {
      const Icon = platformIcon(id)
      const { container } = render(createElement(Icon))
      const path = container.querySelector('path')
      expect(path).not.toBeNull()
      // simple-icons marks are a single long official path (hundreds of chars).
      expect((path?.getAttribute('d') ?? '').length).toBeGreaterThan(200)
    },
  )

  it('email/SMTP falls back to a NEUTRAL glyph (no single email brand to guess)', () => {
    expect(NEUTRAL_PLATFORM_IDS.has('email')).toBe(true)
    expect(hasBrandMark('email')).toBe(false)
    const Icon = platformIcon('email')
    const { container } = render(createElement(Icon))
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('an unknown platform id falls back to the generic chat glyph (never throws)', () => {
    expect(platformIcon('mastodon')).toBe(DEFAULT_PLATFORM_ICON)
    expect(hasBrandMark('mastodon')).toBe(false)
    const Icon = platformIcon('mastodon')
    const { container } = render(createElement(Icon))
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

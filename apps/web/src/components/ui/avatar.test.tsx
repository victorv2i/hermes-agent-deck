import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BUILTIN_AVATAR_IDS } from '@agent-deck/protocol'
import { Avatar } from './avatar'

describe('Avatar primitive', () => {
  it('resolves all 6 built-in faces to their served webp with an accessible name (labeled)', () => {
    expect(BUILTIN_AVATAR_IDS).toHaveLength(6)
    for (const id of BUILTIN_AVATAR_IDS) {
      const label = `Avatar ${id}`
      const { unmount } = render(<Avatar avatarId={id} name="" label={label} />)
      const img = screen.getByAltText(label) as HTMLImageElement
      expect(img.getAttribute('src')).toBe(`/avatars/${id}.webp`)
      unmount()
    }
  })

  it('renders the built-in face as an <img> with the served webp src', () => {
    render(<Avatar avatarId="v3" name="Atlas" />)
    const img = document.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/avatars/v3.webp')
    // <img> (not <svg>) so it escapes the ⌘K active-row svg amber tint.
    expect(img.tagName.toLowerCase()).toBe('img')
  })

  it('sits the centered bust cleanly in the circle (cover, top-anchored, no letterboxing)', () => {
    const { container } = render(<Avatar avatarId="v2" name="Atlas" />)
    const img = document.querySelector('img')!
    // object-cover fills the round frame edge-to-edge (no contain/letterbox gaps),
    // and object-top keeps the crown of the head from being clipped.
    expect(img.className).toContain('object-cover')
    expect(img.className).toContain('object-top')
    expect(img.className).not.toContain('object-contain')
    // The frame is a SQUARE rounded-full crest, so the cover crop is symmetric.
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('rounded-full')
    expect(frame.className).toContain('overflow-hidden')
  })

  it('is decorative by default (aria-hidden, empty alt — the name carries meaning)', () => {
    render(<Avatar avatarId="v1" name="Atlas" />)
    const img = document.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
  })

  it('exposes an accessible name in labeled (picker) mode', () => {
    render(<Avatar avatarId="v2" name="" label="Avatar option 2 of 6" />)
    expect(screen.getByAltText('Avatar option 2 of 6')).toBeTruthy()
  })

  it('GOVERNANCE: never paints identity with the amber accent', () => {
    const { container } = render(<Avatar avatarId="v3" name="Iris" />)
    const html = container.innerHTML
    expect(html).not.toContain('text-primary')
    expect(html).not.toContain('bg-primary')
    expect(html).not.toContain('ring-ring')
    // figure-ground hairline uses the neutral strong border token, not --ring.
    expect(html).toContain('var(--border-strong)')
  })

  it('falls back to a NEUTRAL lettermark when the image fails to load', () => {
    render(<Avatar avatarId="v2" name="juno" />)
    fireEvent.error(document.querySelector('img')!)
    expect(screen.getByText('J')).toBeTruthy()
    // the fallback is never the accent color
    expect(document.body.innerHTML).not.toContain('text-primary')
  })

  it('maps the size enum to the matching dimension class', () => {
    const { container } = render(<Avatar avatarId="v1" name="A" size={44} />)
    expect(container.firstElementChild!.className).toContain('size-11')
  })
})

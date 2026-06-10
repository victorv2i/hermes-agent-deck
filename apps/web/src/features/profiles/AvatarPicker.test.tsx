import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BUILTIN_AVATAR_IDS } from '@agent-deck/protocol'
import { AvatarPicker } from './AvatarPicker'

describe('AvatarPicker', () => {
  it('renders a labeled radiogroup with one radio per built-in face', () => {
    render(<AvatarPicker value="v1" name="atlas" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: /choose a face/i })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(BUILTIN_AVATAR_IDS.length)
    expect(radios).toHaveLength(6)
  })

  it('marks the selected face checked and exposes each face an accessible name', () => {
    render(<AvatarPicker value="v3" name="atlas" onChange={() => {}} />)
    const selected = screen.getByRole('radio', { name: /face 3 of 6/i })
    expect(selected).toBeChecked()
    expect(screen.getByRole('radio', { name: /face 1 of 6/i })).not.toBeChecked()
  })

  it('selecting a face calls onChange with its id (keyboard reachable)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AvatarPicker value="v1" name="atlas" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: /face 3 of 6/i }))
    expect(onChange).toHaveBeenCalledWith('v3')
  })

  it('the selected ring uses the identity token, NEVER the amber --ring/--primary', () => {
    const { container } = render(<AvatarPicker value="v2" name="atlas" onChange={() => {}} />)
    // The selected tile's ring is border-strong; no identity styling reaches for ring-ring/primary.
    const selectedRing = container.querySelector('span.ring-2')!
    expect(selectedRing.className).toMatch(/ring-\[var\(--border-strong\)\]/)
    expect(selectedRing.className).not.toMatch(/(?:^|\s)ring-ring(?:\/|\s|$)/)
    expect(selectedRing.className).not.toMatch(/ring-primary/)
  })
})

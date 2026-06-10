/**
 * a11y — VoiceToggle touch target.
 *
 * The toggle switch is h-6 (24px) — below the 44px AA touch-target minimum.
 * WCAG 2.5.5 requires >=44px interactive surface. The switch needs a
 * min-h-11 min-w-11 touch-manipulation wrapper on mobile (sm: can revert to
 * the native 24px pill size).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Volume2 } from 'lucide-react'
import { VoiceToggle } from './VoiceToggle'

describe('VoiceToggle touch target (a11y)', () => {
  it('switch has min-h-11 for 44px touch target on mobile', () => {
    render(
      <VoiceToggle
        icon={Volume2}
        label="Speak replies automatically"
        hint="Auto TTS hint"
        checked={false}
        onChange={() => {}}
      />,
    )
    const sw = screen.getByRole('switch', { name: /speak replies automatically/i })
    // On mobile the switch itself must be at least 44px tall.
    expect(sw.className).toContain('min-h-11')
  })

  it('switch has min-w-11 for 44px touch target width on mobile', () => {
    render(
      <VoiceToggle
        icon={Volume2}
        label="Beep on record"
        hint="Beep hint"
        checked={true}
        onChange={() => {}}
      />,
    )
    const sw = screen.getByRole('switch', { name: /beep on record/i })
    expect(sw.className).toContain('min-w-11')
  })
})

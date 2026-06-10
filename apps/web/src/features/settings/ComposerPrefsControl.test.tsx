import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerPrefsControl } from './ComposerPrefsControl'
import {
  SEND_KEY_STORAGE_KEY,
  DEFAULT_SEND_KEY,
  getSendKeyPref,
  setSendKeyPref,
} from '@/features/chat-input/sendKeyPref'
import { VOICE_PREFS_STORAGE_KEY, getVoicePrefs, setVoicePrefs } from '@/features/voice'

// Reset both Foundation stores (module-level singletons) and storage so each
// test starts from the documented defaults: Enter sends, auto-speak OFF.
beforeEach(() => {
  localStorage.clear()
  setSendKeyPref(DEFAULT_SEND_KEY)
  setVoicePrefs({ autoSpeak: false })
  localStorage.clear()
})

afterEach(() => {
  setSendKeyPref(DEFAULT_SEND_KEY)
  setVoicePrefs({ autoSpeak: false })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ComposerPrefsControl', () => {
  it('renders an accessible send-key radiogroup and an auto-speak switch', () => {
    render(<ComposerPrefsControl />)

    const group = screen.getByRole('radiogroup', { name: /send key/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(screen.getByRole('radio', { name: /^enter sends$/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ctrl\+enter sends/i })).toBeInTheDocument()

    expect(screen.getByRole('switch', { name: /auto-speak replies/i })).toBeInTheDocument()
  })

  it('gives each send-key segment a 44px mobile touch target (relaxed on sm+)', () => {
    render(<ComposerPrefsControl />)
    const group = screen.getByRole('radiogroup', { name: /send key/i })
    for (const radio of within(group).getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 for compact desktop.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })

  it('reflects the defaults: Enter sends checked, auto-speak off', () => {
    render(<ComposerPrefsControl />)
    expect(screen.getByRole('radio', { name: /^enter sends$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: /ctrl\+enter sends/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('switch', { name: /auto-speak replies/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('switching the send key persists to the store and reflects the selection', async () => {
    const user = userEvent.setup()
    render(<ComposerPrefsControl />)

    await user.click(screen.getByRole('radio', { name: /ctrl\+enter sends/i }))

    // Store + persistence updated…
    expect(getSendKeyPref()).toBe('mod-enter')
    expect(localStorage.getItem(SEND_KEY_STORAGE_KEY)).toBe('mod-enter')
    // …and the selection moves.
    expect(screen.getByRole('radio', { name: /ctrl\+enter sends/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: /^enter sends$/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('switching back to Enter sends persists and reflects', async () => {
    const user = userEvent.setup()
    render(<ComposerPrefsControl />)

    await user.click(screen.getByRole('radio', { name: /ctrl\+enter sends/i }))
    await user.click(screen.getByRole('radio', { name: /^enter sends$/i }))

    expect(getSendKeyPref()).toBe('enter')
    expect(localStorage.getItem(SEND_KEY_STORAGE_KEY)).toBe('enter')
    expect(screen.getByRole('radio', { name: /^enter sends$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('toggling auto-speak on persists to the voice store and reflects', async () => {
    const user = userEvent.setup()
    render(<ComposerPrefsControl />)

    await user.click(screen.getByRole('switch', { name: /auto-speak replies/i }))

    expect(getVoicePrefs().autoSpeak).toBe(true)
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_STORAGE_KEY)!)).toEqual({ autoSpeak: true })
    expect(screen.getByRole('switch', { name: /auto-speak replies/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('toggling auto-speak off again persists and reflects', async () => {
    const user = userEvent.setup()
    render(<ComposerPrefsControl />)

    const sw = screen.getByRole('switch', { name: /auto-speak replies/i })
    await user.click(sw)
    await user.click(sw)

    expect(getVoicePrefs().autoSpeak).toBe(false)
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_STORAGE_KEY)!)).toEqual({ autoSpeak: false })
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('reflects an external store change (shared subscription)', async () => {
    render(<ComposerPrefsControl />)
    // Drive both stores from outside the component.
    setSendKeyPref('mod-enter')
    setVoicePrefs({ autoSpeak: true })

    expect(await screen.findByRole('radio', { name: /ctrl\+enter sends/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: /auto-speak replies/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})

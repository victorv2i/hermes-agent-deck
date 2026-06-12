import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  HOLD_REPEAT_DELAY_MS,
  HOLD_REPEAT_INTERVAL_MS,
  MobileKeyBar,
  type MobileKeyBarProps,
} from './MobileKeyBar'

/**
 * The touch key bar in isolation: single-tap emits, hold-repeat on arrows/Tab,
 * and the Paste path (clipboard success, denial, and the no-clipboard-API
 * insecure-context fallback). The socket input sink is stubbed via `onKey` /
 * `onPaste` — the same seam TerminalView wires to the wire.
 */

function renderBar(overrides: Partial<MobileKeyBarProps> = {}) {
  const onKey = vi.fn()
  const onPaste = vi.fn()
  render(
    <MobileKeyBar
      onKey={onKey}
      onPaste={onPaste}
      ctrlArmed={false}
      onCtrlToggle={vi.fn()}
      {...overrides}
    />,
  )
  return { onKey, onPaste }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MobileKeyBar', () => {
  it('renders the full key row including Paste', () => {
    renderBar()
    const bar = screen.getByRole('toolbar', { name: /terminal touch keys/i })
    for (const name of [
      'Escape',
      'Tab',
      'Shift Tab',
      'Control modifier',
      'Arrow up',
      'Arrow down',
      'Arrow left',
      'Arrow right',
      'Control C',
      'Paste',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(bar).toBeInTheDocument()
  })

  it('a single tap on an arrow emits its sequence exactly once (no repeat double-fire)', () => {
    vi.useFakeTimers()
    const { onKey } = renderBar()
    const up = screen.getByRole('button', { name: 'Arrow up' })
    // A real tap: pointerdown (the emit) → pointerup → the synthetic click.
    fireEvent.pointerDown(up)
    fireEvent.pointerUp(up)
    fireEvent.click(up)
    expect(onKey).toHaveBeenCalledTimes(1)
    expect(onKey).toHaveBeenCalledWith('\x1b[A')
    // No stray repeat timer keeps firing after the tap.
    act(() => {
      vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 10)
    })
    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('holding an arrow repeats: initial delay, then one emit per interval', () => {
    vi.useFakeTimers()
    const { onKey } = renderBar()
    const down = screen.getByRole('button', { name: 'Arrow down' })
    fireEvent.pointerDown(down)
    expect(onKey).toHaveBeenCalledTimes(1) // immediate emit on press
    // Hold past the delay plus three intervals → at least three repeats land.
    act(() => {
      vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 3)
    })
    expect(onKey.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(onKey.mock.calls.every(([data]) => data === '\x1b[B')).toBe(true)
    // Releasing stops the repeat cold.
    fireEvent.pointerUp(down)
    const settled = onKey.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onKey).toHaveBeenCalledTimes(settled)
  })

  it('the repeat cancels when the pointer leaves the key', () => {
    vi.useFakeTimers()
    const { onKey } = renderBar()
    const left = screen.getByRole('button', { name: 'Arrow left' })
    fireEvent.pointerDown(left)
    act(() => {
      vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS)
    })
    fireEvent.pointerLeave(left)
    const settled = onKey.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onKey).toHaveBeenCalledTimes(settled)
  })

  it('Tab hold-repeats too', () => {
    vi.useFakeTimers()
    const { onKey } = renderBar()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Tab' }))
    act(() => {
      vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 3)
    })
    expect(onKey.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(onKey.mock.calls.every(([data]) => data === '\t')).toBe(true)
  })

  it('non-repeat keys still emit once per tap and never start a repeat', () => {
    vi.useFakeTimers()
    const { onKey } = renderBar()
    const esc = screen.getByRole('button', { name: 'Escape' })
    fireEvent.pointerDown(esc)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onKey).not.toHaveBeenCalled() // a non-repeat key emits on the click
    fireEvent.click(esc)
    expect(onKey).toHaveBeenCalledTimes(1)
    expect(onKey).toHaveBeenCalledWith('\x1b')
  })

  it('keyboard activation (click without a pointerdown) still emits a repeat key', () => {
    const { onKey } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Arrow right' }))
    expect(onKey).toHaveBeenCalledTimes(1)
    expect(onKey).toHaveBeenCalledWith('\x1b[C')
  })

  it('Paste reads the clipboard and hands the text to the paste path', async () => {
    const { onPaste, onKey } = renderBar({ readClipboardText: async () => 'ls -la\n' })
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    await waitFor(() => expect(onPaste).toHaveBeenCalledWith('ls -la\n'))
    expect(onKey).not.toHaveBeenCalled() // raw text, never the key/Ctrl path
  })

  it('an empty clipboard pastes nothing (and shows no notice)', async () => {
    const { onPaste } = renderBar({ readClipboardText: async () => '' })
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    await act(async () => {})
    expect(onPaste).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a denied clipboard read shows the quiet "Clipboard unavailable" notice', async () => {
    const { onPaste } = renderBar({
      readClipboardText: async () => {
        throw new Error('denied')
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Clipboard unavailable')
    expect(onPaste).not.toHaveBeenCalled()
  })

  it('without a clipboard API at all (insecure context) the notice shows, no crash', async () => {
    // jsdom has no navigator.clipboard — exactly the insecure-context shape.
    const { onPaste } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Clipboard unavailable')
    expect(onPaste).not.toHaveBeenCalled()
  })
})

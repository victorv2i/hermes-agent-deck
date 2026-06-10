import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { HatchCeremony } from './HatchCeremony'

describe('HatchCeremony', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces the hatched agent name in a live region', () => {
    render(<HatchCeremony name="nova" avatar="v3" onDone={() => {}} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/nova has hatched/i)
  })

  it('auto-dismisses (calls onDone) after the ceremony hold has time to breathe', () => {
    const onDone = vi.fn()
    render(<HatchCeremony name="nova" avatar="v3" onDone={onDone} />)
    expect(onDone).not.toHaveBeenCalled()
    // The hold now outlasts the ~1.1s particle burst so it settles before
    // advancing: at 2000ms it must NOT have fired yet…
    act(() => vi.advanceTimersByTime(2000))
    expect(onDone).not.toHaveBeenCalled()
    // …and it fires once the full ~2400ms hold elapses.
    act(() => vi.advanceTimersByTime(500))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('dismisses early on click', () => {
    const onDone = vi.fn()
    render(<HatchCeremony name="nova" avatar="v3" onDone={onDone} />)
    fireEvent.click(screen.getByRole('status'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('dismisses early on Escape', () => {
    const onDone = vi.fn()
    render(<HatchCeremony name="nova" avatar="v3" onDone={onDone} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

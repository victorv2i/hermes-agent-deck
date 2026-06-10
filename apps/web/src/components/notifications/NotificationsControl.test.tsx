import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  setNotificationsEnabled,
  getNotificationsEnabled,
  type NotificationPermissionStatus,
} from './notificationPref'
import { NotificationsControl } from './NotificationsControl'

/**
 * The honest notifications toggle. It must:
 *  - render an accessible on/off switch bound to the local preference,
 *  - show the REAL browser permission status (granted / default / denied /
 *    unsupported) and never claim it will notify when the browser said no,
 *  - render an honest "only while a tab is open" boundary (no off-device promise).
 *
 * `permission` is injected so the test drives each browser state hermetically.
 */
function renderControl(perm: NotificationPermissionStatus, requestPermission = vi.fn()) {
  return render(
    <NotificationsControl permission={() => perm} requestPermission={requestPermission} />,
  )
}

describe('NotificationsControl', () => {
  beforeEach(() => {
    localStorage.clear()
    setNotificationsEnabled(true)
  })
  afterEach(() => {
    setNotificationsEnabled(true)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders an on/off switch reflecting the enabled preference', () => {
    setNotificationsEnabled(true)
    renderControl('granted')
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  it('toggling the switch persists the preference', async () => {
    const user = userEvent.setup()
    setNotificationsEnabled(true)
    renderControl('granted')
    const sw = screen.getByRole('switch')
    await user.click(sw)
    expect(getNotificationsEnabled()).toBe(false)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('shows the granted status honestly when permission is granted', () => {
    renderControl('granted')
    // The real granted state is surfaced (we don't fake "will notify" copy).
    expect(screen.getByText(/notifications are allowed/i)).toBeInTheDocument()
  })

  it('shows an honest BLOCKED state and disables the switch when permission is denied', () => {
    setNotificationsEnabled(true)
    renderControl('denied')
    // Honest: the browser blocked it — we must NOT claim we will notify.
    expect(screen.getByText(/blocked/i)).toBeInTheDocument()
    const sw = screen.getByRole('switch')
    // The switch is honestly disabled — flipping the pref can't make it notify.
    expect(sw).toBeDisabled()
  })

  it('offers to request permission when the browser has not been asked (default)', async () => {
    const user = userEvent.setup()
    const requestPermission = vi.fn().mockResolvedValue('granted')
    renderControl('default', requestPermission)
    const enableBtn = screen.getByRole('button', { name: /enable browser notifications/i })
    await user.click(enableBtn)
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('shows an unsupported state (no fake promise) when the API is absent', () => {
    renderControl('unsupported')
    expect(screen.getByText(/doesn’t support|does not support|not supported/i)).toBeInTheDocument()
    const sw = screen.getByRole('switch')
    expect(sw).toBeDisabled()
  })

  it('states the honest only-while-open boundary (no off-device claim)', () => {
    renderControl('granted')
    expect(
      screen.getByText(/only while .*tab is open|only when .*tab is open|open in a tab/i),
    ).toBeInTheDocument()
  })

  it('reflects an external pref change (stays in sync with the store)', () => {
    setNotificationsEnabled(true)
    renderControl('granted')
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    act(() => setNotificationsEnabled(false))
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  NOTIFICATIONS_ENABLED_STORAGE_KEY,
  getNotificationsEnabled,
  setNotificationsEnabled,
  useNotificationsEnabled,
  readNotificationPermission,
} from './notificationPref'

/**
 * The local enable/disable preference for run notifications, plus an honest read
 * of the browser's real Notification.permission. Mirrors the density/send-key
 * module stores: localStorage-backed, no React provider.
 */
describe('notificationPref', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset to the default for each test (the module store is process-wide).
    setNotificationsEnabled(true)
  })
  afterEach(() => {
    setNotificationsEnabled(true)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults to enabled when nothing is stored', () => {
    localStorage.clear()
    // A fresh read with no stored value resolves to the enabled default.
    setNotificationsEnabled(true)
    expect(getNotificationsEnabled()).toBe(true)
  })

  it('persists the choice to localStorage and reflects it via the getter', () => {
    setNotificationsEnabled(false)
    expect(getNotificationsEnabled()).toBe(false)
    expect(localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('false')

    setNotificationsEnabled(true)
    expect(getNotificationsEnabled()).toBe(true)
    expect(localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('true')
  })

  it('notifies subscribers so the hook stays reactive', () => {
    const { result } = renderHook(() => useNotificationsEnabled())
    expect(result.current.enabled).toBe(true)
    act(() => result.current.setEnabled(false))
    expect(result.current.enabled).toBe(false)
    act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(true)
  })

  it('tolerates a localStorage that throws on write (still updates the in-memory value)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setNotificationsEnabled(false)).not.toThrow()
    expect(getNotificationsEnabled()).toBe(false)
  })

  describe('readNotificationPermission (honest browser state)', () => {
    it('reports "unsupported" when the Notification API is absent', () => {
      // No `Notification` on the provided global.
      expect(readNotificationPermission({})).toBe('unsupported')
    })

    it('mirrors the real Notification.permission when present', () => {
      expect(readNotificationPermission({ Notification: { permission: 'granted' } })).toBe(
        'granted',
      )
      expect(readNotificationPermission({ Notification: { permission: 'denied' } })).toBe('denied')
      expect(readNotificationPermission({ Notification: { permission: 'default' } })).toBe(
        'default',
      )
    })

    it('treats a throwing/locked-down global as unsupported', () => {
      const hostile = {
        get Notification(): never {
          throw new Error('locked down')
        },
      }
      expect(readNotificationPermission(hostile)).toBe('unsupported')
    })
  })
})

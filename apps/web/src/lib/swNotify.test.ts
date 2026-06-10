import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  registerNotificationServiceWorker,
  getActiveSwRegistration,
  setActiveSwRegistration,
  type SwRegistrationLike,
} from './swNotify'

describe('active SW registration registry', () => {
  afterEach(() => {
    setActiveSwRegistration(null)
  })

  it('defaults to null and round-trips a set registration', () => {
    expect(getActiveSwRegistration()).toBeNull()
    const reg = { showNotification: vi.fn() } as unknown as SwRegistrationLike
    setActiveSwRegistration(reg)
    expect(getActiveSwRegistration()).toBe(reg)
  })

  it('registering in a secure context publishes the registration to the registry', async () => {
    const fakeReg = { scope: '/', showNotification: vi.fn() } as unknown as SwRegistrationLike
    const register = vi.fn().mockResolvedValue(fakeReg)
    await registerNotificationServiceWorker({
      isSecureContext: true,
      navigator: { serviceWorker: { register } } as unknown as Navigator,
    })
    expect(getActiveSwRegistration()).toBe(fakeReg)
  })
})

describe('registerNotificationServiceWorker', () => {
  beforeEach(() => {
    setActiveSwRegistration(null)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setActiveSwRegistration(null)
  })

  function makeNavigator(register: ReturnType<typeof vi.fn>) {
    return { serviceWorker: { register } } as unknown as Navigator
  }

  it('does NOT register when the context is insecure (no plaintext SW)', async () => {
    const register = vi.fn().mockResolvedValue({} as SwRegistrationLike)
    const reg = await registerNotificationServiceWorker({
      isSecureContext: false,
      navigator: makeNavigator(register),
    })
    expect(register).not.toHaveBeenCalled()
    expect(reg).toBeNull()
  })

  it('does NOT register when service workers are unsupported', async () => {
    const reg = await registerNotificationServiceWorker({
      isSecureContext: true,
      navigator: {} as Navigator,
    })
    expect(reg).toBeNull()
  })

  it('registers /sw.js in a secure context and returns the registration', async () => {
    const fakeReg = { scope: '/' } as unknown as SwRegistrationLike
    const register = vi.fn().mockResolvedValue(fakeReg)
    const reg = await registerNotificationServiceWorker({
      isSecureContext: true,
      navigator: makeNavigator(register),
    })
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(reg).toBe(fakeReg)
  })

  it('degrades to null (never throws) when registration rejects', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'))
    const reg = await registerNotificationServiceWorker({
      isSecureContext: true,
      navigator: makeNavigator(register),
    })
    expect(reg).toBeNull()
  })
})

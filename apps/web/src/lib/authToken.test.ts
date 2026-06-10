import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  AUTH_TOKEN_STORAGE_KEY,
  clearAuthToken,
  getAuthToken,
  authHeaders,
  setAuthToken,
  socketAuth,
  subscribeAuthToken,
  verifyAuthToken,
} from './authToken'

describe('authToken (browser half of C1)', () => {
  afterEach(() => {
    clearAuthToken()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns undefined when no local token is saved', () => {
    expect(getAuthToken()).toBeUndefined()
    expect(authHeaders()).toEqual({})
    expect(socketAuth()).toBeUndefined()
  })

  it('saves a non-empty token and shapes header + handshake auth', () => {
    setAuthToken('  secret-abc  ')
    expect(getAuthToken()).toBe('secret-abc')
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('secret-abc')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer secret-abc' })
    expect(socketAuth()).toEqual({ token: 'secret-abc' })
  })

  it('clears the saved token', () => {
    setAuthToken('secret-abc')
    clearAuthToken()
    expect(getAuthToken()).toBeUndefined()
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('notifies subscribers when the token changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAuthToken(listener)
    setAuthToken('secret-abc')
    clearAuthToken()
    unsubscribe()
    setAuthToken('secret-def')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('verifies a candidate token through the gated auth check route', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    await expect(verifyAuthToken('SECRET', fetchMock)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-deck/auth/check', {
      headers: { Accept: 'application/json', Authorization: 'Bearer SECRET' },
    })
  })

  it('treats rejected or empty candidate tokens as invalid', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 }))
    await expect(verifyAuthToken('BAD', fetchMock)).resolves.toBe(false)
    await expect(verifyAuthToken('   ', fetchMock)).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

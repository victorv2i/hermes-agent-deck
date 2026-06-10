import { describe, it, expect, afterEach, vi } from 'vitest'
import { maskKey, connectProviderKey } from './providerKey'
import * as apiFetch from '@/lib/apiFetch'

afterEach(() => vi.restoreAllMocks())

describe('maskKey — never reveal a secret in the UI', () => {
  it('masks the body of a key, keeping only a short tail for recognition', () => {
    // sk-abcdef1234 → only the last 4 survive; the rest are dots.
    expect(maskKey('sk-abcdef1234')).toBe('•••••••••1234')
  })

  it('masks a short key entirely (no tail leak when there is nothing to spare)', () => {
    expect(maskKey('abcd')).toBe('••••')
    expect(maskKey('ab')).toBe('••')
  })

  it('returns an empty string for an empty key', () => {
    expect(maskKey('')).toBe('')
  })

  it('never contains any of the original middle characters', () => {
    const key = 'sk-supersecretmiddle9999'
    const masked = maskKey(key)
    // The visible tail is the only literal kept; the secret middle is gone.
    expect(masked).not.toContain('supersecret')
    expect(masked).not.toContain('middle')
    expect(masked.endsWith('9999')).toBe(true)
  })
})

describe('connectProviderKey — POST the masked-on-the-wire-only secret', () => {
  it('POSTs provider + apiKey to the BFF setup route', async () => {
    const spy = vi
      .spyOn(apiFetch, 'apiPost')
      .mockResolvedValue({ provider: 'openrouter', connected: true })
    const res = await connectProviderKey('openrouter', 'sk-live-123')
    expect(spy).toHaveBeenCalledWith('/setup/provider-key', {
      provider: 'openrouter',
      apiKey: 'sk-live-123',
    })
    expect(res).toEqual({ provider: 'openrouter', connected: true })
  })

  it('surfaces an honest failure (no fake success) when the BFF rejects the key', async () => {
    vi.spyOn(apiFetch, 'apiPost').mockRejectedValue(
      new apiFetch.ApiError('Hermes could not add the credential.', 502, 'auth_add_failed'),
    )
    await expect(connectProviderKey('openrouter', 'bad')).rejects.toThrow(
      'Hermes could not add the credential.',
    )
  })
})

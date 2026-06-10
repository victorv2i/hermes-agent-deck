import { describe, it, expect } from 'vitest'
import { ApiError } from '@/lib/apiFetch'
import { isUnsupportedError } from './connectionsApi'

describe('isUnsupportedError', () => {
  it('is true for the BFF version-skew shape (404 + code "unsupported")', () => {
    expect(isUnsupportedError(new ApiError('unsupported', 404, 'unsupported'))).toBe(true)
  })

  it('is true for any 404 (route absent on this Hermes build)', () => {
    expect(isUnsupportedError(new ApiError('Not found', 404))).toBe(true)
  })

  it('is true when only the machine code says "unsupported"', () => {
    expect(isUnsupportedError(new ApiError('x', 500, 'unsupported'))).toBe(true)
  })

  it('is false for a real upstream outage (502) and non-ApiError values', () => {
    expect(isUnsupportedError(new ApiError('Bad gateway', 502))).toBe(false)
    expect(isUnsupportedError(new Error('boom'))).toBe(false)
    expect(isUnsupportedError(undefined)).toBe(false)
    expect(isUnsupportedError(null)).toBe(false)
  })
})

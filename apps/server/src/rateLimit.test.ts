import { describe, it, expect } from 'vitest'
import { RateLimiter, resolveClientKey } from './rateLimit'

describe('RateLimiter', () => {
  it('allows requests within the window limit', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, now: () => clock.t })
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('denies the request that exceeds the limit', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, now: () => clock.t })
    limiter.check('k')
    limiter.check('k')
    limiter.check('k')
    const result = limiter.check('k')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSecs).toBeGreaterThan(0)
  })

  it('slides the window: old timestamps expire, making room for new ones', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, now: () => clock.t })
    // Fill the window at t=0.
    limiter.check('k')
    limiter.check('k')
    limiter.check('k')
    // 4th call at t=0 is denied.
    expect(limiter.check('k').allowed).toBe(false)
    // Advance past the window — all 3 timestamps expire.
    clock.t = 1001
    // Now the window is clear: the call is allowed again.
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('tracks separate windows per client key', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2, now: () => clock.t })
    limiter.check('a')
    limiter.check('a')
    // 'a' is now over limit; 'b' is fresh.
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })

  it('remaining decrements on each allowed request', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5, now: () => clock.t })
    expect(limiter.check('k').remaining).toBe(4)
    expect(limiter.check('k').remaining).toBe(3)
  })

  it('does NOT record a denied request (the count stays at max)', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2, now: () => clock.t })
    limiter.check('k')
    limiter.check('k')
    // Denied call should not bump the count beyond max.
    const denied = limiter.check('k')
    expect(denied.allowed).toBe(false)
    // The next call is still denied (not erroneously allowed because the denied
    // one was recorded).
    expect(limiter.check('k').allowed).toBe(false)
  })

  it('reset clears the key state', () => {
    const clock = { t: 0 }
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, now: () => clock.t })
    limiter.check('k')
    expect(limiter.check('k').allowed).toBe(false)
    limiter.reset('k')
    expect(limiter.check('k').allowed).toBe(true)
  })
})

describe('resolveClientKey', () => {
  it('returns "loopback" for 127.0.0.1 and ::1 variants', () => {
    expect(resolveClientKey('127.0.0.1')).toBe('loopback')
    expect(resolveClientKey('::1')).toBe('loopback')
    expect(resolveClientKey('[::1]')).toBe('loopback')
    expect(resolveClientKey(undefined)).toBe('loopback')
  })

  it('returns the remote address for non-loopback clients', () => {
    expect(resolveClientKey('100.64.0.1')).toBe('100.64.0.1')
    expect(resolveClientKey('192.168.1.5')).toBe('192.168.1.5')
  })
})

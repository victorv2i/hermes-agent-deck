/**
 * Minimal sliding-window rate limiter for expensive BFF endpoints.
 *
 * No external packages — uses an in-process Map keyed by `clientKey` (e.g. the
 * remote IP or a static key for loopback). The sliding window discards timestamps
 * older than `windowMs` on each call, so memory is bounded to at most
 * `maxRequests` entries per key across all active windows.
 *
 * Usage:
 *   const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 30 })
 *   const { allowed } = limiter.check('127.0.0.1')
 *   if (!allowed) reply.code(429).send({ error: 'rate_limited', ... })
 *
 * Single-user deployment context: these endpoints are expensive (exec, probe,
 * file-tree scan, log-tail) — not because we fear a DoS from a malicious human,
 * but because a runaway script or a browser bug could spam them and saturate the
 * server or the hermes CLI process. The limits are generous enough that no normal
 * interactive use would hit them.
 */

export interface RateLimiterOptions {
  /** Sliding window width in milliseconds. Default 60 000 (1 minute). */
  windowMs?: number
  /** Maximum requests allowed within the window. Default 60. */
  maxRequests?: number
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number
}

export interface RateCheckResult {
  allowed: boolean
  /** Requests remaining in the current window (0 when denied). */
  remaining: number
  /** Seconds until the oldest timestamp in the window expires (0 when allowed). */
  retryAfterSecs: number
}

export class RateLimiter {
  private readonly windowMs: number
  private readonly maxRequests: number
  private readonly now: () => number
  /** Per-key sliding window: an array of timestamps (in ms) of recent requests. */
  private readonly windows = new Map<string, number[]>()

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000
    this.maxRequests = options.maxRequests ?? 60
    this.now = options.now ?? Date.now
  }

  /**
   * Check and record a request for `clientKey`. If allowed, the timestamp is
   * recorded and the caller may proceed. If denied, nothing is recorded (the
   * client must retry after `retryAfterSecs`).
   */
  check(clientKey: string): RateCheckResult {
    const now = this.now()
    const cutoff = now - this.windowMs

    let timestamps = this.windows.get(clientKey)
    if (!timestamps) {
      timestamps = []
      this.windows.set(clientKey, timestamps)
    }

    // Evict timestamps outside the window (slide the window forward).
    let i = 0
    while (i < timestamps.length && timestamps[i]! <= cutoff) i++
    if (i > 0) timestamps.splice(0, i)

    if (timestamps.length >= this.maxRequests) {
      // Window is full: compute how long until the oldest entry expires.
      const oldestAt = timestamps[0]!
      const retryAfterMs = oldestAt + this.windowMs - now
      return {
        allowed: false,
        remaining: 0,
        retryAfterSecs: Math.ceil(retryAfterMs / 1000),
      }
    }

    // Record this request and allow it.
    timestamps.push(now)
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      retryAfterSecs: 0,
    }
  }

  /** Remove all state for a key (for tests / cleanup). */
  reset(clientKey: string): void {
    this.windows.delete(clientKey)
  }
}

/**
 * Resolve a stable client key for rate limiting from a Fastify request. On a
 * loopback bind (127.0.0.1) there is only one client (the local user), so we use
 * a static key rather than any per-request identifier — this avoids depending on
 * headers that may not be set in that context. On a non-loopback bind, the remote
 * IP is the natural per-client key (X-Forwarded-For is intentionally ignored to
 * avoid header-injection bypasses).
 */
export function resolveClientKey(remoteAddress: string | undefined): string {
  // Empty / missing → treat as a single loopback client.
  if (!remoteAddress) return 'loopback'
  // Normalise the loopback variants to a stable key.
  const a = remoteAddress.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (a === '127.0.0.1' || a === '::1' || a === '0:0:0:0:0:0:0:1' || a === 'localhost') {
    return 'loopback'
  }
  return a
}

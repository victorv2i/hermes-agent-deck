import { describe, it, expect } from 'vitest'
import { HealthResponse } from './health'

describe('HealthResponse', () => {
  it('parses a fully-populated health response', () => {
    const parsed = HealthResponse.parse({
      status: 'ok',
      hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
      bind: { remote: false, terminalEnabled: true, authRequired: true },
      version: '0.1.0',
    })
    expect(parsed.status).toBe('ok')
    expect(parsed.bind.authRequired).toBe(true)
    expect(parsed.bind.remote).toBe(false)
  })

  it('parses a degraded health response with a null hermes platform', () => {
    const parsed = HealthResponse.parse({
      status: 'degraded',
      hermes: { reachable: false, endpoint: null, platform: null },
      bind: { remote: false, terminalEnabled: false, authRequired: false },
      version: '0.1.0',
    })
    expect(parsed.status).toBe('degraded')
    expect(parsed.hermes.reachable).toBe(false)
    expect(parsed.hermes.platform).toBeNull()
  })

  // STALE-SERVER SAFETY: a co-deployed server omitting `authRequired` must parse
  // successfully and default to `false` (safe: don't require auth) so a
  // FORCE_AUTH deploy does not fail-open due to a stale server in the fleet.
  it('defaults authRequired to false when the field is absent (stale co-deployed server)', () => {
    const parsed = HealthResponse.parse({
      status: 'ok',
      hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
      bind: { remote: false, terminalEnabled: true },
      version: '0.1.0',
    })
    expect(parsed.bind.authRequired).toBe(false)
  })

  it('still allows an explicit false from a current server', () => {
    const parsed = HealthResponse.parse({
      status: 'ok',
      hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
      bind: { remote: false, terminalEnabled: true, authRequired: false },
      version: '0.1.0',
    })
    expect(parsed.bind.authRequired).toBe(false)
  })

  it('rejects an invalid status value', () => {
    expect(() =>
      HealthResponse.parse({
        status: 'unknown',
        hermes: { reachable: false, endpoint: null, platform: null },
        bind: { remote: false, terminalEnabled: false, authRequired: false },
        version: '0.1.0',
      }),
    ).toThrow()
  })
})

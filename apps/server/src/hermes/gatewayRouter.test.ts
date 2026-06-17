import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseGatewayPortOverrides,
  resolveGatewayEndpointForProfile,
  resolveActiveGatewayEndpoint,
  GatewayRouter,
} from './gatewayRouter'
import type { GatewayClientLike } from './gatewayClient'

/** A do-nothing gateway client stand-in; identity is all these tests check. */
function fakeClient(): GatewayClientLike {
  return {
    startRun: async () => ({ runId: 'r' }),
    streamRun: async function* () {},
    respondApproval: async () => {},
    stopRun: async () => {},
    getRunSession: async () => ({ sessionId: null }),
  }
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-deck-gw-router-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Seed a named profile dir with an optional config.yaml API_SERVER_PORT. */
function seedProfile(name: string, port?: number): void {
  const dir = join(home, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  if (port !== undefined) {
    writeFileSync(join(dir, 'config.yaml'), `API_SERVER_PORT: ${port}\n`)
  }
}

function setActiveProfile(name: string): void {
  if (name === 'default') {
    rmSync(join(home, 'active_profile'), { force: true })
    return
  }
  writeFileSync(join(home, 'active_profile'), `${name}\n`)
}

describe('parseGatewayPortOverrides', () => {
  it('parses comma-separated profile=port pairs', () => {
    const map = parseGatewayPortOverrides('default=8642,work=8643, scratch=8644')
    expect(map.get('default')).toBe(8642)
    expect(map.get('work')).toBe(8643)
    expect(map.get('scratch')).toBe(8644)
  })

  it('accepts profile:port as well as profile=port', () => {
    const map = parseGatewayPortOverrides('work:8643')
    expect(map.get('work')).toBe(8643)
  })

  it('ignores blanks, malformed pairs, and out-of-range ports', () => {
    const map = parseGatewayPortOverrides('work=8643,,bad,nope=abc,big=70000,zero=0')
    expect(map.get('work')).toBe(8643)
    expect(map.has('bad')).toBe(false)
    expect(map.has('nope')).toBe(false)
    expect(map.has('big')).toBe(false)
    expect(map.has('zero')).toBe(false)
  })

  it('returns an empty map for undefined/empty input', () => {
    expect(parseGatewayPortOverrides(undefined).size).toBe(0)
    expect(parseGatewayPortOverrides('').size).toBe(0)
  })
})

describe('resolveGatewayEndpointForProfile', () => {
  const fallbackUrl = 'http://127.0.0.1:8642'

  it('uses the configured fallback URL for the default profile', () => {
    const url = resolveGatewayEndpointForProfile('default', {
      env: {},
      hermesHome: home,
      fallbackUrl,
    })
    expect(url).toBe(fallbackUrl)
  })

  it("reads a named profile's own config.yaml API_SERVER_PORT", () => {
    seedProfile('work', 8643)
    const url = resolveGatewayEndpointForProfile('work', { env: {}, hermesHome: home, fallbackUrl })
    expect(url).toBe('http://127.0.0.1:8643')
  })

  it('falls back to the configured URL for a named profile with no distinct port', () => {
    seedProfile('work') // no config.yaml port
    const url = resolveGatewayEndpointForProfile('work', { env: {}, hermesHome: home, fallbackUrl })
    expect(url).toBe(fallbackUrl)
  })

  it('an explicit AGENT_DECK_GATEWAY_PORTS override wins over config.yaml', () => {
    seedProfile('work', 8643)
    const portOverrides = parseGatewayPortOverrides('work=9000')
    const url = resolveGatewayEndpointForProfile('work', {
      env: {},
      hermesHome: home,
      fallbackUrl,
      portOverrides,
    })
    expect(url).toBe('http://127.0.0.1:9000')
  })

  it('HERMES_GATEWAY_URL pins ALL profiles to one endpoint (single-gateway override)', () => {
    seedProfile('work', 8643)
    const env = { HERMES_GATEWAY_URL: 'http://gw.example:1234' }
    expect(
      resolveGatewayEndpointForProfile('default', { env, hermesHome: home, fallbackUrl }),
    ).toBe('http://gw.example:1234')
    expect(resolveGatewayEndpointForProfile('work', { env, hermesHome: home, fallbackUrl })).toBe(
      'http://gw.example:1234',
    )
  })

  it('falls back safely for a malformed profile name (never throws)', () => {
    const url = resolveGatewayEndpointForProfile('../evil', {
      env: {},
      hermesHome: home,
      fallbackUrl,
    })
    expect(url).toBe(fallbackUrl)
  })
})

describe('resolveActiveGatewayEndpoint', () => {
  const fallbackUrl = 'http://127.0.0.1:8642'

  it('resolves the endpoint of whatever profile is active', () => {
    seedProfile('work', 8643)
    setActiveProfile('work')
    expect(resolveActiveGatewayEndpoint({ hermesHome: home, fallbackUrl, env: {} })).toBe(
      'http://127.0.0.1:8643',
    )
    setActiveProfile('default')
    expect(resolveActiveGatewayEndpoint({ hermesHome: home, fallbackUrl, env: {} })).toBe(
      fallbackUrl,
    )
  })
})

describe('GatewayRouter', () => {
  const fallbackUrl = 'http://127.0.0.1:8642'

  function makeRouter() {
    const created: Array<{ hermesGatewayUrl: string; hermesApiKey: string | null }> = []
    const router = new GatewayRouter({
      hermesHome: home,
      fallbackUrl,
      fallbackApiKey: 'fallback-key',
      env: {},
      createClient: (cfg) => {
        created.push(cfg)
        return fakeClient()
      },
    })
    return { router, created }
  }

  it('resolveActive reflects the active profile and its endpoint', () => {
    seedProfile('work', 8643)
    setActiveProfile('work')
    const { router } = makeRouter()
    const active = router.resolveActive()
    expect(active.profile).toBe('work')
    expect(active.endpoint).toBe('http://127.0.0.1:8643')
    expect(active.client).toBeDefined()
  })

  it('switching the active profile changes the resolved endpoint with no rebuild', () => {
    seedProfile('work', 8643)
    const { router } = makeRouter()

    setActiveProfile('default')
    expect(router.resolveActive().endpoint).toBe(fallbackUrl)

    // Simulate a profile switch: only active_profile changes on disk.
    setActiveProfile('work')
    expect(router.resolveActive().endpoint).toBe('http://127.0.0.1:8643')
  })

  it('caches one client per endpoint (no duplicate construction)', () => {
    seedProfile('work', 8643)
    const { router, created } = makeRouter()

    setActiveProfile('work')
    const a = router.resolveActive().client
    const b = router.resolveActive().client
    expect(a).toBe(b)
    expect(created).toHaveLength(1)
    expect(created[0]!.hermesGatewayUrl).toBe('http://127.0.0.1:8643')
  })

  it('uses the fallback api key for the default profile', () => {
    const { router, created } = makeRouter()
    setActiveProfile('default')
    router.resolveActive()
    expect(created[0]!.hermesApiKey).toBe('fallback-key')
  })
})

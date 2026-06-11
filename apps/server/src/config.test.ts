import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  resolveHermesHome,
  loadConfig,
  resolveHermesApiKey,
  resolveHermesGatewayUrl,
  resolveTrustedHosts,
  resolveBindHost,
  isWildcardHost,
  UnsafeBindError,
} from './config'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const fixtureConfig = join(fixturesDir, 'config.yaml')
const missingConfig = join(fixturesDir, 'does-not-exist.yaml')

describe('resolveHermesHome', () => {
  it('honors HERMES_HOME override', () => {
    expect(resolveHermesHome({ HERMES_HOME: '/tmp/x' }, '/home/u')).toBe('/tmp/x')
  })
  it('resolves a named active_profile to profiles/<name>', () => {
    expect(resolveHermesHome({}, '/home/u', 'work')).toBe('/home/u/.hermes/profiles/work')
  })
  it('falls back to ~/.hermes for default/empty profile', () => {
    expect(resolveHermesHome({}, '/home/u', '')).toBe('/home/u/.hermes')
    expect(resolveHermesHome({}, '/home/u', 'default')).toBe('/home/u/.hermes')
  })
})

describe('loadConfig', () => {
  it('defaults port to 7878 and host to 127.0.0.1', () => {
    const c = loadConfig({})
    expect(c.port).toBe(7878)
    expect(c.host).toBe('127.0.0.1')
  })
  it('reads AGENT_DECK_PORT', () => {
    expect(loadConfig({ AGENT_DECK_PORT: '9090' }).port).toBe(9090)
  })
  it('defaults the dashboard URL + Host to the stock Hermes loopback :9119 instance', () => {
    const c = loadConfig({})
    expect(c.hermesDashboardUrl).toBe('http://127.0.0.1:9119')
    expect(c.hermesDashboardHost).toBe('127.0.0.1:9119')
  })
  it('reads HERMES_DASHBOARD_URL and HERMES_DASHBOARD_HOST overrides', () => {
    const c = loadConfig({
      HERMES_DASHBOARD_URL: 'http://box.ts.net:9124',
      HERMES_DASHBOARD_HOST: 'box.ts.net:9124',
    })
    expect(c.hermesDashboardUrl).toBe('http://box.ts.net:9124')
    expect(c.hermesDashboardHost).toBe('box.ts.net:9124')
  })
  it('defaults webClientRoot to null (dev mode) and reads the override', () => {
    expect(loadConfig({}).webClientRoot).toBeNull()
    expect(loadConfig({ AGENT_DECK_WEB_CLIENT_ROOT: '' }).webClientRoot).toBeNull()
    expect(loadConfig({ AGENT_DECK_WEB_CLIENT_ROOT: '/srv/web/dist' }).webClientRoot).toBe(
      '/srv/web/dist',
    )
  })
  it('resolves the MCP catalog dir: HERMES_OPTIONAL_MCPS override, else <home>/optional-mcps', () => {
    expect(loadConfig({ HERMES_HOME: '/tmp/h' }).mcpCatalogDir).toBe('/tmp/h/optional-mcps')
    expect(
      loadConfig({ HERMES_HOME: '/tmp/h', HERMES_OPTIONAL_MCPS: '/repo/optional-mcps' })
        .mcpCatalogDir,
    ).toBe('/repo/optional-mcps')
  })
})

describe('isWildcardHost', () => {
  it('flags broad wildcard binds (every interface)', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true)
    expect(isWildcardHost('::')).toBe(true)
    expect(isWildcardHost('[::]')).toBe(true)
    expect(isWildcardHost('*')).toBe(true)
  })
  it('does NOT flag loopback or a specific host', () => {
    expect(isWildcardHost('127.0.0.1')).toBe(false)
    expect(isWildcardHost('::1')).toBe(false)
    expect(isWildcardHost('box.tail1234.ts.net')).toBe(false)
    expect(isWildcardHost('192.168.1.50')).toBe(false)
  })
})

describe('resolveBindHost (safe-bind refusal)', () => {
  it('defaults to loopback', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1')
  })
  it('allows loopback and a specific Tailscale/LAN host', () => {
    expect(resolveBindHost({ AGENT_DECK_HOST: '127.0.0.1' })).toBe('127.0.0.1')
    expect(resolveBindHost({ AGENT_DECK_HOST: 'box.tail1234.ts.net' })).toBe('box.tail1234.ts.net')
    expect(resolveBindHost({ AGENT_DECK_HOST: '192.168.1.50' })).toBe('192.168.1.50')
  })
  it('REFUSES a wildcard bind without AGENT_DECK_UNSAFE_BIND=1', () => {
    expect(() => resolveBindHost({ AGENT_DECK_HOST: '0.0.0.0' })).toThrow(UnsafeBindError)
    expect(() => resolveBindHost({ AGENT_DECK_HOST: '::' })).toThrow(/EVERY network interface/i)
  })
  it('allows a wildcard bind WITH the explicit opt-in', () => {
    expect(resolveBindHost({ AGENT_DECK_HOST: '0.0.0.0', AGENT_DECK_UNSAFE_BIND: '1' })).toBe(
      '0.0.0.0',
    )
  })
})

describe('loadConfig bind posture + terminal gating', () => {
  it('is non-remote on a loopback bind, with the terminal enabled', () => {
    const c = loadConfig({})
    expect(c.remote).toBe(false)
    expect(c.terminalEnabled).toBe(true)
  })
  it('is remote on a non-loopback bind, with the terminal DISABLED by default', () => {
    const c = loadConfig({ AGENT_DECK_HOST: 'box.tail1234.ts.net' })
    expect(c.remote).toBe(true)
    expect(c.terminalEnabled).toBe(false)
  })
  it('enables the terminal on a remote bind with AGENT_DECK_ENABLE_TERMINAL=1', () => {
    const c = loadConfig({
      AGENT_DECK_HOST: 'box.tail1234.ts.net',
      AGENT_DECK_ENABLE_TERMINAL: '1',
    })
    expect(c.remote).toBe(true)
    expect(c.terminalEnabled).toBe(true)
  })
  it('treats a loopback bind as remote/proxied when AGENT_DECK_REMOTE=1', () => {
    const c = loadConfig({ AGENT_DECK_REMOTE: '1' })
    expect(c.host).toBe('127.0.0.1')
    expect(c.remote).toBe(true)
    expect(c.terminalEnabled).toBe(false)
  })
  it('AGENT_DECK_FORCE_AUTH does not by itself mark the bind remote', () => {
    const c = loadConfig({ AGENT_DECK_FORCE_AUTH: '1' })
    expect(c.remote).toBe(false)
    expect(c.terminalEnabled).toBe(true)
  })
  it('reads AGENT_DECK_TERMINAL_ALLOW_HOME', () => {
    expect(loadConfig({}).terminalAllowHome).toBe(false)
    expect(loadConfig({ AGENT_DECK_TERMINAL_ALLOW_HOME: '1' }).terminalAllowHome).toBe(true)
  })
  it('reads AGENT_DECK_TERMINAL_PARK_GRACE_MS with a 24h default', () => {
    expect(loadConfig({}).terminalParkGraceMs).toBe(24 * 60 * 60 * 1000)
    expect(loadConfig({ AGENT_DECK_TERMINAL_PARK_GRACE_MS: '600000' }).terminalParkGraceMs).toBe(
      600_000,
    )
    // A non-numeric / non-positive override falls back to the default.
    expect(loadConfig({ AGENT_DECK_TERMINAL_PARK_GRACE_MS: 'soon' }).terminalParkGraceMs).toBe(
      24 * 60 * 60 * 1000,
    )
    expect(loadConfig({ AGENT_DECK_TERMINAL_PARK_GRACE_MS: '0' }).terminalParkGraceMs).toBe(
      24 * 60 * 60 * 1000,
    )
  })
  it('throws when asked to bind a wildcard without the opt-in', () => {
    expect(() => loadConfig({ AGENT_DECK_HOST: '0.0.0.0' })).toThrow(UnsafeBindError)
  })
})

describe('resolveHermesApiKey', () => {
  it('prefers the API_SERVER_KEY env var over the config file', () => {
    expect(resolveHermesApiKey({ API_SERVER_KEY: 'env-key' }, fixtureConfig)).toBe('env-key')
  })
  it('falls back to the top-level API_SERVER_KEY in config.yaml', () => {
    expect(resolveHermesApiKey({}, fixtureConfig)).toBe('fixture-secret-key')
  })
  it('returns null when neither env nor a readable config file provides one', () => {
    expect(resolveHermesApiKey({}, missingConfig)).toBeNull()
  })
  it('treats an empty env value as unset and falls back to the file', () => {
    expect(resolveHermesApiKey({ API_SERVER_KEY: '' }, fixtureConfig)).toBe('fixture-secret-key')
  })
})

describe('resolveHermesGatewayUrl', () => {
  it('prefers the HERMES_GATEWAY_URL env var over everything', () => {
    expect(
      resolveHermesGatewayUrl({ HERMES_GATEWAY_URL: 'http://box.ts.net:8643' }, fixtureConfig),
    ).toBe('http://box.ts.net:8643')
  })
  it("auto-matches the user's own config.yaml API_SERVER_PORT (an existing-Hermes user needs no config)", () => {
    // The fixture pins API_SERVER_PORT: 8643 (a relocated gateway).
    expect(resolveHermesGatewayUrl({}, fixtureConfig)).toBe('http://127.0.0.1:8643')
  })
  it('falls back to the STOCK Hermes gateway port (8642) when config has no port', () => {
    expect(resolveHermesGatewayUrl({}, missingConfig)).toBe('http://127.0.0.1:8642')
  })
  it('treats an empty env value as unset and resolves from the file', () => {
    expect(resolveHermesGatewayUrl({ HERMES_GATEWAY_URL: '' }, fixtureConfig)).toBe(
      'http://127.0.0.1:8643',
    )
  })
})

describe('resolveTrustedHosts', () => {
  it('returns [] when AGENT_DECK_TRUSTED_HOSTS is unset', () => {
    expect(resolveTrustedHosts({})).toEqual([])
    expect(loadConfig({}).trustedHosts).toEqual([])
  })
  it('parses a comma-separated list, normalizing scheme/port/case and dropping blanks', () => {
    expect(
      resolveTrustedHosts({
        AGENT_DECK_TRUSTED_HOSTS: 'deck.example.com, https://Agent.Acme.io:8443 , ',
      }),
    ).toEqual(['deck.example.com', 'agent.acme.io'])
  })
})

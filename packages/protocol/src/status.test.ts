import { describe, it, expect } from 'vitest'
import { AgentDeckStatus, PlatformState } from './status'

describe('AgentDeckStatus DTO', () => {
  it('parses a fully-populated cross-source status', () => {
    const parsed = AgentDeckStatus.parse({
      gatewayRunning: true,
      gatewayState: 'running',
      platforms: [
        { name: 'telegram', state: 'connected', error: null },
        { name: 'cron', state: 'degraded', error: 'auth expired' },
      ],
      activeSessions: 3,
      version: '0.15.2',
      configUpdateAvailable: true,
    })
    expect(parsed.platforms).toHaveLength(2)
    expect(parsed.platforms[1]!.state).toBe('degraded')
    expect(parsed.configUpdateAvailable).toBe(true)
  })

  it('constrains platform state to the governed semantic set (no amber/active)', () => {
    expect(PlatformState.options).toEqual(['connected', 'degraded', 'down', 'unknown'])
    expect(() => PlatformState.parse('active')).toThrow()
  })

  it('rejects any leaked filesystem-path field (whitelist is exhaustive)', () => {
    // The schema is strict-by-shape: parse() drops unknown keys, but the TYPE
    // never carries a path field. Assert the declared key set is exactly the
    // whitelist so a future edit that adds env_path/etc. fails this test.
    const parsed = AgentDeckStatus.parse({
      gatewayRunning: false,
      gatewayState: 'stopped',
      platforms: [],
      activeSessions: 0,
      version: '',
      configUpdateAvailable: false,
    })
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'activeSessions',
        'configUpdateAvailable',
        'gatewayRunning',
        'gatewayState',
        'platforms',
        'version',
      ].sort(),
    )
    for (const leak of ['env_path', 'config_path', 'hermes_home', 'module_path', 'repo_path']) {
      expect(parsed).not.toHaveProperty(leak)
    }
  })
})

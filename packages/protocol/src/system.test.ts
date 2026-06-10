import { describe, it, expect } from 'vitest'
import {
  GatewayStatus,
  SystemGatewayState,
  GatewayRestartResponse,
  HermesUpdateStatus,
  HermesUpdateState,
  AgentDeckUpdateStatus,
  AgentDeckUpdateState,
  SystemState,
  HermesUpdateApplyResult,
  HermesUpdateChannel,
  HermesChannelState,
  HermesDoctorStatus,
  HermesDoctorReport,
} from './system'

describe('GatewayStatus / SystemGatewayState', () => {
  it('parses the four run-states incl. fail-closed unknown', () => {
    for (const s of ['running', 'stopped', 'failed', 'unknown']) {
      expect(GatewayStatus.parse(s)).toBe(s)
    }
    expect(() => GatewayStatus.parse('degraded')).toThrow()
  })

  it('SLIM: strips PID/path/memory/log so internals never cross the wire', () => {
    const parsed = SystemGatewayState.parse({
      status: 'running',
      pid: 12345,
      path: '/home/user/.hermes/gateway.pid',
      memory: '13.2GB',
      log: 'last 200 lines…',
    })
    expect(Object.keys(parsed)).toEqual(['status'])
    expect(parsed).not.toHaveProperty('pid')
    expect(parsed).not.toHaveProperty('path')
  })

  it('GatewayRestartResponse is the same slim shape', () => {
    expect(GatewayRestartResponse.parse({ status: 'running', pid: 1 })).toEqual({
      status: 'running',
    })
  })
})

describe('HermesUpdateState', () => {
  it('parses each lifecycle status', () => {
    for (const s of ['idle', 'checking', 'up-to-date', 'update-available', 'updating', 'failed']) {
      expect(HermesUpdateStatus.parse(s)).toBe(s)
    }
    expect(() => HermesUpdateStatus.parse('no-channel')).toThrow() // hermes never has no-channel
  })

  it('carries a nullable ground-truth version', () => {
    expect(HermesUpdateState.parse({ status: 'up-to-date', currentVersion: 'v0.15.1' })).toEqual({
      status: 'up-to-date',
      currentVersion: 'v0.15.1',
    })
    expect(
      HermesUpdateState.parse({ status: 'idle', currentVersion: null }).currentVersion,
    ).toBeNull()
  })
})

describe('AgentDeckUpdateState', () => {
  it('includes the honest no-channel status hermes lacks', () => {
    expect(AgentDeckUpdateStatus.parse('no-channel')).toBe('no-channel')
    expect(AgentDeckUpdateState.parse({ status: 'no-channel', currentVersion: '0.1.0' })).toEqual({
      status: 'no-channel',
      currentVersion: '0.1.0',
    })
  })
})

describe('HermesUpdateChannel / HermesChannelState', () => {
  it('parses the two honest channels (default-branch stable, branch-tip latest-commit)', () => {
    expect(HermesUpdateChannel.parse('stable')).toBe('stable')
    expect(HermesUpdateChannel.parse('latest-commit')).toBe('latest-commit')
    // No "tag" channel — hermes update has no --tag apply, so we never offer one.
    expect(() => HermesUpdateChannel.parse('tag')).toThrow()
  })

  it('carries a per-channel --check verdict + installed version', () => {
    const parsed = HermesChannelState.parse({
      channel: 'latest-commit',
      status: 'update-available',
      currentVersion: 'v0.15.1',
    })
    expect(parsed.channel).toBe('latest-commit')
    expect(parsed.status).toBe('update-available')
    expect(parsed.currentVersion).toBe('v0.15.1')
    expect(
      HermesChannelState.parse({ channel: 'stable', status: 'up-to-date', currentVersion: null })
        .currentVersion,
    ).toBeNull()
  })
})

describe('SystemState (combined dock read)', () => {
  it('parses the three cards together', () => {
    const parsed = SystemState.parse({
      gateway: { status: 'running' },
      hermes: { status: 'update-available', currentVersion: 'v0.15.1' },
      agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
    })
    expect(parsed.gateway.status).toBe('running')
    expect(parsed.hermes.status).toBe('update-available')
    expect(parsed.agentDeck.status).toBe('no-channel')
  })

  it('carries the optional per-channel reads when present, and stays back-compatible without them', () => {
    const withChannels = SystemState.parse({
      gateway: { status: 'running' },
      hermes: {
        status: 'update-available',
        currentVersion: 'v0.15.1',
        channels: [
          { channel: 'stable', status: 'up-to-date', currentVersion: 'v0.15.1' },
          { channel: 'latest-commit', status: 'update-available', currentVersion: 'v0.15.1' },
        ],
      },
      agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
    })
    expect(withChannels.hermes.channels).toHaveLength(2)
    expect(withChannels.hermes.channels?.[1]?.channel).toBe('latest-commit')
    // A read without channels still parses (back-compat: the field is optional).
    const without = SystemState.parse({
      gateway: { status: 'running' },
      hermes: { status: 'up-to-date', currentVersion: 'v0.15.1' },
      agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
    })
    expect(without.hermes.channels).toBeUndefined()
  })
})

describe('HermesDoctorReport (the hermes doctor health rollup)', () => {
  it('parses the four health states', () => {
    for (const s of ['ok', 'warnings', 'issues', 'unavailable']) {
      expect(HermesDoctorStatus.parse(s)).toBe(s)
    }
    expect(() => HermesDoctorStatus.parse('green')).toThrow()
  })

  it('carries counts, per-section rollups, and the footer summary', () => {
    const parsed = HermesDoctorReport.parse({
      status: 'warnings',
      counts: { ok: 40, warning: 5, error: 0 },
      sections: [
        { title: 'Python Environment', ok: 2, warning: 1, error: 0 },
        { title: 'Auth Providers', ok: 1, warning: 4, error: 0 },
      ],
      summary: ["Run 'hermes setup' to configure API keys"],
    })
    expect(parsed.status).toBe('warnings')
    expect(parsed.counts.warning).toBe(5)
    expect(parsed.sections).toHaveLength(2)
    expect(parsed.summary[0]).toMatch(/hermes setup/)
  })

  it('SLIM: strips any extra key so a raw line / secret can never ride along', () => {
    const parsed = HermesDoctorReport.parse({
      status: 'ok',
      counts: { ok: 1, warning: 0, error: 0 },
      sections: [{ title: 'X', ok: 1, warning: 0, error: 0 }],
      summary: [],
      rawOutput: 'token sk-leak',
      pid: 4242,
    })
    expect(Object.keys(parsed).sort()).toEqual(['counts', 'sections', 'status', 'summary'])
  })

  it('represents the honest unavailable state (command could not run)', () => {
    const parsed = HermesDoctorReport.parse({
      status: 'unavailable',
      counts: { ok: 0, warning: 0, error: 0 },
      sections: [],
      summary: [],
    })
    expect(parsed.status).toBe('unavailable')
  })
})

describe('HermesUpdateApplyResult (the streamed-log apply outcome)', () => {
  it('carries the terminal status, the (already-scrubbed) log lines, and the re-probed version', () => {
    const parsed = HermesUpdateApplyResult.parse({
      status: 'up-to-date',
      log: ['hermes update --backup --yes', 'Backed up. Updated to v0.16.0.'],
      currentVersion: 'v0.16.0',
    })
    expect(parsed.status).toBe('up-to-date')
    expect(parsed.log).toHaveLength(2)
    expect(parsed.currentVersion).toBe('v0.16.0')
  })

  it('only allows a terminal status (no checking/idle) and a nullable version', () => {
    expect(
      HermesUpdateApplyResult.parse({ status: 'failed', log: [], currentVersion: null }).status,
    ).toBe('failed')
    // The apply result is never mid-flight: `checking` is rejected.
    expect(() =>
      HermesUpdateApplyResult.parse({ status: 'checking', log: [], currentVersion: null }),
    ).toThrow()
  })

  it('SLIM: strips any extra keys so a raw log/internal can never ride along', () => {
    const parsed = HermesUpdateApplyResult.parse({
      status: 'up-to-date',
      log: ['ok'],
      currentVersion: 'v0.16.0',
      pid: 4242,
      rawStderr: 'token sk-leak',
    })
    expect(Object.keys(parsed).sort()).toEqual(['currentVersion', 'log', 'status'])
  })
})

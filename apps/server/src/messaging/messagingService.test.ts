import { describe, it, expect } from 'vitest'
import { MessagingState } from '@agent-deck/protocol'
import { composeMessagingState, buildTokenFields, mapConnection } from './messagingService'
import { getRegistryEntry } from './registry'

/**
 * A representative `/api/env` body (the dashboard's GET /api/env shape):
 * a dict keyed by env var with `{ is_set, redacted_value, ... }`. Telegram is
 * stored; Slack has only the bot token (app token missing); the rest unset.
 */
const ENV_BODY = {
  TELEGRAM_BOT_TOKEN: { is_set: true, redacted_value: '12••••cd', category: 'messaging' },
  DISCORD_BOT_TOKEN: { is_set: false, redacted_value: null, category: 'messaging' },
  SLACK_BOT_TOKEN: { is_set: true, redacted_value: 'xoxb••••99', category: 'messaging' },
  SLACK_APP_TOKEN: { is_set: false, redacted_value: null, category: 'messaging' },
} as const

/** A representative `/api/status` body with a per-platform connection rollup. */
const STATUS_RUNNING = {
  gateway_running: true,
  gateway_state: 'running',
  gateway_platforms: {
    telegram: { state: 'connected', error_message: null },
    discord: { state: 'error', error_message: 'invalid bot token' },
    slack: { state: 'connecting', error_message: null },
    whatsapp: { state: 'connected', error_message: null },
  },
}

describe('mapConnection (gateway state → MessagingConnection, fail-closed)', () => {
  it('maps a known-good gateway state to connected', () => {
    expect(mapConnection({ raw: 'connected', tokenStored: true, gatewayRunning: true })).toBe(
      'connected',
    )
    expect(mapConnection({ raw: 'running', tokenStored: true, gatewayRunning: true })).toBe(
      'connected',
    )
  })

  it('maps a real error state (error/failed/degraded) to error', () => {
    expect(mapConnection({ raw: 'error', tokenStored: true, gatewayRunning: true })).toBe('error')
    expect(mapConnection({ raw: 'failed', tokenStored: true, gatewayRunning: true })).toBe('error')
    expect(mapConnection({ raw: 'degraded', tokenStored: true, gatewayRunning: true })).toBe(
      'error',
    )
  })

  it('maps a stopped/stopping platform to unknown (configured but not active — not an error)', () => {
    expect(mapConnection({ raw: 'stopped', tokenStored: true, gatewayRunning: true })).toBe(
      'unknown',
    )
    expect(mapConnection({ raw: 'stopping', tokenStored: true, gatewayRunning: true })).toBe(
      'unknown',
    )
  })

  it('reports connecting when a token is stored but the gateway has not reported connected', () => {
    // token present, gateway running, but no id entry / a transient state → we
    // honestly say "connecting" (token stored, waiting on the gateway).
    expect(mapConnection({ raw: 'connecting', tokenStored: true, gatewayRunning: true })).toBe(
      'connecting',
    )
    expect(mapConnection({ raw: null, tokenStored: true, gatewayRunning: true })).toBe('connecting')
  })

  it('reports not_configured when no token is stored and the platform is absent', () => {
    expect(mapConnection({ raw: null, tokenStored: false, gatewayRunning: true })).toBe(
      'not_configured',
    )
  })

  it('fails closed to unknown when the gateway is not running (cannot claim truth)', () => {
    // Gateway down: we can NOT claim a platform is connected or disconnected.
    expect(mapConnection({ raw: 'connected', tokenStored: true, gatewayRunning: false })).toBe(
      'unknown',
    )
    expect(mapConnection({ raw: null, tokenStored: true, gatewayRunning: false })).toBe('unknown')
  })

  it('status-only platform with no token: connected stays connected, absent → unknown', () => {
    // WhatsApp/Signal/Email have no token; their truth is purely the gateway.
    expect(mapConnection({ raw: 'connected', tokenStored: false, gatewayRunning: true })).toBe(
      'connected',
    )
    // gateway running but the id isn't in the rollup and no token → not_configured.
    expect(mapConnection({ raw: null, tokenStored: false, gatewayRunning: true })).toBe(
      'not_configured',
    )
  })
})

describe('buildTokenFields (shape-only, never plaintext)', () => {
  it('projects each registry token env var onto a shape-only field', () => {
    const slack = getRegistryEntry('slack')!
    const fields = buildTokenFields(slack, ENV_BODY)
    expect(fields).toEqual([
      {
        envVar: 'SLACK_BOT_TOKEN',
        label: 'Bot token (xoxb-…)',
        isSet: true,
        redactedValue: 'xoxb••••99',
      },
      { envVar: 'SLACK_APP_TOKEN', label: 'App token (xapp-…)', isSet: false, redactedValue: null },
    ])
  })

  it('a status-only platform contributes no token fields', () => {
    const wa = getRegistryEntry('whatsapp')!
    expect(buildTokenFields(wa, ENV_BODY)).toEqual([])
  })

  it('treats a missing env entry as unset (fail-closed, no crash)', () => {
    const tg = getRegistryEntry('telegram')!
    const fields = buildTokenFields(tg, {})
    expect(fields).toEqual([
      { envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', isSet: false, redactedValue: null },
    ])
  })
})

describe('composeMessagingState', () => {
  it('fuses registry × live status × env into a parseable MessagingState', () => {
    const state = composeMessagingState(STATUS_RUNNING, ENV_BODY)
    // It must satisfy the protocol contract exactly.
    expect(() => MessagingState.parse(state)).not.toThrow()
    expect(state.gatewayRunning).toBe(true)

    const byId = Object.fromEntries(state.platforms.map((p) => [p.platform.id, p]))
    // Telegram: token stored + gateway says connected → connected.
    expect(byId.telegram!.connection).toBe('connected')
    expect(byId.telegram!.tokens[0]!.isSet).toBe(true)
    // Discord: error from the gateway is surfaced.
    expect(byId.discord!.connection).toBe('error')
    expect(byId.discord!.errorMessage).toBe('invalid bot token')
    // Slack: gateway "connecting" → connecting.
    expect(byId.slack!.connection).toBe('connecting')
    // WhatsApp: status-only, gateway connected → connected, no tokens.
    expect(byId.whatsapp!.connection).toBe('connected')
    expect(byId.whatsapp!.tokens).toEqual([])
    // Signal/Email absent from the rollup, no token → not_configured.
    expect(byId.signal!.connection).toBe('not_configured')
    expect(byId.email!.connection).toBe('not_configured')
  })

  it('errorMessage is null unless the connection is error', () => {
    const state = composeMessagingState(STATUS_RUNNING, ENV_BODY)
    const byId = Object.fromEntries(state.platforms.map((p) => [p.platform.id, p]))
    expect(byId.telegram!.errorMessage).toBeNull()
    expect(byId.slack!.errorMessage).toBeNull()
  })

  it('fails closed to unknown for every platform when the gateway is down', () => {
    const state = composeMessagingState(
      { gateway_running: false, gateway_state: 'stopped', gateway_platforms: {} },
      ENV_BODY,
    )
    expect(state.gatewayRunning).toBe(false)
    for (const p of state.platforms) {
      expect(p.connection).toBe('unknown')
    }
    // Token shape is still surfaced (it's stored regardless of the gateway).
    const tg = state.platforms.find((p) => p.platform.id === 'telegram')!
    expect(tg.tokens[0]!.isSet).toBe(true)
  })

  it('tolerates a status body with no gateway_platforms object', () => {
    const state = composeMessagingState({ gateway_running: true }, {})
    expect(state.gatewayRunning).toBe(true)
    // No rollup + no tokens → every platform not_configured (gateway running).
    for (const p of state.platforms) {
      expect(['not_configured']).toContain(p.connection)
    }
  })

  it('NEVER carries a plaintext token anywhere in the serialized state', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: {
        is_set: true,
        redacted_value: '12••••cd',
        // a hostile dashboard that ALSO leaked the plaintext must not pass through.
        value: 'PLAINTEXT-SECRET-123',
      },
    }
    const state = composeMessagingState(STATUS_RUNNING, env)
    expect(JSON.stringify(state)).not.toContain('PLAINTEXT-SECRET-123')
  })
})

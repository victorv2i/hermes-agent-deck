import { describe, it, expect } from 'vitest'
import {
  MESSAGING_REGISTRY,
  getRegistryEntry,
  isRegistryToken,
  registryTokenEnvVars,
} from './registry'

/**
 * Registry conformance — the registry is the SINGLE source of truth for which
 * (platform, envVar) pairs the BFF will ever write. These facts were transcribed
 * from stock hermes:
 *   - platform ids: `gateway/config.py` `class Platform(Enum)` (the keys that
 *     appear in `/api/status`.gateway_platforms).
 *   - token env vars: `hermes_cli/config.py` `OPTIONAL_ENV_VARS` (category
 *     "messaging", `password: true` bot tokens).
 *   - connected checks: `gateway/config.py` `_PLATFORM_CONNECTED_CHECKERS` +
 *     the generic `token or api_key` branch.
 */
describe('messaging registry', () => {
  it('exposes the v1 platforms in a stable order', () => {
    const ids = MESSAGING_REGISTRY.map((p) => p.id)
    // Token-write platforms first (the ones the hub can actually connect), then
    // the honestly status-only ones.
    expect(ids).toEqual(['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'email'])
  })

  it('every platform id is lowercase and matches a gateway Platform key', () => {
    // The gateway reports these exact ids in /api/status.gateway_platforms.
    const known = new Set(['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'email'])
    for (const p of MESSAGING_REGISTRY) {
      expect(p.id).toBe(p.id.toLowerCase())
      expect(known.has(p.id)).toBe(true)
    }
  })

  it('Telegram is a single-bot-token platform with the BotFather url', () => {
    const tg = getRegistryEntry('telegram')!
    expect(tg.label).toBe('Telegram')
    expect(tg.setupUrl).toBe('https://t.me/BotFather')
    expect(tg.tokenEnvVars.map((t) => t.envVar)).toEqual(['TELEGRAM_BOT_TOKEN'])
    expect(tg.steps.length).toBeGreaterThan(0)
  })

  it('Discord is a single-bot-token platform', () => {
    const d = getRegistryEntry('discord')!
    expect(d.tokenEnvVars.map((t) => t.envVar)).toEqual(['DISCORD_BOT_TOKEN'])
    expect(d.setupUrl).toBe('https://discord.com/developers/applications')
  })

  it('Slack needs BOTH a bot token and an app token (Socket Mode)', () => {
    const s = getRegistryEntry('slack')!
    expect(s.tokenEnvVars.map((t) => t.envVar)).toEqual(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'])
    expect(s.setupUrl).toBe('https://api.slack.com/apps')
  })

  it('WhatsApp / Signal / Email are honestly status-only (no token field)', () => {
    // None of these fit the paste-a-bot-token model: WhatsApp pairs over a QR
    // bridge (`hermes whatsapp`), Signal needs a signal-cli REST endpoint, and
    // Email is multi-field IMAP/SMTP. Their env vars are NOT bot tokens in
    // OPTIONAL_ENV_VARS, so a token field would be a fake control. We surface
    // status + honest CLI/out-of-band steps instead.
    for (const id of ['whatsapp', 'signal', 'email'] as const) {
      const p = getRegistryEntry(id)!
      expect(p.tokenEnvVars).toEqual([])
      expect(p.steps.length).toBeGreaterThan(0)
    }
  })

  it('getRegistryEntry returns undefined for an unknown id', () => {
    expect(getRegistryEntry('mastodon')).toBeUndefined()
    expect(getRegistryEntry('TELEGRAM')).toBeUndefined() // case-sensitive ids
  })

  it('registryTokenEnvVars is the flat allowlist of writable env vars', () => {
    const vars = registryTokenEnvVars()
    expect(vars).toEqual(
      new Set(['TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']),
    )
  })

  it('isRegistryToken gates (platform, envVar) pairs — both must match', () => {
    expect(isRegistryToken('telegram', 'TELEGRAM_BOT_TOKEN')).toBe(true)
    expect(isRegistryToken('slack', 'SLACK_APP_TOKEN')).toBe(true)
    // right env var, wrong platform → rejected (no cross-platform writes).
    expect(isRegistryToken('discord', 'TELEGRAM_BOT_TOKEN')).toBe(false)
    // a real messaging env var that is NOT a registry bot token → rejected.
    expect(isRegistryToken('telegram', 'TELEGRAM_ALLOWED_USERS')).toBe(false)
    // a status-only platform has no writable token → rejected.
    expect(isRegistryToken('whatsapp', 'WHATSAPP_ENABLED')).toBe(false)
    // arbitrary env var → rejected (no arbitrary env writes).
    expect(isRegistryToken('telegram', 'OPENAI_API_KEY')).toBe(false)
    expect(isRegistryToken('telegram', 'PATH')).toBe(false)
  })

  it('the registry matches the protocol MessagingPlatform shape (parseable)', () => {
    // Each entry must project cleanly onto the wire MessagingPlatform.
    for (const p of MESSAGING_REGISTRY) {
      expect(typeof p.id).toBe('string')
      expect(typeof p.label).toBe('string')
      expect(p.setupUrl === null || typeof p.setupUrl === 'string').toBe(true)
      expect(Array.isArray(p.steps)).toBe(true)
    }
  })
})

/**
 * Tests for the guarded config-field write path.
 *
 * The BFF lets the UI edit a SHORT ALLOWLIST of safe, non-secret scalar config
 * fields (timezone, agent.max_turns). The write is a read-modify-write against
 * the stock dashboard: GET the full UNREDACTED config, set the one field at its
 * dot-path, PUT the whole config back (web_server.py PUT /api/config does a full
 * save_config, so the round-trip MUST carry every untouched key — including
 * secrets — verbatim). These tests prove:
 *   - only allowlisted fields are accepted (everything else → 400, never written);
 *   - the value is type-checked + validated before any write;
 *   - secrets in the surrounding config round-trip UNTOUCHED (never redacted into
 *     the PUT body — that would corrupt live credentials);
 *   - the dot-path patch is surgical (sibling keys preserved).
 */
import { describe, it, expect } from 'vitest'
import {
  WRITABLE_CONFIG_FIELDS,
  isWritableField,
  validateFieldValue,
  applyConfigPatch,
} from './configWrite'

describe('WRITABLE_CONFIG_FIELDS allowlist', () => {
  it('contains only the safe, non-secret scalar fields', () => {
    const keys = Object.keys(WRITABLE_CONFIG_FIELDS).sort()
    expect(keys).toEqual(['agent.max_turns', 'timezone'])
  })

  it('isWritableField accepts allowlisted keys and rejects everything else', () => {
    expect(isWritableField('timezone')).toBe(true)
    expect(isWritableField('agent.max_turns')).toBe(true)
    // A secret-bearing key is NEVER writable here.
    expect(isWritableField('auxiliary.vision.api_key')).toBe(false)
    expect(isWritableField('API_SERVER_KEY')).toBe(false)
    // An arbitrary / unknown key is rejected (no implicit passthrough).
    expect(isWritableField('model')).toBe(false)
    expect(isWritableField('agent.gateway_timeout')).toBe(false)
    expect(isWritableField('__proto__')).toBe(false)
  })
})

describe('validateFieldValue', () => {
  it('accepts a valid string for timezone (incl. empty → clears it)', () => {
    expect(validateFieldValue('timezone', 'America/New_York')).toEqual({
      ok: true,
      value: 'America/New_York',
    })
    // Empty string is a legitimate "unset" for a string field.
    expect(validateFieldValue('timezone', '')).toEqual({ ok: true, value: '' })
    // Whitespace is trimmed.
    expect(validateFieldValue('timezone', '  UTC  ')).toEqual({ ok: true, value: 'UTC' })
  })

  it('rejects a non-string for timezone', () => {
    expect(validateFieldValue('timezone', 42).ok).toBe(false)
    expect(validateFieldValue('timezone', true).ok).toBe(false)
    expect(validateFieldValue('timezone', null).ok).toBe(false)
  })

  it('accepts a positive integer for agent.max_turns', () => {
    expect(validateFieldValue('agent.max_turns', 100)).toEqual({ ok: true, value: 100 })
    expect(validateFieldValue('agent.max_turns', 1)).toEqual({ ok: true, value: 1 })
  })

  it('coerces a numeric string for agent.max_turns', () => {
    expect(validateFieldValue('agent.max_turns', '250')).toEqual({ ok: true, value: 250 })
  })

  it('rejects a non-positive / non-integer / out-of-range agent.max_turns', () => {
    expect(validateFieldValue('agent.max_turns', 0).ok).toBe(false)
    expect(validateFieldValue('agent.max_turns', -5).ok).toBe(false)
    expect(validateFieldValue('agent.max_turns', 1.5).ok).toBe(false)
    expect(validateFieldValue('agent.max_turns', 'abc').ok).toBe(false)
    // A guard against absurd values (config sanity).
    expect(validateFieldValue('agent.max_turns', 1_000_000).ok).toBe(false)
  })

  it('rejects any value for a non-allowlisted field', () => {
    expect(validateFieldValue('auxiliary.vision.api_key', 'x').ok).toBe(false)
  })
})

describe('applyConfigPatch (read-modify-write, secrets untouched)', () => {
  const baseConfig = () => ({
    model: 'anthropic/claude-sonnet-4.6',
    timezone: 'UTC',
    API_SERVER_KEY: 'sk-server-secret',
    agent: { max_turns: 90, gateway_timeout: 900 },
    auxiliary: { vision: { api_key: 'sk-vision-secret', model: 'gpt-4o' } },
  })

  it('sets a top-level scalar without touching siblings or secrets', () => {
    const next = applyConfigPatch(baseConfig(), 'timezone', 'America/New_York')
    expect(next.timezone).toBe('America/New_York')
    // Secrets + siblings carried verbatim — the PUT must not corrupt them.
    expect(next.API_SERVER_KEY).toBe('sk-server-secret')
    expect(next.model).toBe('anthropic/claude-sonnet-4.6')
    expect((next.auxiliary as Record<string, Record<string, unknown>>).vision!.api_key).toBe(
      'sk-vision-secret',
    )
  })

  it('sets a nested scalar via dot-path, preserving the sibling keys in that object', () => {
    const next = applyConfigPatch(baseConfig(), 'agent.max_turns', 250)
    const agent = next.agent as Record<string, unknown>
    expect(agent.max_turns).toBe(250)
    expect(agent.gateway_timeout).toBe(900) // sibling preserved
  })

  it('does NOT mutate the input config object', () => {
    const input = baseConfig()
    applyConfigPatch(input, 'agent.max_turns', 7)
    expect((input.agent as Record<string, unknown>).max_turns).toBe(90)
  })

  it('creates the intermediate object if the nested path is absent', () => {
    const next = applyConfigPatch({ model: 'x' }, 'agent.max_turns', 5)
    expect((next.agent as Record<string, unknown>).max_turns).toBe(5)
  })

  it('refuses to patch a non-allowlisted key (defense in depth)', () => {
    expect(() => applyConfigPatch(baseConfig(), 'auxiliary.vision.api_key', 'evil')).toThrow()
    expect(() => applyConfigPatch(baseConfig(), '__proto__.polluted', 'x')).toThrow()
  })
})

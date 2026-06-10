import { describe, it, expect } from 'vitest'
import { isSecretKey, redactConfig, REDACTED } from './redact'

// A loose recursive record used only to read into the redacted output in
// assertions without resorting to `any` (which the lint config forbids). It uses
// declared optional members rather than an index signature so that, under
// `noUncheckedIndexedAccess`, chained reads stay `AnyRecord | undefined`
// (resolved with `?.`) and never widen to an index-access `undefined` per hop.
interface AnyRecord {
  auxiliary?: AnyRecord
  vision?: AnyRecord
  providers?: AnyRecord
  anthropic?: AnyRecord
  openai?: AnyRecord
  api_key?: unknown
  base_url?: unknown
  webhook_url?: unknown
  fallback_providers?: AnyRecord[]
  tokens?: AnyRecord[] | unknown
  name?: unknown
  value?: unknown
  label?: unknown
  token?: unknown
}

describe('isSecretKey', () => {
  it('flags obvious secret-bearing key names (case-insensitive)', () => {
    for (const key of [
      'api_key',
      'apiKey',
      'API_SERVER_KEY',
      'secret',
      'client_secret',
      'password',
      'passwd',
      'token',
      'access_token',
      'auth_token',
      'bearer',
      'private_key',
      'webhook_url',
      'discord_token',
    ]) {
      expect(isSecretKey(key)).toBe(true)
    }
  })

  it('flags extended credential key names (auth, cookie, session, dsn, database_url, connection_string, pat, refresh)', () => {
    for (const key of [
      'authorization',
      'Authorization',
      'cookie',
      'set-cookie',
      'session_token',
      'session_id',
      'SESSION_KEY',
      'dsn',
      'SENTRY_DSN',
      'database_url',
      'DATABASE_URL',
      'connection_string',
      'CONNECTION_STRING',
      'pat',
      'github_pat',
      'refresh',
      'refresh_token',
      'REFRESH_TOKEN',
    ]) {
      expect(isSecretKey(key)).toBe(true)
    }
  })

  it('does not flag ordinary config keys', () => {
    for (const key of [
      'model',
      'provider',
      'base_url',
      'timeout',
      'max_turns',
      'enabled',
      'theme',
      'backend',
      'keychain_label', // contains "key" as a substring but is not a credential
    ]) {
      expect(isSecretKey(key)).toBe(false)
    }
  })
})

describe('redactConfig', () => {
  it('replaces non-empty secret values with the redaction marker', () => {
    const out = redactConfig({ model: 'anthropic/claude', api_key: 'sk-live-123' })
    expect(out).toEqual({ model: 'anthropic/claude', api_key: REDACTED })
  })

  it('leaves empty/blank secret values as empty (nothing to hide, shows "unset")', () => {
    const out = redactConfig({ api_key: '', token: '   ', secret: null })
    expect(out).toEqual({ api_key: '', token: '   ', secret: null })
  })

  it('redacts deeply nested secrets (auxiliary.vision.api_key)', () => {
    const out = redactConfig({
      auxiliary: {
        vision: { provider: 'auto', model: 'gpt-4o', api_key: 'sk-secret', timeout: 120 },
      },
    }) as unknown as AnyRecord
    expect(out.auxiliary?.vision).toEqual({
      provider: 'auto',
      model: 'gpt-4o',
      api_key: REDACTED,
      timeout: 120,
    })
  })

  it('redacts the entire providers subtree credentials but keeps shape', () => {
    const out = redactConfig({
      providers: {
        anthropic: { api_key: 'sk-ant-xxx', base_url: 'https://api.anthropic.com' },
        openai: { api_key: 'sk-oai-yyy' },
      },
    }) as unknown as AnyRecord
    expect(out.providers?.anthropic?.api_key).toBe(REDACTED)
    expect(out.providers?.anthropic?.base_url).toBe('https://api.anthropic.com')
    expect(out.providers?.openai?.api_key).toBe(REDACTED)
  })

  it('redacts secrets inside arrays of objects', () => {
    const out = redactConfig({
      fallback_providers: [
        { name: 'a', api_key: 'k1' },
        { name: 'b', api_key: 'k2' },
      ],
    }) as unknown as AnyRecord
    expect(out.fallback_providers?.[0]).toEqual({ name: 'a', api_key: REDACTED })
    expect(out.fallback_providers?.[1]).toEqual({ name: 'b', api_key: REDACTED })
  })

  it('does NOT over-redact non-secret object fields nested under a secret-named array key', () => {
    // `tokens` is a secret-named KEY, but its array holds objects with their own
    // fields. Only the actual secret-valued leaves (judged by their own key) are
    // redacted; descriptive fields like `name`/`label` are preserved verbatim.
    const out = redactConfig({
      tokens: [
        { name: 'github', value: 'ghp_secretAAA' },
        { label: 'gitlab', token: 'glpat_secretBBB' },
      ],
    }) as unknown as AnyRecord
    const arr = out.tokens as AnyRecord[]
    expect(arr[0]).toEqual({ name: 'github', value: 'ghp_secretAAA' })
    expect(arr[1]).toEqual({ label: 'gitlab', token: REDACTED })
  })

  it('redacts a list of primitive secret values held directly under a secret key', () => {
    // No per-element key exists, so the enclosing secret key governs the leaf:
    // each primitive in the list is an actual secret value and is redacted.
    const out = redactConfig({ tokens: ['t-AAA', 't-BBB'] }) as unknown as AnyRecord
    expect(out.tokens).toEqual([REDACTED, REDACTED])
  })

  it('redacts string-valued secrets nested in a credential-pool object whose KEY is secret-like', () => {
    // When a key is secret-like AND its value is a non-empty primitive, redact it.
    const out = redactConfig({
      webhook_url: 'https://hooks.example.com/abc',
    }) as unknown as AnyRecord
    expect(out.webhook_url).toBe(REDACTED)
  })

  it('does not mutate the input object', () => {
    const input = { api_key: 'sk-123', nested: { token: 't' } }
    const snapshot = JSON.stringify(input)
    redactConfig(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('the serialized output never contains a known secret value', () => {
    const out = redactConfig({
      providers: { x: { api_key: 'sk-DO-NOT-LEAK' } },
      auxiliary: { vision: { api_key: 'tok-DO-NOT-LEAK' } },
    })
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('sk-DO-NOT-LEAK')
    expect(serialized).not.toContain('tok-DO-NOT-LEAK')
  })
})

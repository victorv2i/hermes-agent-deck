/**
 * Secret redaction for the settings BFF.
 *
 * The dashboard's `GET /api/config` only strips keys that start with `_`, so the
 * raw config tree can still carry live credentials — provider `api_key`s, the
 * top-level `API_SERVER_KEY`, auxiliary-model keys, webhook URLs, tokens, etc.
 * Agentdeck NEVER sends secret values to the browser, so this module deeply
 * walks the config and replaces any non-empty value held under a secret-bearing
 * key with a non-reversible marker before the BFF responds.
 *
 * Empty / blank secret values are left as-is: there is nothing to hide and the
 * UI renders them as an "unset" field, which is useful (you can see a key is
 * missing without ever seeing one that exists).
 */

/** The opaque marker shown in place of a real secret value. */
export const REDACTED = '••••••••'

/**
 * Substrings that, when present in a config key, mark its value as a credential.
 * Matched case-insensitively against the key name (snake/camel/SCREAMING all
 * normalize via lowercase). Kept deliberately broad — over-redaction is safe,
 * leaking a secret is not.
 */
const SECRET_KEY_PATTERNS = [
  'api_key',
  'apikey',
  'secret',
  'password',
  'passwd',
  'token',
  'bearer',
  'private_key',
  'privatekey',
  'credential',
  'webhook',
  // Extended: HTTP/transport credentials that may appear in config or log scrub
  'authorization',
  'cookie',
  'session',
  'dsn',
  'database_url',
  'connection_string',
  'pat',
  'refresh',
] as const

/**
 * True when a config key names a credential. Word-boundary-ish: we match the
 * patterns as substrings of the lowercased key, which catches `api_key`,
 * `client_secret`, `discord_token`, `webhook_url`, etc. `keychain_label` and
 * similar non-credential keys are excluded because none of the patterns match.
 */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase()
  if (SECRET_KEY_PATTERNS.some((p) => k.includes(p))) return true
  // Trailing "key" token (`api_key`, `api_server_key`, `key`) is a credential;
  // a leading/embedded "key" (`keychain_label`) is not. Anchor to the end.
  return k === 'key' || k.endsWith('_key')
}

function isBlank(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/**
 * Deep-clone `value` with every secret-keyed, non-empty value replaced by
 * {@link REDACTED}. Walks plain objects and arrays; primitives pass through.
 * The input is never mutated.
 *
 * @param keyIsSecret whether the value arrived under a secret-bearing key — when
 *   true and the value is a non-blank primitive, it is redacted in place.
 */
export function redactConfig(value: unknown, keyIsSecret = false): unknown {
  if (Array.isArray(value)) {
    // Carry the enclosing key's secret-ness ONLY to primitive elements (a list of
    // bare secret values, e.g. `api_keys: ["k1","k2"]`). An OBJECT element under a
    // secret-named key re-establishes its own per-field key context below, so its
    // descriptive fields (`name`, `label`, …) are NOT over-redacted — only its
    // actual secret-valued leaves (`token`, `api_key`, …) are.
    return value.map((item) =>
      item && typeof item === 'object'
        ? redactConfig(item, false)
        : redactConfig(item, keyIsSecret),
    )
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactConfig(v, isSecretKey(k))
    }
    return out
  }
  // Primitive (string/number/boolean/null). Redact only non-blank secrets.
  if (keyIsSecret && !isBlank(value)) {
    return REDACTED
  }
  return value
}

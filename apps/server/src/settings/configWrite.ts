/**
 * Guarded config-field write path.
 *
 * Stock hermes exposes `PUT /api/config` (web_server.py:1239), which does a FULL
 * `save_config(...)` of whatever config object it is given — there is no partial
 * merge. So to safely edit ONE scalar field we read-modify-write: fetch the full
 * UNREDACTED config from the dashboard's `GET /api/config`, set the single field
 * at its dot-path, and PUT the whole object back. Every untouched key (including
 * live credentials like `API_SERVER_KEY` / provider `api_key`s) round-trips
 * verbatim — the redaction that protects the read view (settingsService /
 * redact.ts) is NEVER applied to this write body, because a redacted secret in
 * the PUT would overwrite the real credential on disk.
 *
 * To keep that round-trip honest + safe, only a SHORT ALLOWLIST of fields may be
 * written here: each must be a non-secret scalar with a tight validator. Anything
 * not on the list is refused before any dashboard call. This is the "make the
 * SAFE scalar fields editable" half of the settings-honest stream; the rest of
 * the config stays read-only (the UI shows an honest explanation + deep-link).
 */

/** Inclusive bounds for the agent turn budget (config sanity, not a hard limit). */
const MAX_TURNS_MIN = 1
const MAX_TURNS_MAX = 100_000

export type FieldType = 'string' | 'number'

/** A successful validation carries the normalized value to write. */
export type ValidationResult = { ok: true; value: string | number } | { ok: false; message: string }

export interface WritableFieldSpec {
  /** The scalar type the dashboard config expects for this key. */
  readonly type: FieldType
  /**
   * Normalize + validate a client-supplied value, returning the value to write
   * or a human-readable rejection. Pure; no I/O.
   */
  validate(value: unknown): ValidationResult
}

/**
 * The allowlist of safe, editable config fields, keyed by dot-path. Deliberately
 * tiny: only non-secret scalars whose round-trip cannot corrupt credentials.
 *
 *  - `timezone` (string): the agent's display timezone. Empty string clears it.
 *  - `agent.max_turns` (number): the per-run turn budget. A positive integer.
 */
export const WRITABLE_CONFIG_FIELDS: Readonly<Record<string, WritableFieldSpec>> = {
  timezone: {
    type: 'string',
    validate(value) {
      if (typeof value !== 'string') {
        return { ok: false, message: 'Timezone must be a string.' }
      }
      // Trim; empty is a legitimate "unset" (the field renders as Not set).
      return { ok: true, value: value.trim() }
    },
  },
  'agent.max_turns': {
    type: 'number',
    validate(value) {
      // Accept a number or a numeric string (the form input yields a string).
      let n: number
      if (typeof value === 'number') {
        n = value
      } else if (typeof value === 'string' && value.trim() !== '') {
        n = Number(value)
      } else {
        return { ok: false, message: 'Max turns must be a number.' }
      }
      if (!Number.isInteger(n)) {
        return { ok: false, message: 'Max turns must be a whole number.' }
      }
      if (n < MAX_TURNS_MIN || n > MAX_TURNS_MAX) {
        return {
          ok: false,
          message: `Max turns must be between ${MAX_TURNS_MIN} and ${MAX_TURNS_MAX}.`,
        }
      }
      return { ok: true, value: n }
    },
  },
}

/** True iff `key` is an allowlisted, editable config field. */
export function isWritableField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(WRITABLE_CONFIG_FIELDS, key)
}

/**
 * Validate + normalize a value for an allowlisted field. A non-allowlisted key
 * is always rejected (no implicit passthrough).
 */
export function validateFieldValue(key: string, value: unknown): ValidationResult {
  if (!isWritableField(key)) {
    return { ok: false, message: `Field is not editable: ${key}` }
  }
  return WRITABLE_CONFIG_FIELDS[key]!.validate(value)
}

/** A dangerous prototype-pollution segment — never written as an object key. */
function isUnsafeSegment(seg: string): boolean {
  return seg === '__proto__' || seg === 'prototype' || seg === 'constructor'
}

/**
 * Return a deep-ish clone of `config` with the allowlisted `key` (a dot-path)
 * set to `value`, leaving every other key — INCLUDING SECRETS — untouched. The
 * input object is never mutated. Throws on a non-allowlisted key or an unsafe
 * path segment (defense in depth: even if a caller skips {@link isWritableField}).
 *
 * Only the objects ALONG the patched path are cloned; sibling subtrees are
 * carried by reference (they're never mutated), which keeps the round-trip body
 * structurally identical to what the dashboard returned.
 */
export function applyConfigPatch(
  config: Record<string, unknown>,
  key: string,
  value: string | number,
): Record<string, unknown> {
  if (!isWritableField(key)) {
    throw new Error(`Refusing to write non-allowlisted config field: ${key}`)
  }
  const segments = key.split('.')
  for (const seg of segments) {
    if (seg === '' || isUnsafeSegment(seg)) {
      throw new Error(`Refusing unsafe config path segment in: ${key}`)
    }
  }

  const root: Record<string, unknown> = { ...config }
  let cursor = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    const existing = cursor[seg]
    // Clone the object we descend into so the input stays untouched; create a
    // fresh object when the intermediate is absent or not a plain object.
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cursor[seg] = child
    cursor = child
  }
  cursor[segments[segments.length - 1]!] = value
  return root
}

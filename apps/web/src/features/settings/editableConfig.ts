/**
 * The web mirror of the server's editable-config allowlist
 * (apps/server/src/settings/configWrite.ts). Only these non-secret scalar config
 * fields can be edited from the browser; everything else stays read-only with an
 * honest explanation + deep-link. The server is the real gate (it 400s anything
 * off its own allowlist), so this mirror only governs which rows OFFER an editor
 * — it never offers a control that the server can't honor.
 *
 * Kept tiny + feature-local (not imported across the app/server boundary) as a
 * decoupling rule.
 */

/** UI metadata for one editable config field. */
export interface EditableFieldSpec {
  /** The input kind to render. */
  readonly kind: 'text' | 'number'
  /** A short, plain-language hint shown under the editor. */
  readonly hint: string
  /** Placeholder for the input. */
  readonly placeholder?: string
  /** For numbers: inclusive bounds enforced client-side (mirrors the server). */
  readonly min?: number
  readonly max?: number
}

/** Dot-path key → editor spec. Mirror of WRITABLE_CONFIG_FIELDS on the server. */
export const EDITABLE_CONFIG_FIELDS: Readonly<Record<string, EditableFieldSpec>> = {
  timezone: {
    kind: 'text',
    placeholder: 'e.g. America/New_York',
    hint: 'IANA timezone name. Leave blank to use the system default.',
  },
  'agent.max_turns': {
    kind: 'number',
    placeholder: '100',
    min: 1,
    max: 100_000,
    hint: 'How many turns the agent may take in a single run.',
  },
}

/** True iff this config field is editable from the browser. */
export function isEditableField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE_CONFIG_FIELDS, key)
}

/**
 * Feature-local mirror of the BFF settings payload
 * (apps/server/src/settings/settingsTypes.ts). Re-declared here rather than
 * imported across the app/server boundary so the surface stays decoupled.
 */

/** A resolved, browser-safe field — secret values arrive already redacted. */
export interface SettingsField {
  /** Dot-path key, e.g. `auxiliary.vision.api_key`. */
  key: string
  /** Last path segment, e.g. `api_key` — a compact label for the row. */
  label: string
  /** Full description from the schema. */
  description: string
  /** 'string' | 'number' | 'boolean' | 'select' | 'list' | 'object'. */
  type: string
  /** Enumerated choices for `select` fields. */
  options?: string[]
  /** The (already-redacted) value, or null when absent. */
  value: unknown
  /** True when the value is a credential and has been masked. */
  isSecret: boolean
}

/** A category section grouping its fields. */
export interface SettingsSection {
  category: string
  fields: SettingsField[]
}

/** The settings payload served by `GET /api/agent-deck/config`. */
export interface SettingsPayload {
  sections: SettingsSection[]
  /** Whether the UI may submit edits. v1 is read-only. */
  editable: boolean
}

/**
 * Feature-local types for the settings surface. Kept here (not in
 * packages/protocol) so the surfaces stay decoupled — the web feature re-declares
 * the response shape it consumes rather than importing across the boundary.
 */

/** A single field's metadata as the dashboard's `/api/config/schema` returns it. */
export interface DashboardSchemaField {
  /** UI input kind: 'string' | 'number' | 'boolean' | 'select' | 'list' | 'object'. */
  type: string
  /** Human-friendly description (the dashboard renders dot-paths as "A → B → C"). */
  description: string
  /** Category the field belongs to (drives section grouping). */
  category: string
  /** Enumerated choices for `select` fields. */
  options?: string[]
}

/** The dashboard `/api/config/schema` response: flat dot-path → field + order. */
export interface DashboardConfigSchema {
  fields: Record<string, DashboardSchemaField>
  category_order: string[]
}

/** A resolved, browser-safe field (value already redacted if secret). */
export interface SettingsField {
  /** Dot-path key, e.g. `auxiliary.vision.api_key`. */
  key: string
  /** Last path segment, e.g. `api_key` — a compact label for the row. */
  label: string
  /** Full description from the schema. */
  description: string
  type: string
  options?: string[]
  /** The (already-redacted) value, or null when absent from the config. */
  value: unknown
  /** True when the value is a credential and has been masked. */
  isSecret: boolean
}

/** A category section grouping its fields. */
export interface SettingsSection {
  category: string
  fields: SettingsField[]
}

/** The browser-facing settings payload the BFF serves. */
export interface SettingsPayload {
  sections: SettingsSection[]
  /** Whether the UI may submit edits. v1 is read-only (no safe secret round-trip). */
  editable: boolean
}

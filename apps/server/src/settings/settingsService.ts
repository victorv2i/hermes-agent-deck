/**
 * Pure builder for the settings payload: takes the raw dashboard config + its
 * schema and produces a browser-safe, section-grouped view. Secret values are
 * redacted up-front (see {@link redactConfig}) so nothing sensitive ever reaches
 * this layer's output.
 *
 * Kept side-effect-free and dashboard-agnostic so it's trivially unit-testable;
 * the Fastify plugin (settingsRoutes.ts) wires it to the live dashboard.
 */
import { isSecretKey, redactConfig } from './redact'
import type {
  DashboardConfigSchema,
  SettingsField,
  SettingsPayload,
  SettingsSection,
} from './settingsTypes'

/** Resolve a dot-path (`a.b.c`) against a nested object; null when absent. */
function valueAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return null
    }
  }
  return cur === undefined ? null : cur
}

/** Last segment of a dot-path, used as the compact row label. */
function lastSegment(key: string): string {
  const parts = key.split('.')
  return parts[parts.length - 1] ?? key
}

/**
 * Build the section-grouped, redacted settings payload.
 *
 * Categories render in `schema.category_order`; any category that has fields but
 * is missing from that list is appended (sorted) so nothing is silently dropped.
 * Empty categories are omitted.
 */
export function buildSettingsPayload(
  rawConfig: unknown,
  schema: DashboardConfigSchema,
): SettingsPayload {
  const safeConfig = redactConfig(rawConfig)

  // Group field keys by category, preserving schema iteration order within each.
  const byCategory = new Map<string, SettingsField[]>()
  for (const [key, meta] of Object.entries(schema.fields)) {
    const field: SettingsField = {
      key,
      label: lastSegment(key),
      description: meta.description,
      type: meta.type,
      ...(meta.options ? { options: meta.options } : {}),
      value: valueAtPath(safeConfig, key),
      isSecret: isSecretKey(lastSegment(key)),
    }
    const bucket = byCategory.get(meta.category)
    if (bucket) bucket.push(field)
    else byCategory.set(meta.category, [field])
  }

  // Order categories: explicit order first, then any extras alphabetically.
  const ordered = [...schema.category_order]
  const extras = [...byCategory.keys()].filter((c) => !ordered.includes(c)).sort()
  const sections: SettingsSection[] = [...ordered, ...extras]
    .map((category): SettingsSection | null => {
      const fields = byCategory.get(category)
      return fields && fields.length > 0 ? { category, fields } : null
    })
    .filter((s): s is SettingsSection => s !== null)

  return { sections, editable: false }
}

import type { SettingsSection } from './types'

/** Display-string for the "unset / empty" state. */
export const UNSET = 'Not set'

/**
 * Filter sections to those with at least one field matching a free-text query.
 * Matches case-insensitively against the field's dot-path key, raw label, and
 * description, plus the section category — so typing "api" or "vision" or
 * "auxiliary" all surface the right rows. A whole-section match (category) keeps
 * every field; otherwise only the matching fields remain. A blank query returns
 * the sections unchanged.
 */
export function filterSections(sections: SettingsSection[], query: string): SettingsSection[] {
  const q = query.trim().toLowerCase()
  if (q === '') return sections
  const out: SettingsSection[] = []
  for (const section of sections) {
    const categoryHit = section.category.toLowerCase().includes(q)
    const fields = categoryHit
      ? section.fields
      : section.fields.filter((f) =>
          [f.key, f.label, f.description].some((s) => s.toLowerCase().includes(q)),
        )
    if (fields.length > 0) out.push({ ...section, fields })
  }
  return out
}

/**
 * Render a (redacted) config value as a compact display string for a read-only
 * row. Secrets arrive pre-masked as a string, so they pass through as-is.
 *
 * Empty states (null/undefined/''/`[]`/`{}`) all collapse to the friendly
 * {@link UNSET} placeholder so the UI never shows a bare em-dash or a cryptic
 * `{}` — the row can style that as muted "Not set".
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return UNSET
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? UNSET : value.map(String).join(', ')
  if (typeof value === 'object') {
    const entries = Object.keys(value as object)
    return entries.length === 0 ? UNSET : JSON.stringify(value, null, 2)
  }
  return String(value)
}

/** True when a value should render as the muted "Not set" placeholder. */
export function isUnset(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/**
 * A non-empty `list`-typed value rendered as its individual items, for chip
 * display. Returns an empty array for unset/non-list values so callers can fall
 * back to the plain string render.
 */
export function listItems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  return value.map(String)
}

const PHRASE_LABELS = new Map<string, string>([
  ['tts', 'Text-to-Speech'],
  ['stt', 'Speech-to-Text'],
  ['mcp', 'Connections (MCP)'],
  ['llm', 'Language Model'],
  ['api', 'API'],
  ['auxiliary', 'Extra AI Models'],
])

/** Title-case a category id for a section heading (`tts` -> `Text-to-Speech`). */
export function prettyCategory(category: string): string {
  const phrase = PHRASE_LABELS.get(category.toLowerCase())
  if (phrase) return phrase
  return category.charAt(0).toUpperCase() + category.slice(1)
}

/**
 * Humanize a snake/camel-cased field label into Title Case words
 * (`api_key` → `Api Key`, `maxTokens` → `Max Tokens`) so rows read as a designed
 * settings list rather than a raw config dump. Common acronyms are upper-cased.
 */
const ACRONYMS = new Set(['api', 'url', 'id', 'ttl', 'ui', 'cli', 'ms'])

export function prettyLabel(label: string): string {
  const words = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
  if (words.length === 0) return label
  return words
    .map((w) => {
      const lower = w.toLowerCase()
      const phrase = PHRASE_LABELS.get(lower)
      if (phrase) return phrase
      return ACRONYMS.has(lower) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

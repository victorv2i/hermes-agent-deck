/**
 * The coherence rule for Settings: a DEDICATED surface owns its domain's config;
 * Settings owns app preferences + genuinely-general config and LINKS to that
 * surface rather than DUPLICATING it. Settings' Group-2 dump renders the whole
 * hermes config schema by category, so several domains that already have a real
 * home (Voice, Messaging, MCP, Memory) were showing up twice.
 *
 * This module generalizes the original one-off model/provider dedup
 * (`withoutModelRows` → `ActiveModelRow`) into a small registry: each dedicated
 * domain declares how to recognize its config (a category match OR a key-prefix
 * match) and where it actually lives. The page (and the search path) split those
 * rows out of the dump and render a single read-only "Configured on the X page →"
 * link per dropped domain.
 *
 * Kept tiny + feature-local — no cross-boundary import — as a decoupling rule.
 */
import type { SettingsField, SettingsSection } from './types'

/** The stable id for each dedicated domain the dump defers to. */
export type DedicatedDomainId = 'voice' | 'messaging' | 'mcp' | 'memory'

/** How to recognize a dedicated domain's config rows. */
interface DedicatedDomain {
  readonly id: DedicatedDomainId
  /** Category names (lower-cased, exact) this domain owns entirely. */
  readonly categories: readonly string[]
  /** Key dot-path prefixes (lower-cased) this domain owns, regardless of how the
   * schema happens to bucket them into categories. A bare prefix like `mcp_servers`
   * matches both the exact key and any `mcp_servers.foo` child. */
  readonly keyPrefixes: readonly string[]
}

/**
 * The dedicated-domain registry, in the order their link cards render. Model /
 * provider is handled separately by the existing `ActiveModelRow` (Models link);
 * auxiliary model rows fold into THAT link's note, so they are intentionally NOT
 * a domain here — see {@link AUX_MODEL_SUFFIXES} / {@link hasAuxiliaryModelRows}.
 */
const DEDICATED_DOMAINS: readonly DedicatedDomain[] = [
  {
    id: 'voice',
    categories: ['tts', 'stt', 'voice', 'audio'],
    keyPrefixes: ['tts', 'stt', 'voice', 'audio'],
  },
  {
    id: 'messaging',
    categories: ['messaging'],
    keyPrefixes: ['messaging', 'telegram', 'discord', 'slack'],
  },
  {
    id: 'mcp',
    categories: ['mcp'],
    keyPrefixes: ['mcp', 'mcp_servers', 'mcpservers'],
  },
  {
    id: 'memory',
    categories: ['memory'],
    keyPrefixes: ['memory'],
  },
]

/** True when `key` equals `prefix` or begins with `prefix.` (a dot-path segment
 * boundary, so `voice` never matches `voiceover` and `mcp` never matches
 * `mcpx`). */
function keyHasPrefix(key: string, prefix: string): boolean {
  const k = key.toLowerCase()
  return k === prefix || k.startsWith(`${prefix}.`)
}

/** The dedicated domain a field belongs to, or null if it stays in the dump. */
function domainForField(category: string, field: SettingsField): DedicatedDomainId | null {
  const cat = category.toLowerCase()
  for (const domain of DEDICATED_DOMAINS) {
    if (domain.categories.includes(cat)) return domain.id
    if (domain.keyPrefixes.some((p) => keyHasPrefix(field.key, p))) return domain.id
  }
  return null
}

/** The auxiliary key suffixes that belong to the Models surface (the auxiliary
 * model + its provider). Only these aux rows are lifted out; aux api keys,
 * enable flags, etc. stay in the dump. */
const AUX_MODEL_SUFFIXES = new Set(['model', 'provider'])

/** True when `key` is an `auxiliary.<slot>.(model|provider)` row. */
function isAuxiliaryModelRow(key: string): boolean {
  const parts = key.toLowerCase().split('.')
  return parts.length >= 2 && parts[0] === 'auxiliary' && AUX_MODEL_SUFFIXES.has(parts.at(-1)!)
}

/** True when any field across the sections is an auxiliary model/provider row —
 * drives the "(incl. auxiliary models)" note on the Models link. */
export function hasAuxiliaryModelRows(sections: SettingsSection[]): boolean {
  return sections.some((s) => s.fields.some((f) => isAuxiliaryModelRow(f.key)))
}

/**
 * Split the config sections into the rows that stay in the Settings dump and the
 * set of dedicated domains whose rows were removed (so the page can render one
 * link card per dropped domain). Also strips auxiliary model/provider rows (they
 * belong to the Models link), keeping the rest of the auxiliary block.
 *
 * Memory is dropped ONLY when the live schema actually emits it: a domain is in
 * `dropped` strictly because at least one of its fields was present.
 *
 * Sections left with no fields are removed entirely; `dropped` is returned in the
 * registry's declared order for a stable, deterministic UI.
 */
export function splitDedicatedSections(sections: SettingsSection[]): {
  kept: SettingsSection[]
  dropped: DedicatedDomainId[]
} {
  const droppedSet = new Set<DedicatedDomainId>()
  const kept: SettingsSection[] = []

  for (const section of sections) {
    const fields = section.fields.filter((field) => {
      const domain = domainForField(section.category, field)
      if (domain) {
        droppedSet.add(domain)
        return false
      }
      // Auxiliary model/provider rows fold into the Models link (not a domain).
      if (isAuxiliaryModelRow(field.key)) return false
      return true
    })
    if (fields.length > 0) kept.push({ ...section, fields })
  }

  const dropped = DEDICATED_DOMAINS.map((d) => d.id).filter((id) => droppedSet.has(id))
  return { kept, dropped }
}

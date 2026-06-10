/**
 * Provider brand RESOLUTION (pure, no JSX).
 *
 * Maps a model's VENDOR family slug (the `<vendor>/<id>` prefix the Models page
 * groups by) — with common aliases folded in (gemini→google, grok→xai,
 * openai-codex→openai) — to a stable brand key + display label, and flags when no
 * accurate mark exists so the UI can fall back to a neutral monogram instead of a
 * garbled logo. The actual brand marks live in the sibling `providerBrandIcons.tsx`
 * (keyed by `ProviderBrand.key`); this file is the testable, render-free core.
 *
 * The marks come from the `@lobehub/icons` package (accurate AI brand marks, MIT).
 * Every vendor in the BRANDS list below has a real mark — unknown vendors fall back
 * to a clean neutral monogram (a readable lettermark beats a garbled logo).
 */

/** A resolved brand: a stable key + display label + whether it's the monogram fallback. */
export interface ProviderBrand {
  /**
   * Stable identity key for the resolved brand. A real brand's key matches a mark
   * in {@link providerBrandIcons}; a fallback key is `monogram:<slug>`.
   */
  key: string
  /** Human label for the brand/vendor (also the monogram source for unknowns). */
  label: string
  /** True when this is the neutral monogram fallback (no accurate mark available). */
  isFallback: boolean
  /** The normalized slug the brand resolved from (drives the monogram initial). */
  slug: string
}

interface BrandDef {
  key: string
  label: string
  /** Vendor slugs (lowercased) that resolve to this brand, incl. aliases. */
  aliases: string[]
}

/**
 * Accurate brand registry — vendors whose official mark ships in `@lobehub/icons`
 * (MIT, accurate AI brand marks). Each `key` has a real mark in providerBrandIcons.
 * Aliases fold serving slugs + alternate names onto the same brand.
 *
 * ACCURACY/HONESTY rule: only ever show the REAL mark for a given brand. Every
 * entry here MUST have a corresponding mark in providerBrandIcons. Vendors with
 * genuinely no accurate mark anywhere are intentionally NOT listed — they resolve
 * to the neutral monogram fallback instead (a clean monogram beats a wrong logo).
 */
const BRANDS: BrandDef[] = [
  { key: 'anthropic', label: 'Anthropic', aliases: ['anthropic', 'claude'] },
  {
    key: 'google',
    label: 'Google',
    aliases: [
      'google',
      'gemini',
      'google-gemini',
      'google-gemini-cli',
      'gemini-cli',
      'googleai',
      'google-ai',
      'vertex',
      'vertexai',
    ],
  },
  { key: 'meta', label: 'Meta', aliases: ['meta', 'meta-llama', 'metallama', 'llama'] },
  { key: 'mistral', label: 'Mistral', aliases: ['mistral', 'mistralai', 'mistral-ai'] },
  { key: 'qwen', label: 'Qwen', aliases: ['qwen', 'qwen2', 'qwen-2', 'alibaba'] },
  { key: 'deepseek', label: 'DeepSeek', aliases: ['deepseek', 'deep-seek'] },
  // OpenAI — real mark available in @lobehub/icons
  {
    key: 'openai',
    label: 'OpenAI',
    aliases: ['openai', 'openai-codex', 'gpt', 'chatgpt'],
  },
  // xAI — real mark available in @lobehub/icons; Grok is an xAI product
  {
    key: 'xai',
    label: 'xAI',
    aliases: ['xai', 'x-ai', 'grok'],
  },
  // Cohere — real mark available in @lobehub/icons
  {
    key: 'cohere',
    label: 'Cohere',
    aliases: ['cohere'],
  },
  // Perplexity — real mark available in @lobehub/icons
  {
    key: 'perplexity',
    label: 'Perplexity',
    aliases: ['perplexity', 'perplexity-ai'],
  },
  // Ollama — real mark available in @lobehub/icons
  {
    key: 'ollama',
    label: 'Ollama',
    aliases: ['ollama'],
  },
  // OpenRouter — real mark available in @lobehub/icons
  {
    key: 'openrouter',
    label: 'OpenRouter',
    aliases: ['openrouter', 'open-router'],
  },
]

const BY_ALIAS: Map<string, BrandDef> = (() => {
  const m = new Map<string, BrandDef>()
  for (const b of BRANDS) for (const a of b.aliases) m.set(a, b)
  return m
})()

/** Normalize a vendor slug for lookup: lowercased, trimmed. */
function normalizeSlug(provider: string): string {
  return (provider ?? '').trim().toLowerCase()
}

/**
 * Resolve a vendor/provider slug to its brand. A known vendor (incl. aliases)
 * returns a real brand (`isFallback: false`); anything else returns a neutral
 * monogram fallback carrying the slug as its label, so the page never renders a
 * garbled logo.
 */
export function resolveProviderBrand(provider: string): ProviderBrand {
  const slug = normalizeSlug(provider)
  const hit = slug ? BY_ALIAS.get(slug) : undefined
  if (hit) {
    return { key: hit.key, label: hit.label, isFallback: false, slug }
  }
  const label = slug || 'unknown'
  return { key: `monogram:${label}`, label, isFallback: true, slug: label }
}

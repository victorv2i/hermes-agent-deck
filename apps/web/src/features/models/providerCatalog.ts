import type { ProviderAuthMethod, ProviderCatalogEntry } from './types'

/**
 * Small, user-facing provider catalog for the connect dialog. Slugs remain here
 * as implementation details; the dialog leads with names and falls back to a
 * typed slug only for Custom / other.
 */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: 'nous',
    label: 'Nous Portal',
    slug: 'nous',
    description:
      "NousResearch's free hosted models. Create a free account at portal.nousresearch.com, then sign in.",
    docsUrl: 'https://portal.nousresearch.com',
    methods: ['oauth'],
    defaultMethod: 'oauth',
    badge: 'Browser',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    slug: 'anthropic',
    description: 'Sign in with your Claude account, or use an Anthropic API key.',
    docsUrl: 'https://console.anthropic.com',
    // Anthropic supports BOTH a browser sign-in (Claude account OAuth, verified
    // live in stock Hermes) and an API key. Lead with the browser path.
    methods: ['oauth', 'api-key'],
    defaultMethod: 'oauth',
    badge: 'Browser',
  },
  {
    id: 'openai-codex',
    label: 'OpenAI (Codex)',
    slug: 'openai-codex',
    description: 'Sign in with your ChatGPT/OpenAI account for Codex models.',
    docsUrl: 'https://chatgpt.com',
    methods: ['oauth'],
    defaultMethod: 'oauth',
    badge: 'Browser',
  },
  {
    id: 'qwen-oauth',
    label: 'Qwen',
    slug: 'qwen-oauth',
    description: 'Sign in with your Alibaba/Qwen account for Qwen models.',
    methods: ['oauth'],
    defaultMethod: 'oauth',
    badge: 'Browser',
  },
  {
    id: 'minimax-oauth',
    label: 'MiniMax',
    slug: 'minimax-oauth',
    description: 'Sign in with your MiniMax account for MiniMax models.',
    methods: ['oauth'],
    defaultMethod: 'oauth',
    badge: 'Browser',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    slug: 'openrouter',
    description: 'Use one key for many hosted model families.',
    methods: ['api-key'],
    defaultMethod: 'api-key',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    slug: 'openai',
    description: 'Use an OpenAI API key for GPT models.',
    methods: ['api-key'],
    defaultMethod: 'api-key',
  },
  {
    id: 'gemini',
    label: 'Google AI Studio',
    slug: 'gemini',
    description: 'Use a Google AI Studio API key for Gemini models.',
    methods: ['api-key'],
    defaultMethod: 'api-key',
  },
  {
    id: 'xai',
    label: 'xAI',
    slug: 'xai',
    description: 'Use an xAI API key for Grok models.',
    methods: ['api-key'],
    defaultMethod: 'api-key',
  },
  {
    id: 'custom',
    label: 'Custom / other',
    description: 'Type the Hermes provider slug for another service.',
    methods: ['api-key'],
    defaultMethod: 'api-key',
    badge: 'Advanced',
  },
]

export function providerSupports(entry: ProviderCatalogEntry, method: ProviderAuthMethod): boolean {
  return entry.methods.includes(method)
}

/**
 * Whether a catalog entry can be connected via browser OAuth, given the LIVE set
 * of OAuth-capable provider slugs Hermes reports (lowercased ids from
 * `GET /api/agent-deck/provider-oauth`). True when the static catalog declares
 * `oauth` OR the live list confirms the entry's slug — so the oauth-capable set
 * is driven by the running Hermes and can't silently drift from the catalog.
 * Falls back to the static catalog when the live set is empty/unavailable.
 */
export function providerSupportsOAuth(
  entry: ProviderCatalogEntry,
  liveOAuthIds?: ReadonlySet<string>,
): boolean {
  if (providerSupports(entry, 'oauth')) return true
  const slug = entry.slug?.trim().toLowerCase()
  return !!slug && !!liveOAuthIds && liveOAuthIds.has(slug)
}

export function providerSlug(entry: ProviderCatalogEntry, override: string): string {
  return override.trim() || entry.slug || ''
}

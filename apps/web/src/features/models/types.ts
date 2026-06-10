/**
 * Feature-local types for the Models surface (mirror of the BFF contract in
 * apps/server/src/models/types.ts). Kept feature-local — not in the shared
 * protocol package — so the surface can evolve independently.
 */

export interface ModelEntry {
  id: string
  /**
   * Stable, provider-qualified id (`<provider>/<id>`), unique across the whole
   * list even when `id` collides across providers (e.g. `gpt-5.4` under both
   * `openai-codex` and `copilot`). Use as the React key + picker selection value.
   */
  qualifiedId: string
  label: string
  provider: string
  active: boolean
  /**
   * Whether this model is selectable right now — its provider is active or
   * logged-in. A provider with no credentials is `usable: false`; the picker
   * should disable it (WAVE 1 wiring) rather than offer a switch that can only
   * fail. Fails open to `true` when the oauth probe is unavailable.
   */
  usable: boolean
  source: string
}

export interface ProviderRef {
  id: string
  label: string
}

/** Resolved capabilities of the active model (from stock /api/model/info). */
export interface ModelCapabilities {
  supportsTools: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  contextWindow: number
  maxOutputTokens: number
  modelFamily: string
  autoContextLength: number
  configContextLength: number
  effectiveContextLength: number
}

/** One auxiliary task assignment (hermes signature slots). */
export interface AuxiliaryTask {
  task: string
  provider: string
  model: string
}

export interface ModelsResponse {
  activeModelId: string
  provider: ProviderRef
  models: ModelEntry[]
  capabilities: ModelCapabilities
  auxiliary: AuxiliaryTask[]
  /**
   * True when the BFF could NOT verify provider status (the `/api/providers/oauth`
   * probe failed), so per-model `usable` flags failed OPEN. The page surfaces a
   * dismissible info banner so a model marked usable that may not actually be is
   * not presented as verified truth. Defaults to `false` (older payloads omit it).
   */
  providerStatusUnknown: boolean
}

/**
 * The result of a provider-key connect (mirror of `AgentDeckProviderKeyResponse`
 * in the protocol). Carries the provider + whether a usable model is now
 * reported — NEVER the key.
 */
export interface ProviderConnectResult {
  provider: string
  connected: boolean
}

export type ProviderAuthMethod = 'oauth' | 'api-key'

export interface ProviderCatalogEntry {
  /** Stable UI id for the catalog card. */
  id: string
  /** User-facing provider name. */
  label: string
  /** Hermes provider id, when it is known. Custom entries are typed by the user. */
  slug?: string
  description: string
  methods: ProviderAuthMethod[]
  defaultMethod: ProviderAuthMethod
  badge?: string
  /**
   * Optional URL to the provider's sign-up or docs page, shown when the user
   * selects an OAuth provider. Without this a browser-sign-in flow gives the
   * user no pointer to create an account (a "link pointing nowhere" honesty gap).
   */
  docsUrl?: string
}

/**
 * Normalized shape for the Agent Deck provider OAuth BFF. The underlying Hermes
 * flow may return a browser URL, a device/user code, a polling session id, or a
 * combination of those. No provider access tokens belong in this contract.
 */
export interface ProviderOAuthSession {
  provider: string
  status: 'pending' | 'connected' | 'failed' | 'cancelled' | 'unknown'
  sessionId?: string
  url?: string
  verificationUri?: string
  userCode?: string
  deviceCode?: string
  message?: string
  pollIntervalMs?: number
}

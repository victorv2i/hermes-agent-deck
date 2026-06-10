/**
 * Feature-local contract for the Models surface. Kept feature-local (NOT in
 * packages/protocol) so this surface can evolve without touching shared code.
 *
 * The BFF (`modelsRoute.ts`) reads three STOCK hermes endpoints in parallel —
 * `GET /api/model/info`, `GET /api/model/options`, `GET /api/model/auxiliary`
 * (proven to exist in hermes_cli/web_server.py) — and maps them into this clean,
 * web-friendly shape. v1 is read-only: it surfaces the configured models, their
 * provider, the active model's capabilities, and the auxiliary task assignments.
 */

/** One configured model entry. */
export interface ModelEntry {
  /**
   * The bare model id as stock reports it, e.g. `gpt-5.4` or
   * `anthropic/claude-opus-4`. NOT unique on its own — the SAME id can appear
   * under multiple providers (e.g. `gpt-5.4` under both `openai-codex` and
   * `copilot`). Use {@link qualifiedId} as the stable key.
   */
  id: string
  /**
   * A stable, provider-qualified id that is unique across the whole list even
   * when {@link id} collides across providers: `<provider>/<id>` (e.g.
   * `openai-codex/gpt-5.4` vs `copilot/gpt-5.4`). Safe to use as a React key and
   * as the picker's selection value.
   */
  qualifiedId: string
  /** Display label (stock echoes the id today). */
  label: string
  /** Provider slug this model is served by, e.g. `openrouter`. */
  provider: string
  /** True for the single currently-active model. */
  active: boolean
  /**
   * Whether this model is actually selectable RIGHT NOW: its provider is the
   * active provider, OR the provider is logged-in per `/api/providers/oauth`. A
   * provider with no oauth/credentials (e.g. `copilot` when not signed in) is
   * `usable: false` — the picker should disable it rather than offer a switch
   * that can only fail. (Fails OPEN to `true` when the oauth probe is unavailable,
   * so the picker still lists configured providers; the switch attempt is then the
   * honesty boundary.)
   */
  usable: boolean
  /**
   * Where the entry came from in stock's provider list (`built-in`, `hermes`,
   * `user-config`, `canonical`, …). Surfaced for transparency; the UI may ignore it.
   */
  source: string
}

/** The active provider, slug + human label. */
export interface ProviderRef {
  id: string
  label: string
}

/**
 * Resolved capabilities of the active model, from `GET /api/model/info`. All
 * fields default to safe falsy values when stock can't resolve them (the
 * `capabilities` block is `{}` when models.dev has no record).
 */
export interface ModelCapabilities {
  supportsTools: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  /** models.dev context window for the active model (0 when unknown). */
  contextWindow: number
  /** models.dev max output tokens (0 when unknown). */
  maxOutputTokens: number
  /** models.dev family label, e.g. `claude`, '' when unknown. */
  modelFamily: string
  /** Auto-detected context length the agent resolved (0 when unknown). */
  autoContextLength: number
  /** Explicit context-length override from config (0 when none). */
  configContextLength: number
  /** The context length the agent actually uses (override else auto; 0 unknown). */
  effectiveContextLength: number
}

/**
 * One auxiliary task assignment, from `GET /api/model/auxiliary` `tasks[]`.
 * These are the hermes signature slots (vision / compression / delegation /
 * title / triage / …). `provider: 'auto'` + empty `model` means the slot
 * follows the main model.
 */
export interface AuxiliaryTask {
  /** Slot name, e.g. `vision`, `compression`, `title_generation`. */
  task: string
  /** Provider slug for the slot (`auto` = follow main). */
  provider: string
  /** Model id for the slot ('' = follow main / provider default). */
  model: string
}

/** The Models surface response — active model, provider, list, capabilities, auxiliary. */
export interface ModelsResponse {
  /** Provider-qualified id of the active model (may be '' if unresolved). */
  activeModelId: string
  /** The active model's provider. */
  provider: ProviderRef
  /** The configured / selectable models, active one flagged. */
  models: ModelEntry[]
  /** Resolved capabilities of the active model (always present; falsy when unknown). */
  capabilities: ModelCapabilities
  /** Auxiliary task assignments (hermes signature slots); empty if unavailable. */
  auxiliary: AuxiliaryTask[]
  /**
   * True when the `/api/providers/oauth` probe could NOT be read, so per-model
   * `usable` flags FAILED OPEN (every model treated as usable rather than
   * disabling everything off a transient error). The UI surfaces this honestly —
   * "provider status couldn't be verified; some models may not actually be
   * usable" — instead of silently presenting unverified `usable: true`.
   */
  providerStatusUnknown: boolean
}

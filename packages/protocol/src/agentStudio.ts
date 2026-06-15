import { z } from 'zod'
import { ProfileName } from './identity'

/**
 * AGENT STUDIO contract. The typed shapes behind the Studio workbench, where a
 * user authors everything about one agent (a hermes profile) in a single
 * surface. Shared by the BFF (which proxies hermes's per-profile dashboard API)
 * and the web client (the roster + the sectioned workbench).
 *
 * INTEGRATION TRUTH (do NOT hand-write a profile's files): every read/write
 * below maps to a stock hermes dashboard route, scoped by `?profile=<name>`
 * (query) or `body.profile`. The Studio passes its selected agent through as
 * `profile`; an omitted profile targets the active one. Verified against the
 * installed hermes (config schema v29):
 *   - Config subset:  GET /api/config?profile=  +  PUT /api/config {config, profile}
 *   - Model picker:   GET /api/model/options?profile=
 *   - Model set:      PUT /api/profiles/{name}/model {provider, model}
 *   - Env (redacted): GET /api/env?profile=  (per-key {is_set, redacted_value, ...})
 *
 * Toolsets, skills, soul, and the full env entry shape already have contracts in
 * this package ({@link AgentDeckToolset}, {@link AgentDeckSkill}, soul presets,
 * {@link EnvVarEntry}); this file adds ONLY the Studio-specific config subset,
 * the model-options picker shape, the per-profile model-set wrapper, and the
 * SLIM redacted env view the Studio renders.
 *
 * SECURITY: no secret value ever appears here. The config subset is the
 * narrow set of keys the Studio reads/writes (parse() drops every other config
 * key). The env view is shape-only: {key, isSet}, never a value or a redacted
 * preview. The full redacted entry ({@link EnvVarEntry}) stays the Credentials
 * surface's richer contract; the Studio's view is deliberately thinner.
 */

/* -------------------------------------------------------------------------- */
/* Config subset: the per-profile keys the Studio reads/writes                */
/* -------------------------------------------------------------------------- */

/**
 * The agent's main model id, as it lives in the effective config the dashboard
 * `GET /api/config` returns. Installed hermes (config schema v29) stores the main
 * model id at the TOP-LEVEL `model:` key as a plain string (e.g. `"gpt-5.5"`),
 * NOT a nested `{ default, provider }` block, and carries no `model.provider`
 * sibling (the resolved provider comes from {@link ModelOptionsResponse}). So
 * `model` here is an optional string: optional because a freshly-created profile
 * may omit it. A WRITE that changes the model goes through
 * {@link ProfileModelSetRequest} (PUT /api/profiles/{name}/model), which also
 * clears stale base_url/context_length (preferred over patching config here).
 */
export const StudioModelId = z.string()
export type StudioModelId = z.infer<typeof StudioModelId>

/**
 * The `memory.*` block the Studio's Memory section reads/writes via
 * GET/PUT /api/config?profile=. Installed hermes (v29) has NO flat MEMORY.md /
 * USER.md files (memory is store-backed plus an external provider), so the
 * Studio authors memory through this config block + the provider selector
 * ({@link MemoryStatus} in memory.ts), NEVER a flat-file editor.
 *
 * Every field is optional: the effective merged config may omit a key, and a
 * PUT patch sends only the keys the user changed.
 */
export const StudioMemoryConfig = z.object({
  /** Whether agent memory is enabled. */
  memory_enabled: z.boolean().optional(),
  /** Whether the user-profile memory is enabled. */
  user_profile_enabled: z.boolean().optional(),
  /** Character budget for the memory block (non-negative integer). */
  memory_char_limit: z.number().int().nonnegative().optional(),
  /** Character budget for the user-profile block (non-negative integer). */
  user_char_limit: z.number().int().nonnegative().optional(),
  /**
   * Whether memory writes wait for manual approval. Installed hermes (config
   * schema v29) types `memory.write_approval` as a BOOLEAN (`true` = approval
   * required, `false` = writes apply automatically), so the Studio reads/writes a
   * boolean here. Optional because the effective config may omit it.
   */
  write_approval: z.boolean().optional(),
  /** The memory provider name (empty string / "built-in" for the built-in store). */
  provider: z.string().optional(),
})
export type StudioMemoryConfig = z.infer<typeof StudioMemoryConfig>

/**
 * The blocklist of toolset names applied on top of the top-level `toolsets:`
 * enable list. Installed hermes (config schema v29) surfaces
 * `agent.disabled_toolsets` in the effective `GET /api/config` as a
 * JSON-ENCODED STRING (e.g. `'["tts"]'`), not a JSON array, so this preprocess
 * decodes that string form into a `string[]` before validation. A value that is
 * already an array (a normalized config, or the Studio's own write patch) passes
 * through untouched; a malformed/empty string decodes to `[]`. Other types are
 * left as-is so the surrounding `.array(string)` rejects them.
 */
export const DisabledToolsets = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : value
  } catch {
    return value
  }
}, z.array(z.string()))
export type DisabledToolsets = z.infer<typeof DisabledToolsets>

/**
 * The `agent.*` subset the Studio touches. Only `disabled_toolsets`, the
 * blocklist applied on top of the top-level `toolsets:` enable list. Optional
 * on read (absent means no blocklist); a write sends the full intended list.
 */
export const StudioAgentConfig = z.object({
  disabled_toolsets: DisabledToolsets.optional(),
})
export type StudioAgentConfig = z.infer<typeof StudioAgentConfig>

/**
 * The per-profile config SUBSET the Studio reads from GET /api/config?profile=.
 * The effective merged config carries dozens of keys (delegation, auxiliary,
 * gateway, …) the Studio does not author; parse() drops every key not declared
 * here, so this is the exact whitelist the Studio surface sees.
 *
 * - `toolsets`:  the top-level ENABLED toolset list.
 * - `agent.disabled_toolsets`: the blocklist applied on top.
 * - `model`:     the top-level model id string (read; write via the model-set route).
 * - `memory`:    the `memory.*` block.
 *
 * All keys optional: a freshly-created profile may surface an empty subset.
 */
export const StudioConfigSubset = z.object({
  model: StudioModelId.optional(),
  toolsets: z.array(z.string()).optional(),
  agent: StudioAgentConfig.optional(),
  memory: StudioMemoryConfig.optional(),
})
export type StudioConfigSubset = z.infer<typeof StudioConfigSubset>

/**
 * Request body for the BFF config write (proxies PUT /api/config {config,
 * profile}). `config` is a PARTIAL patch of the subset: only the keys the user
 * changed. `profile` scopes the target agent (validated against the same
 * {@link ProfileName} regex the path guard enforces); omit it to target the
 * active profile. Hermes handles key normalization, locking, and routing any
 * secret to .env on its side.
 */
export const StudioConfigWriteRequest = z.object({
  /** The target agent. Omit (or send the active one) to target the active profile. */
  profile: ProfileName.optional(),
  /** The partial config patch, a subset of {@link StudioConfigSubset}. */
  config: StudioConfigSubset,
})
export type StudioConfigWriteRequest = z.infer<typeof StudioConfigWriteRequest>

/** Response from the config write. Mirrors stock's `{ ok: true }` (PUT /api/config). */
export const StudioConfigWriteResponse = z.object({
  ok: z.boolean(),
})
export type StudioConfigWriteResponse = z.infer<typeof StudioConfigWriteResponse>

/* -------------------------------------------------------------------------- */
/* Model options: the provider/model picker (GET /api/model/options)          */
/* -------------------------------------------------------------------------- */

/**
 * One provider row from GET /api/model/options. The stock payload shape (built
 * by `inventory.build_models_payload`, web_server.py:3079) carries the required
 * identity + model fields below, plus optional picker hints
 * (`authenticated`/`auth_type`/`key_env`/`warning`/`source`) for unconfigured
 * providers so the picker can render a setup affordance. Pricing/capability maps
 * the stock payload may also include are not part of the Studio picker contract;
 * parse() drops them (the picker needs only provider + model names).
 */
export const ModelOption = z.object({
  /** Provider slug (e.g. `anthropic`, `openrouter`). */
  slug: z.string(),
  /** Friendly provider label. */
  name: z.string(),
  /** Whether this provider is the profile's current one. */
  is_current: z.boolean(),
  /** Whether this is a user-defined / custom provider. */
  is_user_defined: z.boolean(),
  /** The curated model ids for this provider (may be empty for an unconfigured row). */
  models: z.array(z.string()),
  /** Total models the provider exposes (the curated `models` list may be capped). */
  total_models: z.number().int().nonnegative(),
  // ── optional picker hints (present for unconfigured / skeleton rows) ──
  /** Whether the provider has usable auth on this profile. */
  authenticated: z.boolean().optional(),
  /** The auth mechanism (e.g. `api-key`, `oauth`). */
  auth_type: z.string().nullable().optional(),
  /** The env key that configures this provider (e.g. `OPENROUTER_API_KEY`). */
  key_env: z.string().nullable().optional(),
  /** A setup hint shown when the provider is unconfigured. */
  warning: z.string().nullable().optional(),
  /** Row origin tag (e.g. `canonical` for a skeleton unconfigured row). */
  source: z.string().optional(),
})
export type ModelOption = z.infer<typeof ModelOption>

/**
 * The GET /api/model/options envelope: every provider row plus the profile's
 * currently-selected `{ model, provider }` (so the picker can pre-select).
 */
export const ModelOptionsResponse = z.object({
  providers: z.array(ModelOption),
  /** The profile's current model id (empty string if none resolved). */
  model: z.string(),
  /** The profile's current provider slug (empty string if none resolved). */
  provider: z.string(),
})
export type ModelOptionsResponse = z.infer<typeof ModelOptionsResponse>

/* -------------------------------------------------------------------------- */
/* Model set: PUT /api/profiles/{name}/model                                  */
/* -------------------------------------------------------------------------- */

/**
 * Request body for the per-profile model set (PUT /api/profiles/{name}/model).
 * Both fields required and non-empty (the stock route 400s on an empty
 * provider or model). The target agent comes from the URL path param, validated
 * by the route's {@link ProfileName} path guard. Setting the model here also
 * clears stale base_url/context_length on hermes's side (preferred over
 * patching the top-level `model` id via the config write).
 */
export const ProfileModelSetRequest = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
})
export type ProfileModelSetRequest = z.infer<typeof ProfileModelSetRequest>

/** Response from the model set. Mirrors stock's `{ ok, provider, model }`. */
export const ProfileModelSetResponse = z.object({
  ok: z.boolean(),
  provider: z.string(),
  model: z.string(),
})
export type ProfileModelSetResponse = z.infer<typeof ProfileModelSetResponse>

/* -------------------------------------------------------------------------- */
/* Env: the SLIM redacted view the Studio renders                             */
/* -------------------------------------------------------------------------- */

/**
 * One env entry as the Studio's Env section sees it: SHAPE ONLY. The Studio
 * shows which keys are set, never a value. The BFF derives this from stock's
 * per-key {is_set, redacted_value, ...} (GET /api/env?profile=) but the Studio
 * contract carries ONLY {key, isSet}: parse() drops any value or redacted
 * preview, so no secret material can reach the client through this DTO.
 *
 * The richer redacted-entry contract ({@link EnvVarEntry}) remains the
 * Credentials surface's; the Studio's view is deliberately thinner.
 */
export const RedactedEnvEntry = z.object({
  /** The env var name (e.g. `OPENAI_API_KEY`). */
  key: z.string().min(1),
  /** Whether a value is set on disk for this key. NEVER the value itself. */
  isSet: z.boolean(),
})
export type RedactedEnvEntry = z.infer<typeof RedactedEnvEntry>

/** The Studio Env section list response: only which keys are set. */
export const StudioEnvResponse = z.object({
  env: z.array(RedactedEnvEntry),
})
export type StudioEnvResponse = z.infer<typeof StudioEnvResponse>

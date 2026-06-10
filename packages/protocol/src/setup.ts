import { z } from 'zod'

/**
 * SETUP / onboarding contract — the typed shapes behind the first-run "Wake your
 * agent" wizard (detect Hermes → connect a model → name + face → first chat).
 *
 * The wizard is gated on a REAL readiness probe ({@link SetupStatus}), never the
 * `useOnboarded` localStorage bit. Provider connect can happen through the
 * Hermes-owned browser OAuth BFF or the provider-key path
 * (`hermes auth add <provider> --type api-key --api-key`); Agent Deck never owns
 * provider token storage.
 */

/**
 * The real first-run readiness, each field a genuine fs/exec check (NOT a
 * remembered flag): is the `hermes` binary present, is a usable model connected
 * (`/api/status` reports one), has the default agent been named/faced. The
 * wizard resumes on the first `false` rung.
 */
export const SetupStatus = z.object({
  /** `which hermes` + `hermes version` resolve. */
  hermesInstalled: z.boolean(),
  /** A usable model/provider is connected (the gateway reports one). */
  providerConnected: z.boolean(),
  /** The default agent has an identity (name + avatar) set. */
  agentNamed: z.boolean(),
})
export type SetupStatus = z.infer<typeof SetupStatus>

/**
 * Request body for `POST /api/agent-deck/setup/provider-key` — a guarded
 * `hermes auth add <provider> --type api-key --api-key <key>`.
 *
 * SECURITY: `apiKey` is a LIVE SECRET. The route masks it on input, NEVER echoes
 * it back (the response below carries no key), scrubs it from argv in any log,
 * and lets Hermes own persistence. `provider` stays a free string (Hermes
 * supports a long, open provider list) but is non-empty.
 */
export const AgentDeckProviderKeyRequest = z.object({
  /** The provider slug to connect (e.g. `openrouter`, `anthropic`). */
  provider: z.string().min(1),
  /** The API key — a secret; never logged, never echoed. */
  apiKey: z.string().min(1),
})
export type AgentDeckProviderKeyRequest = z.infer<typeof AgentDeckProviderKeyRequest>

/** Response for a provider-key connect — echoes the provider + result, NO key. */
export const AgentDeckProviderKeyResponse = z.object({
  /** The provider that was connected. */
  provider: z.string(),
  /** Whether a usable model is now reported after the add. */
  connected: z.boolean(),
})
export type AgentDeckProviderKeyResponse = z.infer<typeof AgentDeckProviderKeyResponse>

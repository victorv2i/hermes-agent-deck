import { z } from 'zod'

// ---------------------------------------------------------------------------
// PAIRING — approve / revoke / clear-pending for messaging platform users.
// Source: web_server.py:4620 GET /api/pairing, :4629 POST /api/pairing/approve,
//         :4651 POST /api/pairing/revoke, :4665 POST /api/pairing/clear-pending.
// ---------------------------------------------------------------------------

/** One pending or approved pairing entry. */
export const PairingUser = z.object({
  platform: z.string(),
  user_id: z.string(),
  user_name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  /** Age in minutes (pending entries carry this). */
  age_minutes: z.number().nullable().optional(),
})
export type PairingUser = z.infer<typeof PairingUser>

/** Response from GET /api/agent-deck/pairing. */
export const PairingState = z.object({
  pending: z.array(PairingUser),
  approved: z.array(PairingUser),
})
export type PairingState = z.infer<typeof PairingState>

/** POST /api/agent-deck/pairing/approve — approve a pending code. */
export const ApprovePairingRequest = z.object({
  platform: z.string().min(1),
  code: z.string().min(1),
})
export type ApprovePairingRequest = z.infer<typeof ApprovePairingRequest>

/** POST /api/agent-deck/pairing/revoke — revoke an approved user. */
export const RevokePairingRequest = z.object({
  platform: z.string().min(1),
  user_id: z.string().min(1),
})
export type RevokePairingRequest = z.infer<typeof RevokePairingRequest>

// ---------------------------------------------------------------------------
// WEBHOOKS — list / create / enable-disable / delete inbound subscriptions.
// Source: web_server.py:4712 GET /api/webhooks, :4728 POST /api/webhooks,
//         :4780 DELETE /api/webhooks/{name}, :4797 PUT /api/webhooks/{name}/enabled.
// ---------------------------------------------------------------------------

/** Summary of one webhook subscription (secret is NEVER included on list). */
export const WebhookSub = z.object({
  name: z.string(),
  description: z.string(),
  events: z.array(z.string()),
  deliver: z.string(),
  deliver_only: z.boolean(),
  prompt: z.string(),
  skills: z.array(z.string()),
  created_at: z.string().nullable().optional(),
  url: z.string(),
  /** True if the subscription has a secret configured (never the secret itself). */
  secret_set: z.boolean(),
  enabled: z.boolean(),
})
export type WebhookSub = z.infer<typeof WebhookSub>

/** Response from GET /api/agent-deck/webhooks. */
export const WebhooksState = z.object({
  /** Whether the webhook platform is enabled in the gateway config. */
  enabled: z.boolean(),
  base_url: z.string(),
  subscriptions: z.array(WebhookSub),
})
export type WebhooksState = z.infer<typeof WebhooksState>

/** POST /api/agent-deck/webhooks — create a new subscription. */
export const CreateWebhookRequest = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  events: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  skills: z.array(z.string()).optional(),
  deliver: z.string().optional(),
  deliver_only: z.boolean().optional(),
  deliver_chat_id: z.string().optional(),
})
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>

/**
 * Response from POST /api/agent-deck/webhooks.
 * Includes the secret ONCE at create time — never on subsequent reads.
 */
export const CreatedWebhookResponse = WebhookSub.extend({
  /** The HMAC secret, shown exactly once. Redacted on all subsequent reads. */
  secret: z.string(),
})
export type CreatedWebhookResponse = z.infer<typeof CreatedWebhookResponse>

// ---------------------------------------------------------------------------
// CREDENTIAL POOL — list / add / remove rotating API keys per provider.
// Source: web_server.py:4884 GET /api/credentials/pool,
//         :4911 POST /api/credentials/pool,
//         :4945 DELETE /api/credentials/pool/{provider}/{index}.
// ---------------------------------------------------------------------------

/** One pool entry (redacted — plaintext is NEVER returned). */
export const PoolEntry = z.object({
  /** 1-based index matching the DELETE path param. */
  index: z.number().int().positive(),
  id: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  auth_type: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  priority: z.number().optional(),
  last_status: z.string().nullable().optional(),
  request_count: z.number().optional(),
  /** Redacted token preview (e.g. "sk-...abc4"). NEVER the plaintext. */
  token_preview: z.string(),
  has_refresh: z.boolean(),
})
export type PoolEntry = z.infer<typeof PoolEntry>

/** Provider entry in the pool list: a provider id + its redacted entries. */
export const PoolProvider = z.object({
  provider: z.string(),
  entries: z.array(PoolEntry),
})
export type PoolProvider = z.infer<typeof PoolProvider>

/** Response from GET /api/agent-deck/credentials/pool. */
export const CredentialPoolState = z.object({
  providers: z.array(PoolProvider),
})
export type CredentialPoolState = z.infer<typeof CredentialPoolState>

/** POST /api/agent-deck/credentials/pool — add a key. */
export const AddCredentialRequest = z.object({
  provider: z.string().min(1),
  /** The API key. Write-only — NEVER echoed in any response. */
  api_key: z.string().min(1),
  label: z.string().optional(),
})
export type AddCredentialRequest = z.infer<typeof AddCredentialRequest>

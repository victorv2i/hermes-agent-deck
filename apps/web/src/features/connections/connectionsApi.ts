/**
 * Connections BFF client — thin wrappers over the agent-deck BFF endpoints that
 * proxy the REAL stock hermes pairing + webhooks + credential-pool routes.
 *
 * Secrets policy:
 *  - Pairing: codes flow read-only; only approve/revoke mutate state.
 *  - Webhooks: the HMAC secret is included ONCE in the create response
 *    (returned from this call so the UI can show it); all subsequent reads
 *    carry only secret_set: boolean.
 *  - Credentials: api_key is write-only; the GET response carries only
 *    token_preview (stock's own masked preview) — never the plaintext.
 */
import { apiFetch, apiPost, apiDelete, ApiError } from '@/lib/apiFetch'
import {
  PairingState,
  WebhooksState,
  CreatedWebhookResponse,
  CredentialPoolState,
  type ApprovePairingRequest,
  type RevokePairingRequest,
  type CreateWebhookRequest,
  type AddCredentialRequest,
} from '@agent-deck/protocol'

/**
 * True when an error means the route is ABSENT on this Hermes build (version
 * skew), not a real outage. The BFF preserves an upstream 404 as a distinct
 * `{ error: 'unsupported' }` (status 404), so the tabs can render an honest
 * "not available on this Hermes version" state instead of a generic error.
 */
export function isUnsupportedError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'unsupported')
}

// ── PAIRING ──────────────────────────────────────────────────────────────────

/** GET /api/agent-deck/pairing — pending + approved users. */
export async function fetchPairing(signal?: AbortSignal): Promise<PairingState> {
  return PairingState.parse(await apiFetch<unknown>('/pairing', { signal }))
}

/** POST /api/agent-deck/pairing/approve */
export async function approvePairing(req: ApprovePairingRequest): Promise<void> {
  await apiPost('/pairing/approve', req)
}

/** POST /api/agent-deck/pairing/revoke */
export async function revokePairing(req: RevokePairingRequest): Promise<void> {
  await apiPost('/pairing/revoke', req)
}

/** POST /api/agent-deck/pairing/clear-pending */
export async function clearPendingPairing(): Promise<{ cleared: number }> {
  return apiPost('/pairing/clear-pending', {})
}

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────

/** GET /api/agent-deck/webhooks — all subscriptions (secret not included). */
export async function fetchWebhooks(signal?: AbortSignal): Promise<WebhooksState> {
  return WebhooksState.parse(await apiFetch<unknown>('/webhooks', { signal }))
}

/**
 * POST /api/agent-deck/webhooks — create a subscription.
 * Returns the full entry INCLUDING the one-time secret.
 */
export async function createWebhook(req: CreateWebhookRequest): Promise<CreatedWebhookResponse> {
  return CreatedWebhookResponse.parse(await apiPost<unknown>('/webhooks', req))
}

/** DELETE /api/agent-deck/webhooks/:name */
export async function deleteWebhook(name: string): Promise<void> {
  await apiDelete(`/webhooks/${encodeURIComponent(name)}`)
}

/** PUT /api/agent-deck/webhooks/:name/enabled */
export async function setWebhookEnabled(name: string, enabled: boolean): Promise<void> {
  await apiFetch(`/webhooks/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

// ── CREDENTIAL POOL ───────────────────────────────────────────────────────────

/** GET /api/agent-deck/credentials/pool — redacted pool per provider. */
export async function fetchCredentialPool(signal?: AbortSignal): Promise<CredentialPoolState> {
  return CredentialPoolState.parse(await apiFetch<unknown>('/credentials/pool', { signal }))
}

/**
 * POST /api/agent-deck/credentials/pool — add an API key.
 * api_key is write-only — NEVER echoed in the response.
 */
export async function addCredential(req: AddCredentialRequest): Promise<{ count: number }> {
  return apiPost('/credentials/pool', req)
}

/** DELETE /api/agent-deck/credentials/pool/:provider/:index (1-based). */
export async function removeCredential(provider: string, index: number): Promise<void> {
  await apiDelete(`/credentials/pool/${encodeURIComponent(provider)}/${index}`)
}

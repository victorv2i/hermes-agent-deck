/**
 * The Connect rung's API-key path — the fallback connect step the BFF can drive
 * (`hermes auth add <provider> --type api-key --api-key`). Browser sign-in uses
 * Hermes-owned OAuth routes; this path is for providers that issue keys.
 *
 * SECURITY: the key is a LIVE SECRET. {@link maskKey} renders a display-only
 * mask (never the raw value) for the confirmation row; the raw value is sent to
 * the BFF exactly once and never echoed back (the response carries only the
 * provider + a connected bool — the route scrubs the key from argv/logs).
 */
import { apiPost } from '@/lib/apiFetch'
import type { AgentDeckProviderKeyResponse } from '@agent-deck/protocol'

/** How many trailing chars stay visible in a masked key (for recognition). */
const VISIBLE_TAIL = 4

/**
 * A display-only mask of a secret: every character before the last few becomes a
 * dot, so the user can confirm "yes, that's my key" without the UI ever showing
 * the secret. A short key (<= the tail) is masked ENTIRELY — no tail leak.
 */
export function maskKey(key: string): string {
  if (key.length === 0) return ''
  if (key.length <= VISIBLE_TAIL) return '•'.repeat(key.length)
  const tail = key.slice(-VISIBLE_TAIL)
  return '•'.repeat(key.length - VISIBLE_TAIL) + tail
}

/**
 * POST the provider + key to the BFF. Throws the BFF's typed ApiError on
 * failure (a bad key / network fault) so the rung shows an HONEST failure, never
 * a fake "connected".
 */
export function connectProviderKey(
  provider: string,
  apiKey: string,
): Promise<AgentDeckProviderKeyResponse> {
  return apiPost<AgentDeckProviderKeyResponse>('/setup/provider-key', { provider, apiKey })
}

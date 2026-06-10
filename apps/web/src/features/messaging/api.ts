import { apiFetch, apiPost } from '@/lib/apiFetch'
import {
  MessagingState,
  SetMessagingTokenResponse,
  type SetMessagingTokenRequest,
} from '@agent-deck/protocol'

/**
 * The Messaging surface's BFF client (agent-deck-OWN routes that PROXY hermes):
 *
 *   GET  /api/agent-deck/messaging        → MessagingState
 *   POST /api/agent-deck/messaging/token  → SetMessagingTokenResponse
 *
 * Every response is parsed through the shared protocol zod schema, so a partial
 * or unexpected payload throws here (caught by the query/mutation) rather than
 * rendering a half-built card. Tokens cross the wire SHAPE-ONLY — the request
 * carries the plaintext value once (to store it); the response NEVER echoes it
 * back, only `isSet` + a `redactedValue` preview.
 */

/** Read the full Messaging payload: every supported platform × its live state. */
export async function fetchMessaging(signal?: AbortSignal): Promise<MessagingState> {
  return MessagingState.parse(await apiFetch<unknown>('/messaging', { signal }))
}

/**
 * Store/replace a platform credential. The plaintext `value` is sent ONCE in the
 * request body; the BFF allowlists `(platform, envVar)` against the registry and
 * returns only the refreshed SHAPE-ONLY field state (never the plaintext).
 */
export async function setMessagingToken(
  request: SetMessagingTokenRequest,
): Promise<SetMessagingTokenResponse> {
  return SetMessagingTokenResponse.parse(await apiPost<unknown>('/messaging/token', request))
}

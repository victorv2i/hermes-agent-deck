import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  MessagingState,
  SetMessagingTokenRequest,
  SetMessagingTokenResponse,
} from '@agent-deck/protocol'
import { fetchMessaging, setMessagingToken } from './api'

const messagingKey = ['agent-deck', 'messaging'] as const

/**
 * Read the Messaging surface state (every platform × live connection + token
 * shape). Refetches on focus so a change made elsewhere (a token set from the
 * CLI, a platform that connected after a restart) shows when the user returns. A
 * modest `staleTime` keeps the surface from hammering the gateway status probe.
 */
export function useMessaging() {
  return useQuery<MessagingState>({
    queryKey: messagingKey,
    queryFn: ({ signal }) => fetchMessaging(signal),
    staleTime: 10_000,
  })
}

/**
 * Re-read the Messaging surface on demand — the honest "did the connection flip?"
 * after a gateway restart. Returns a callback that invalidates the query so
 * `useMessaging` refetches the gateway's REAL per-platform state (never a guess).
 */
export function useRefreshMessaging(): () => void {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: messagingKey })
  }
}

/**
 * Store/replace a platform credential. On settle we invalidate the Messaging read
 * so each card re-resolves its `isSet` / `redactedValue` from a fresh fetch — the
 * stored token only takes effect after a gateway restart (`restartRequired`), so
 * the card prompts "Restart to apply" rather than faking a connected state.
 */
export function useSetMessagingToken() {
  const qc = useQueryClient()
  return useMutation<SetMessagingTokenResponse, Error, SetMessagingTokenRequest>({
    mutationFn: (request) => setMessagingToken(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: messagingKey })
    },
  })
}

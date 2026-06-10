import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from './api'

export interface BindPosture {
  /** True when the server is bound to a non-loopback host (remote-reachable). */
  remote: boolean
  /** Whether the interactive terminal is enabled on this bind. */
  terminalEnabled: boolean
  /** Whether API/socket access requires the browser token. */
  authRequired: boolean
}

/**
 * Read the server's bind posture from the health probe so the UI can be HONEST
 * about remote mode (header banner) without guessing from the page URL — the
 * server is the source of truth for how it is actually bound.
 *
 * Defaults to a safe non-remote posture until the probe resolves (no false
 * alarm on first paint), and stays non-remote if the probe fails. Cached for the
 * session (the bind posture does not change without a server restart).
 */
export function useBindPosture(): BindPosture {
  const { data } = useQuery({
    queryKey: ['health', 'bind'],
    queryFn: fetchHealth,
    staleTime: Infinity,
    retry: false,
  })
  return {
    remote: data?.bind.remote ?? false,
    terminalEnabled: data?.bind.terminalEnabled ?? true,
    authRequired: data?.bind.authRequired ?? false,
  }
}

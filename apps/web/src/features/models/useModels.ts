import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  connectProvider,
  fetchModels,
  fetchProviderOAuthProviders,
  setActiveModel,
  type SetModelResult,
} from './api'
import type { ModelsResponse, ProviderConnectResult } from './types'

/** The models-roster query key, shared so other features (the gateway restart)
 * can invalidate this read instead of duplicating the literal. */
export const modelsKey = ['agent-deck', 'models'] as const
const oauthProvidersKey = ['agent-deck', 'provider-oauth'] as const

/**
 * React Query hook for the Models surface. Refetches on focus so a model change
 * made elsewhere (dashboard / CLI) is reflected when the user returns to the tab.
 */
export function useModels() {
  return useQuery<ModelsResponse>({
    queryKey: modelsKey,
    queryFn: ({ signal }) => fetchModels(signal),
    staleTime: 15_000,
  })
}

/**
 * The LIVE set of provider slugs Hermes can OAuth, from
 * `GET /api/agent-deck/provider-oauth`. Drives the connect dialog's
 * oauth-capable set so it tracks the running Hermes (and surfaces OAuth
 * providers the static catalog hasn't enumerated) instead of drifting. On
 * failure `fetchProviderOAuthProviders` returns an empty set, so the dialog
 * falls back to the static catalog.
 */
export function useProviderOAuthProviders() {
  return useQuery<Set<string>>({
    queryKey: oauthProvidersKey,
    queryFn: ({ signal }) => fetchProviderOAuthProviders(signal),
    staleTime: 60_000,
  })
}

interface ConnectVars {
  provider: string
  apiKey: string
}

/**
 * Mutation for the "Connect a provider" affordance. POSTs the slug + key to the
 * live setup BFF route; on success it INVALIDATES the models query so the list
 * re-checks and a newly-usable model appears. The key lives only in the
 * mutation variables for the duration of the request — never cached.
 */
export function useConnectProvider() {
  const qc = useQueryClient()
  return useMutation<ProviderConnectResult, Error, ConnectVars>({
    mutationFn: ({ provider, apiKey }) => connectProvider(provider, apiKey),
    onSuccess: () => {
      // Re-check the roster — a successful add may surface new usable models.
      qc.invalidateQueries({ queryKey: modelsKey })
    },
  })
}

interface SetModelVars {
  provider: string
  model: string
  /** The user's EXPLICIT answer to the gateway's expensive-model guard. Only
   * pass true after they confirmed the surfaced `confirmMessage`. */
  confirmExpensiveModel?: boolean
}

/**
 * Mutation for the REAL cross-provider switch — proxies the stock
 * `POST /api/model/set` (via `setActiveModel`). Used by the composer's picker
 * (when a pick changes provider) AND by the Models page's "Set as active"
 * action. On a REAL switch it INVALIDATES the models query so the active model
 * + the `usable`/active flags re-resolve and the UI reflects the pick; a
 * `confirm-required` resolution did NOT switch anything (the expensive-model
 * guard declined), so nothing is invalidated and the caller must surface the
 * confirm. A rejection propagates the typed `ApiError`, which the caller turns
 * into an honest toast.
 */
export function useSetModel() {
  const qc = useQueryClient()
  return useMutation<SetModelResult, Error, SetModelVars>({
    mutationFn: ({ provider, model, confirmExpensiveModel }) =>
      setActiveModel(provider, model, confirmExpensiveModel === true),
    onSuccess: (result) => {
      if (result.status === 'switched') {
        qc.invalidateQueries({ queryKey: modelsKey })
      }
    },
  })
}

import { apiFetch } from '@/lib/apiFetch'
import type {
  SessionListResponse,
  SessionDetail,
  SessionMessagesResponse,
  SessionSearchResponse,
  SessionStats,
  SessionPatchRequest,
  SessionPatchResponse,
  SessionPruneRequest,
  SessionPruneResponse,
  SessionExportPayload,
} from './types'

/**
 * Thin fetch helpers for the Sessions BFF REST surface (same-origin; Vite
 * proxies `/api` to the BFF in dev). Each throws on a non-2xx (via the shared
 * apiFetch) so TanStack Query surfaces the error state. The bearer token, when
 * present, rides along automatically.
 */

function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(path, signal ? { signal } : {})
}

export interface ListSessionsParams {
  limit?: number
  offset?: number
  source?: string
}

export function fetchSessions(
  params: ListSessionsParams = {},
  signal?: AbortSignal,
): Promise<SessionListResponse> {
  const sp = new URLSearchParams()
  if (params.limit !== undefined) sp.set('limit', String(params.limit))
  if (params.offset !== undefined) sp.set('offset', String(params.offset))
  if (params.source) sp.set('source', params.source)
  const qs = sp.toString()
  return getJson<SessionListResponse>(`/sessions${qs ? `?${qs}` : ''}`, signal)
}

export function fetchSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
  return getJson<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, signal)
}

export function fetchSessionMessages(
  id: string,
  signal?: AbortSignal,
): Promise<SessionMessagesResponse> {
  return getJson<SessionMessagesResponse>(`/sessions/${encodeURIComponent(id)}/messages`, signal)
}

export function searchSessions(q: string, signal?: AbortSignal): Promise<SessionSearchResponse> {
  return getJson<SessionSearchResponse>(`/search/sessions?q=${encodeURIComponent(q)}`, signal)
}

/** Destructive: delete a session via the BFF (proxies the dashboard's real
 * `DELETE /api/sessions/{id}`). Resolves on success; throws an ApiError (404
 * unknown / 502 upstream) so the mutation surfaces the failure. */
export function deleteSession(id: string): Promise<{ deleted: true }> {
  return apiFetch<{ deleted: true }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Fetch session store statistics (total/archived/by_source). */
export function fetchSessionStats(signal?: AbortSignal): Promise<SessionStats> {
  return apiFetch<SessionStats>('/sessions/stats', signal ? { signal } : {})
}

/**
 * Rename and/or archive a session. Both fields are optional but at least one
 * must be provided. Throws on 400 (bad title) or 404 (unknown session).
 */
export function patchSession(
  id: string,
  patch: SessionPatchRequest,
): Promise<SessionPatchResponse> {
  return apiFetch<SessionPatchResponse>(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/**
 * Export a session as a JSON payload (metadata + messages). The caller is
 * responsible for triggering a browser download from the returned blob.
 */
export function exportSession(id: string, signal?: AbortSignal): Promise<SessionExportPayload> {
  return apiFetch<SessionExportPayload>(
    `/sessions/${encodeURIComponent(id)}/export`,
    signal ? { signal } : {},
  )
}

/**
 * Prune ended sessions older than N days. Returns the count of removed sessions.
 */
export function pruneSessions(req: SessionPruneRequest): Promise<SessionPruneResponse> {
  return apiFetch<SessionPruneResponse>('/sessions/prune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

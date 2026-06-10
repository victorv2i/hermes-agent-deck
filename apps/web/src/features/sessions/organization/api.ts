import { apiFetch, apiPost } from '@/lib/apiFetch'
import {
  Organization,
  type Project,
  type ProjectCreateInput,
  type ProjectUpdateInput,
  type SessionAssignment,
  type SessionOrganizationInput,
} from '@agent-deck/protocol'

/**
 * Thin fetch helpers for Agent Deck's OWN organization BFF (`/api/agent-deck/
 * organization` + the project / session-org mutations). Unlike the read-only
 * session proxy, this surface owns a server-side store, so these are real
 * create/update/delete calls. Each rides the shared `apiFetch` (auth + ok-check
 * + typed ApiError), so failures surface the same calm way as every other
 * surface and the mutation hooks can revert.
 */

/**
 * GET the full organization store ({ projects, assignments }). The response is
 * VALIDATED through the protocol schema (not just cast): this query's result
 * drives render-time `Object.values(assignments)` in the rail, so a malformed or
 * partial payload must reject CLEANLY (→ the query's `isError` → the rail's
 * `EMPTY_ORGANIZATION` fallback) rather than crash the whole app on render. The
 * one read whose shape is load-bearing earns a parse guard.
 */
export async function fetchOrganization(signal?: AbortSignal): Promise<Organization> {
  const raw = await apiFetch<unknown>('/organization', signal ? { signal } : {})
  return Organization.parse(raw)
}

/** POST a new project (server assigns the id). */
export function createProject(input: ProjectCreateInput): Promise<Project> {
  return apiPost<Project>('/projects', input)
}

/** PATCH a project's name and/or color. */
export function updateProject(id: string, patch: ProjectUpdateInput): Promise<Project> {
  return apiFetch<Project>(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** DELETE a project (the server also clears its assignments). */
export function deleteProject(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * PUT a session's full organization (project membership + the complete desired
 * tag set). `projectId: null` clears membership; the server normalizes tags.
 */
export function setSessionOrganization(
  id: string,
  input: SessionOrganizationInput,
): Promise<SessionAssignment> {
  return apiFetch<SessionAssignment>(`/sessions/${encodeURIComponent(id)}/organization`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

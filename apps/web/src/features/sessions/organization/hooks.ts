import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  Organization,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  SessionAssignment,
  SessionOrganizationInput,
} from '@agent-deck/protocol'
import {
  createProject,
  deleteProject,
  fetchOrganization,
  setSessionOrganization,
  updateProject,
} from './api'

/**
 * TanStack Query hooks for Agent Deck's organization layer (projects + tags).
 * One query — `['organization']` — backs the whole sessions pane (the Projects
 * section, the tag chips, the active filter, and the per-session assignment
 * menu all read the same cache). Every mutation invalidates that one key so the
 * rail re-derives counts/filters from fresh server state; the store is small
 * (advisory metadata), so a refetch is cheap and keeps a single source of truth
 * across the user's devices.
 */

export const organizationKeys = {
  all: ['organization'] as const,
}

/** The organization store ({ projects, assignments }). Backs the entire pane. */
export function useOrganization(): UseQueryResult<Organization> {
  return useQuery({
    queryKey: organizationKeys.all,
    queryFn: ({ signal }) => fetchOrganization(signal),
    // Organization rarely changes out-of-band; keep it fresh on focus but don't
    // hammer the store. Mutations invalidate it explicitly.
    staleTime: 30_000,
  })
}

/** Create a project; on success the store query refetches (new project + count). */
export function useCreateProject(): UseMutationResult<Project, Error, ProjectCreateInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ProjectCreateInput) => createProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  })
}

/** Rename/recolor a project; invalidates the store on success. */
export function useUpdateProject(): UseMutationResult<
  Project,
  Error,
  { id: string; patch: ProjectUpdateInput }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProjectUpdateInput }) =>
      updateProject(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  })
}

/** Delete a project (server clears its assignments); invalidates the store. */
export function useDeleteProject(): UseMutationResult<{ ok: true }, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  })
}

/**
 * Set a session's project membership + full tag set. Invalidates the store so
 * the rail re-filters/re-counts. The caller passes the FULL desired tags array
 * (add/remove is computed UI-side); the server normalizes.
 */
export function useSetSessionOrganization(): UseMutationResult<
  SessionAssignment,
  Error,
  { id: string; input: SessionOrganizationInput }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SessionOrganizationInput }) =>
      setSessionOrganization(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  })
}

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  fetchSkills,
  fetchSkillBody,
  writeSkillBody,
  createSkill,
  deleteSkill,
  toggleSkill,
} from './api'
import type { Skill, SkillBody, SkillsResponse } from './types'

/**
 * React Query hooks for the Skills surface.
 *
 * `useSkills` reads the list (refetches on focus so a toggle made elsewhere —
 * dashboard / CLI — is reflected on return). `useToggleSkill` is OPTIMISTIC: it
 * flips the skill's `enabled` in the cache immediately, reverts on error, and
 * invalidates on settle so the server's truth wins. This gives the toggle an
 * instant feel without risking a stale view if the dashboard rejects the change.
 *
 * The body-read + create/edit/delete hooks back the on-disk CRUD: each mutation
 * invalidates the list so a create/delete is reflected, and the body read is
 * keyed per skill path.
 */

export const skillsKeys = {
  all: ['agent-deck', 'skills'] as const,
  body: (path: string) => ['agent-deck', 'skills', 'body', path] as const,
}

export function useSkills(): UseQueryResult<SkillsResponse> {
  return useQuery<SkillsResponse>({
    queryKey: skillsKeys.all,
    queryFn: ({ signal }) => fetchSkills(signal),
    staleTime: 15_000,
  })
}

interface ToggleVars {
  name: string
  enabled: boolean
}

export function useToggleSkill() {
  const qc = useQueryClient()
  return useMutation<
    { name: string; enabled: boolean },
    Error,
    ToggleVars,
    { prev?: SkillsResponse }
  >({
    mutationFn: ({ name, enabled }: ToggleVars) => toggleSkill(name, enabled),
    onMutate: async ({ name, enabled }) => {
      // Cancel in-flight reads so they don't clobber the optimistic write.
      await qc.cancelQueries({ queryKey: skillsKeys.all })
      const prev = qc.getQueryData<SkillsResponse>(skillsKeys.all)
      if (prev) {
        qc.setQueryData<SkillsResponse>(skillsKeys.all, {
          skills: prev.skills.map((s: Skill) => (s.name === name ? { ...s, enabled } : s)),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      // Revert to the snapshot taken before the optimistic write.
      if (ctx?.prev) qc.setQueryData(skillsKeys.all, ctx.prev)
    },
    onSettled: () => {
      // Reconcile with the server's truth either way.
      qc.invalidateQueries({ queryKey: skillsKeys.all })
    },
  })
}

/** Read a skill's editable SKILL.md body. Disabled (no fetch) when path is null. */
export function useSkillBody(path: string | null): UseQueryResult<SkillBody> {
  return useQuery<SkillBody>({
    queryKey: skillsKeys.body(path ?? ''),
    queryFn: ({ signal }) => fetchSkillBody(path!, signal),
    enabled: path !== null,
    // The body changes on disk (the user edits it elsewhere); keep it fresh but
    // cache within a view so re-opening the editor is instant.
    staleTime: 2_000,
  })
}

/** Save a skill's SKILL.md body; invalidates that body so the viewer reflects it. */
export function useWriteSkillBody(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => writeSkillBody(path, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillsKeys.body(path) })
    },
  })
}

/** Create a new skill; invalidates the list so the new row appears. */
export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, category }: { name: string; category?: string | null }) =>
      createSkill(name, category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillsKeys.all })
    },
  })
}

/** Delete a skill; invalidates the list so the row disappears. */
export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => deleteSkill(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillsKeys.all })
    },
  })
}

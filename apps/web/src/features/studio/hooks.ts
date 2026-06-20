/**
 * TanStack Query hooks for the Agent Studio. Every read is keyed by the SELECTED
 * agent, so two agents never share a cache entry and switching the workbench's
 * agent loads that agent's own config/model/soul/env. Every write
 * invalidates exactly the scoped key(s) it affects so the surface reconciles
 * with Hermes's truth: honest, never a faked local-only update.
 *
 * The roster-changing actions (create/clone, switch-active) invalidate the
 * SHARED profiles roster key ({@link profileKeys}.all), so the roster cards, the
 * presence chip, and any other surface reading the roster all refresh together.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type {
  StudioConfigSubset,
  StudioConfigWriteRequest,
  ModelOptionsResponse,
  ProfileModelSetResponse,
  StudioEnvResponse,
} from '@agent-deck/protocol'
import { profileKeys } from '@/features/profiles/useProfiles'
import {
  fetchStudioConfig,
  writeStudioConfig,
  fetchModelOptions,
  setProfileModel,
  fetchSoul,
  writeSoul,
  fetchStudioSkills,
  toggleStudioSkill,
  fetchStudioEnv,
  setStudioEnv,
  createStudioProfile,
  switchActiveProfile,
  exportAgent,
  importAgent,
  type SoulFile,
  type StudioSkill,
  type CreateStudioProfileInput,
  type CreatedStudioProfile,
  type SetEnvResult,
} from './data/api'

/**
 * The stable cache-key for a profile-scoped Studio read. A null agent (target
 * the ACTIVE profile) gets its own sentinel segment so it never collides with a
 * literal agent named in the roster.
 */
function scope(agent: string | null): string {
  return agent ?? '__active__'
}

export const studioKeys = {
  config: (agent: string | null) => ['studio', 'config', scope(agent)] as const,
  modelOptions: (agent: string | null) => ['studio', 'model-options', scope(agent)] as const,
  soul: (agent: string | null) => ['studio', 'soul', scope(agent)] as const,
  skills: (agent: string | null) => ['studio', 'skills', scope(agent)] as const,
  env: (agent: string | null) => ['studio', 'env', scope(agent)] as const,
  /** The SHARED roster key (so create/switch refresh the roster everywhere). */
  profiles: () => profileKeys.all,
}

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/** Read the selected agent's config subset (null targets the active profile). */
export function useStudioConfig(agent: string | null): UseQueryResult<StudioConfigSubset> {
  return useQuery({
    queryKey: studioKeys.config(agent),
    queryFn: ({ signal }) => fetchStudioConfig(agent, signal),
    staleTime: 10_000,
  })
}

/** Write a partial config patch to the selected agent; invalidates its config. */
export function useWriteStudioConfig(agent: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: StudioConfigWriteRequest['config']) => writeStudioConfig(agent, config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.config(agent) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/** Read the model picker options for the selected agent. Idle when none selected. */
export function useModelOptions(agent: string | null): UseQueryResult<ModelOptionsResponse> {
  return useQuery({
    queryKey: studioKeys.modelOptions(agent),
    queryFn: ({ signal }) => fetchModelOptions(agent, signal),
    enabled: agent !== null,
    staleTime: 30_000,
  })
}

/**
 * Set the selected agent's model. Requires a concrete agent (the name is the
 * route path param). Invalidates BOTH model options (the current selection moved)
 * and the config (its top-level `model` id changed).
 */
export function useSetProfileModel(agent: string) {
  const qc = useQueryClient()
  return useMutation<ProfileModelSetResponse, Error, { provider: string; model: string }>({
    mutationFn: ({ provider, model }) => setProfileModel(agent, provider, model),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.modelOptions(agent) })
      void qc.invalidateQueries({ queryKey: studioKeys.config(agent) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Soul                                                                       */
/* -------------------------------------------------------------------------- */

/** Read the selected agent's SOUL.md. Idle when no agent is selected. */
export function useSoul(agent: string | null): UseQueryResult<SoulFile> {
  return useQuery({
    queryKey: studioKeys.soul(agent),
    queryFn: ({ signal }) => fetchSoul(agent!, signal),
    enabled: agent !== null,
    // The soul changes on disk (edited elsewhere); keep it fresh but cache within a view.
    staleTime: 2_000,
  })
}

/** Save the selected agent's SOUL.md; invalidates its soul so the editor reflects it. */
export function useWriteSoul(agent: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => writeSoul(agent, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.soul(agent) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Skills (per-agent)                                                         */
/* -------------------------------------------------------------------------- */

/** Read the SELECTED agent's skills (null targets the active profile). */
export function useStudioSkills(agent: string | null): UseQueryResult<StudioSkill[]> {
  return useQuery({
    queryKey: studioKeys.skills(agent),
    queryFn: ({ signal }) => fetchStudioSkills(agent, signal),
    staleTime: 15_000,
  })
}

interface ToggleSkillVars {
  name: string
  enabled: boolean
}

/**
 * Toggle a skill for the SELECTED agent. OPTIMISTIC: it flips the skill's
 * `enabled` in that agent's scoped cache immediately, reverts on error, and
 * invalidates on settle so hermes's truth wins. The toggle writes the agent's
 * `skills.disabled` list; the change applies on the agent's NEXT session (the
 * Skills section carries the honest "restart to apply" note).
 */
export function useToggleStudioSkill(agent: string | null) {
  const qc = useQueryClient()
  return useMutation<
    { name: string; enabled: boolean },
    Error,
    ToggleSkillVars,
    { prev?: StudioSkill[] }
  >({
    mutationFn: ({ name, enabled }) => toggleStudioSkill(agent, name, enabled),
    onMutate: async ({ name, enabled }) => {
      const key = studioKeys.skills(agent)
      // Cancel in-flight reads so they don't clobber the optimistic write.
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<StudioSkill[]>(key)
      if (prev) {
        qc.setQueryData<StudioSkill[]>(
          key,
          prev.map((s) => (s.name === name ? { ...s, enabled } : s)),
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(studioKeys.skills(agent), ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.skills(agent) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Env                                                                        */
/* -------------------------------------------------------------------------- */

/** Read which env keys are set for the selected agent (shape-only, never a value). */
export function useStudioEnv(agent: string | null): UseQueryResult<StudioEnvResponse> {
  return useQuery({
    queryKey: studioKeys.env(agent),
    queryFn: ({ signal }) => fetchStudioEnv(agent, signal),
    staleTime: 10_000,
  })
}

interface SetEnvVars {
  key: string
  value: string
}

/** Set an env var for the selected agent; invalidates its env (set/unset) list. */
export function useSetStudioEnv(agent: string | null) {
  const qc = useQueryClient()
  return useMutation<SetEnvResult, Error, SetEnvVars>({
    mutationFn: ({ key, value }) => setStudioEnv(agent, key, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.env(agent) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Profiles: create+clone, switch                                             */
/* -------------------------------------------------------------------------- */

/** Create (or clone) an agent; invalidates the roster so the new card appears. */
export function useCreateStudioProfile() {
  const qc = useQueryClient()
  return useMutation<CreatedStudioProfile, Error, CreateStudioProfileInput>({
    mutationFn: (input) => createStudioProfile(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.profiles() })
    },
  })
}

/**
 * Switch the active agent; invalidates the roster so the Active badge moves. The
 * gateway is NOT restarted by this, so the caller must surface the honest
 * "restart to apply" note (see the profiles mutations' switchAppliedLine).
 */
export function useSwitchActiveProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => switchActiveProfile(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.profiles() })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Profile export / import                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Export an agent as a `.tar.gz` (a browser download). No cache to touch — the
 * BFF streams hermes' credential-free archive straight to the browser.
 */
export function useExportStudioProfile() {
  return useMutation<void, Error, string>({
    mutationFn: (name: string) => exportAgent(name),
  })
}

/**
 * Import an agent from a `.tar.gz`; invalidates the roster so the new card
 * appears. The bytes ride as base64 to the BFF, which shells out to hermes.
 */
export function useImportStudioProfile() {
  const qc = useQueryClient()
  return useMutation<{ name: string }, Error, { name: string; archiveBase64: string }>({
    mutationFn: ({ name, archiveBase64 }) => importAgent(name, archiveBase64),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.profiles() })
    },
  })
}

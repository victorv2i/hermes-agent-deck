/**
 * Profile WRITE clients + TanStack hooks - the shared spine for the three
 * identity actions (create / switch / set-avatar). Every place that switches an
 * agent (the Agents hub, the presence-chip switcher, ⌘K) uses the SAME
 * `useSwitchProfile()` so the behavior — and crucially the HONEST restart
 * messaging — is identical everywhere.
 *
 * Talks to the LIVE F2 BFF routes (apps/server/src/profiles/profilesRoute.ts):
 *   POST /api/agent-deck/profiles          { name, avatar? } -> 201 { name, avatar? }
 *   POST /api/agent-deck/profiles/switch   { name }          -> { active }
 *   PUT  /api/agent-deck/profiles/:name/avatar { avatar }    -> { ok }
 *
 * Honest switch: writing `active_profile` does NOT by itself restart the gateway.
 * The mutation result carries the restart-required line; callers surface that
 * and can offer the browser restart route, never a fake success.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AvatarId, SoulPresetId } from '@agent-deck/protocol'
import { apiFetch, apiPost } from '@/lib/apiFetch'
import { profileKeys } from './useProfiles'

/**
 * The verbatim honest restart line shown after a switch (no fake "switched").
 * Explains the WHY for a non-technical reader: Hermes runs ONE agent at a time, so
 * the new active agent only takes over after a gateway restart. This is a real
 * Hermes constraint (a single active profile + one gateway), not an Agent Deck
 * limitation — and never implies two agents can run at once.
 */
export function switchAppliedLine(name: string): string {
  return `Switched to ${name}. Hermes runs one agent at a time, so restart to make ${name} the active agent.`
}

/**
 * The calm second line under a switch's restart card: reassures a non-technical
 * reader that this is a normal Hermes constraint (one agent active at a time), and
 * that the restart is brief — never implying two agents can run at once.
 */
export const SWITCH_RESTART_NOTE =
  'The restart hands the gateway over to the new agent. Your other agents stay just as they are.'

/** The exact command that applies a switch (restart the gateway). Copyable. */
export function restartCommand(): string {
  return 'hermes gateway restart'
}

export interface CreateProfileInput {
  name: string
  avatar?: AvatarId
  /** SOUL preset chosen at the Hatch moment; the BFF writes it to SOUL.md. */
  soulPreset?: SoulPresetId
}

export interface CreatedProfile {
  name: string
  avatar?: AvatarId
}

export function createProfile(input: CreateProfileInput): Promise<CreatedProfile> {
  return apiPost<CreatedProfile>('/profiles', input)
}

export function switchProfile(name: string): Promise<{ active: string }> {
  return apiPost<{ active: string }>('/profiles/switch', { name })
}

/**
 * Rename an agent. POSTs the new name to the rename route; the BFF canonicalizes
 * and validates names, rejects `default` rename cases before exec, then runs
 * guarded `hermes profile rename <old> <new>` (argv, no shell). The source name
 * is path-encoded.
 */
export function renameProfile(oldName: string, newName: string): Promise<{ name: string }> {
  return apiPost<{ name: string }>(`/profiles/${encodeURIComponent(oldName)}/rename`, { newName })
}

export function writeAvatar(
  name: string,
  avatar: AvatarId,
  displayName?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = { avatar }
  // The BFF treats `displayName` precisely: ABSENT preserves the existing name
  // (an avatar-only edit must never wipe it), an explicit BLANK string clears it,
  // a non-blank string sets it. So we forward `undefined` as omission, but send
  // any provided string verbatim (trimmed) — including '' — so the identity
  // editor can both set AND clear a display name.
  if (displayName !== undefined) body.displayName = displayName.trim()
  return apiFetch<{ ok: boolean }>(`/profiles/${encodeURIComponent(name)}/avatar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Create an agent (born with an optional face); refetch the roster on success. */
export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProfile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}

/**
 * Switch the active agent. The roster is refetched so the `active` flag + the
 * presence chip reflect the new `active_profile` write — but the GATEWAY is NOT
 * restarted, so callers must show the honest restart line, never a fake success.
 */
export function useSwitchProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: switchProfile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}

/**
 * Rename the active or any agent; refetch the roster so the renamed agent (and
 * its active flag, presence chip, skill scope) reflects the new name. The caller
 * navigates to the new `/profiles/:name` on success.
 */
export function useRenameProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      renameProfile(oldName, newName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}

/** Persist a profile's chosen built-in avatar (and optional display name); refetch so every face updates. */
export function useWriteAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      name,
      avatar,
      displayName,
    }: {
      name: string
      avatar: AvatarId
      displayName?: string
    }) => writeAvatar(name, avatar, displayName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}

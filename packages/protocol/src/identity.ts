import { z } from 'zod'
import { SoulPresetId } from './soulPresets'

/**
 * Agent IDENTITY contract — the typed shapes behind "your agent has a face, a
 * name, and a home you tend." Shared by the BFF (which reads/writes a profile's
 * `.agent-deck/identity.json` and execs `hermes profile create`) and the web
 * client (the presence chip, switcher, ⌘K, the create ceremony, the picker).
 *
 * Identity is rendered in IDENTITY color and is NEVER the amber `--primary`
 * action accent (design spine).
 */

/**
 * Profile / agent name pattern — hoisted verbatim from hermes_cli/profiles.py
 * `_PROFILE_ID_RE` so the web client and the BFF validate a name against the
 * EXACT same closed rule (a single lowercase segment; no traversal, no casing,
 * no control chars). A shared source kills client/server drift — the regex a
 * dialog disables "Create" on is provably the one the path guard enforces.
 */
export const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** True iff `name` is a legal hermes profile/agent id. */
export function isProfileId(name: string): boolean {
  return PROFILE_ID_RE.test(name)
}

/** A validated profile/agent name (single segment, {@link PROFILE_ID_RE}). */
export const ProfileName = z.string().regex(PROFILE_ID_RE, 'invalid profile name')
export type ProfileName = z.infer<typeof ProfileName>

/**
 * The built-in agent-avatar ids: the committed, owner-approved set served from
 * `apps/web/public/avatars/<id>.webp`. Six simplified-manga deity/muse persona
 * portraits (Mnemosyne, Hermes, Athena, Iris, Apollo, Nyx), each a distinct
 * identity a user bonds with as "their agent". An ordered tuple so the picker
 * renders a stable grid and a deterministic name-hash default can index into it.
 */
// prettier-ignore
export const BUILTIN_AVATAR_IDS = [
  'v1', 'v2', 'v3', 'v4', 'v5', 'v6',
] as const
export const AvatarId = z.enum(BUILTIN_AVATAR_IDS)
export type AvatarId = z.infer<typeof AvatarId>

/**
 * A profile's chosen identity — the `.agent-deck/identity.json` shape. `avatar`
 * is `null` when unset, so the UI resolves a deterministic default by name hash
 * (the agent always has a face). `displayName` is the user-chosen display name for
 * the agent (e.g. "Mercury") — present when the user typed one in the wizard or
 * renamed it; null/absent means fall back to the profile id or "your agent" copy.
 * The reader parses tolerantly (a missing or garbled file → `{ avatar: null }`),
 * so this strict shape is the WRITE/target contract; reads use `safeParse` with a
 * null fallback.
 */
export const ProfileIdentity = z.object({
  avatar: AvatarId.nullable(),
  displayName: z.string().max(64).nullable().optional(),
})
export type ProfileIdentity = z.infer<typeof ProfileIdentity>

/** Request body for `PUT /api/agent-deck/profiles/:name/avatar`. */
export const AgentDeckAvatarWriteRequest = z.object({
  avatar: AvatarId,
  /** Optional display name — the wizard writes this to persist the typed agent name. */
  displayName: z.string().max(64).optional(),
})
export type AgentDeckAvatarWriteRequest = z.infer<typeof AgentDeckAvatarWriteRequest>

/**
 * Request body for `POST /api/agent-deck/profiles` (the create ceremony). The
 * name is regex-validated client-side AND re-validated server-side before any
 * exec. An optional `avatar` lets the agent be "born with a face" in one call.
 */
export const AgentDeckProfileCreateRequest = z.object({
  name: ProfileName,
  avatar: AvatarId.optional(),
  /**
   * Optional SOUL preset chosen at the birth ("Hatch") moment. When present and
   * not `default`, the BFF writes that preset's template to the new profile's
   * SOUL.md after create (default relies on Hermes' own seed). Omitted = default.
   */
  soulPreset: SoulPresetId.optional(),
})
export type AgentDeckProfileCreateRequest = z.infer<typeof AgentDeckProfileCreateRequest>

/** Request body for `POST /api/agent-deck/profiles/switch` (writes active_profile). */
export const AgentDeckProfileSwitchRequest = z.object({
  name: ProfileName,
})
export type AgentDeckProfileSwitchRequest = z.infer<typeof AgentDeckProfileSwitchRequest>

/**
 * Request body for `POST /api/agent-deck/profiles/:name/rename`. The TARGET name
 * is validated here (PROFILE_ID_RE); the SOURCE name comes from the URL param and
 * is validated by the same regex in the route's path guard before any exec. Stock
 * hermes `profile rename` rejects renaming the `default` profile and renaming TO
 * `default`, so those cases surface as an honest CLI error (not faked here).
 */
export const AgentDeckProfileRenameRequest = z.object({
  newName: ProfileName,
})
export type AgentDeckProfileRenameRequest = z.infer<typeof AgentDeckProfileRenameRequest>

import type { AvatarId } from '@agent-deck/protocol'
import { resolveAvatar, type ProfileLike } from '@/features/profiles/avatarForProfile'

/**
 * The active agent's identity, resolved once for the WHOLE chat surface — so the
 * header, the empty-state greeting, and the per-group assistant avatar all show
 * the SAME face + name (the identity wedge: chat stops being an anonymous text
 * stream). Reuses the governed `resolveAvatar` primitive; the face is NEVER the
 * sky-blue accent (see {@link '@/components/ui/avatar'}).
 */
export interface ChatAgentIdentity {
  /** The agent's raw profile name (`default` for the built-in agent). */
  name: string
  /** The display name — the user-chosen displayName, else the real profile name
   * (literally `default` for the built-in agent). Never a fabricated label. */
  friendlyName: string
  /** The resolved avatar id to render (explicit choice, else deterministic default). */
  avatarId: AvatarId
  /** Whether the agent has a real, non-default name (drives first-person copy). */
  isNamed: boolean
}

/** The display name for chat identity: the user-chosen displayName first, else the
 * agent's REAL profile name (literally `default` for the built-in agent) — never a
 * fabricated label. The name reads identically across every surface. */
function friendlyNameFor(profile: ProfileLike): string {
  const dn = profile.displayName?.trim()
  if (dn) return dn
  return profile.name.trim()
}

/**
 * Resolve a profile summary into the chat surface's identity, or `null` when no
 * profile is available yet (the roster is still loading) — in which case chat
 * degrades to its anonymous copy, never a flicker of the wrong name.
 * isNamed is true when the agent has a user-chosen display name OR is a non-default
 * named profile (drives first-person copy like "Hi, I'm Mercury").
 */
export function resolveChatAgent(
  profile: ProfileLike | null | undefined,
): ChatAgentIdentity | null {
  if (!profile) return null
  const trimmed = profile.name.trim()
  if (trimmed.length === 0) return null
  const hasDisplayName = Boolean(profile.displayName?.trim())
  const isNonDefaultProfile = !(profile.isDefault || profile.name === 'default')
  const isNamed = hasDisplayName || isNonDefaultProfile
  return {
    name: trimmed,
    friendlyName: friendlyNameFor(profile),
    avatarId: resolveAvatar(profile),
    isNamed,
  }
}

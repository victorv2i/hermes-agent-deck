import { BUILTIN_AVATAR_IDS, type AvatarId } from '@agent-deck/protocol'

/**
 * Deterministic agent-avatar resolution — so every agent has a face from minute
 * zero with NO write, and the SAME agent shows the SAME face on every surface
 * (chip, switcher, header, picker, ⌘K, Home hero).
 *
 * Identity color only — the avatar art is NEVER the sky-blue `--primary` action
 * accent (design spine).
 */

/** FNV-1a 32-bit — a stable, dependency-free string hash. Deterministic by
 * construction (no Date/Math.random), so a name always maps to the same face. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // imul keeps the multiply in 32-bit; >>> 0 forces unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** The shape every identity surface already has from a profile summary. */
export interface ProfileLike {
  name: string
  isDefault?: boolean
  /** The explicitly chosen built-in avatar id, or null/undefined when unset. */
  avatar?: AvatarId | null
  /** The user-chosen display name (e.g. "Mercury"), or null/undefined when not set. */
  displayName?: string | null
}

/**
 * The deterministic DEFAULT face for a profile that hasn't chosen one. The
 * built-in `default` profile is pinned to `v1` (the signature front portrait);
 * every other name hashes stably into the set, so distinct agents get distinct,
 * stable faces with zero writes.
 */
export function avatarForProfile(profile: Pick<ProfileLike, 'name' | 'isDefault'>): AvatarId {
  if (profile.isDefault || profile.name === 'default') return 'v1'
  const index = fnv1a32(profile.name) % BUILTIN_AVATAR_IDS.length
  // Non-null: index is always a valid position in the non-empty tuple.
  return BUILTIN_AVATAR_IDS[index]!
}

/**
 * The avatar id to actually render: the explicitly chosen one if present, else
 * the deterministic default. A null/undefined choice (unset, or a read that
 * fell back) resolves to the default, so the chrome is never face-less.
 */
export function resolveAvatar(profile: ProfileLike): AvatarId {
  return profile.avatar ?? avatarForProfile(profile)
}

/** The public path of a built-in avatar's served webp. */
export function avatarSrc(id: AvatarId): string {
  return `/avatars/${id}.webp`
}

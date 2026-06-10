/**
 * Feature-local types for the Profiles surface. These mirror the BFF response
 * from GET /api/agent-deck/profiles (apps/server/src/profiles). Kept local to
 * keep features decoupled — no shared protocol edits.
 */
import type { AvatarId } from '@agent-deck/protocol'

export interface ProfileSummary {
  name: string
  displayPath: string
  isDefault: boolean
  isActive: boolean
  model: string | null
  provider: string | null
  hasEnv: boolean
  skillCount: number
  gatewayRunning: boolean
  /**
   * The explicitly chosen built-in avatar id (`.agent-deck/identity.json`), or
   * null when unset — every identity surface resolves the rendered face via
   * `resolveAvatar(profile)`, so a null falls back to the deterministic default.
   */
  avatar: AvatarId | null
  /**
   * The user-chosen display name for this agent (e.g. "Mercury"), or null when
   * the user never set one. The UI prefers this over the profile id for display.
   */
  displayName: string | null
}

export interface ProfilesResponse {
  active: string
  profiles: ProfileSummary[]
}

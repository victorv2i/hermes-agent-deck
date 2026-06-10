import type { ProfileSummary } from '@/features/profiles/types'

/**
 * Honest "restart to apply" hint for the AgentChip: the `active_profile` file
 * names A, but a DIFFERENT profile reports a running gateway — so the named
 * active agent is not the one currently live. Stock hermes exposes no
 * running-profile signal, so this is the only honest derivation; it drives a
 * quiet MUTED marker, never a self-correcting claim. In its own module so the
 * chip file stays component-only (react-refresh).
 */
export function restartPending(profiles: ProfileSummary[], activeName: string): boolean {
  const active = profiles.find((p) => p.name === activeName)
  if (!active) return false
  // If the named-active agent itself reports a running gateway, it's live → no hint.
  if (active.gatewayRunning) return false
  // Otherwise, a hint only when SOME other profile is the one running.
  return profiles.some((p) => p.name !== activeName && p.gatewayRunning)
}

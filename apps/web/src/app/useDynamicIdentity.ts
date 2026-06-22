import { useEffect } from 'react'
import { useProfiles } from '@/features/profiles/useProfiles'
import { resolveAvatar, avatarSrc } from '@/features/profiles/avatarForProfile'
import type { ProfileSummary, ProfilesResponse } from '@/features/profiles/types'

/**
 * P8 — ambient identity. The document title + favicon follow the agent the
 * running gateway has ACTUALLY adopted, so a backgrounded tab honestly reads
 * "Mercury - Hermes Agentdeck" with Mercury's face. Crucially this is the RUNNING
 * agent, not merely the selected `active_profile`: writing `active_profile`
 * doesn't restart the gateway, so until a restart the live agent is still the
 * old one — and the tab must not lie about which agent is answering. We only
 * fall back to the selected `active` profile when nothing is running (so a
 * freshly-selected-but-not-yet-restarted agent still gets a sensible title
 * rather than the bare product mark). Pure resolvers (below) do the work; the
 * hook is a thin DOM effect mounted once in always-rendered chrome (the
 * AppShell), never in App.tsx — so there's exactly one writer of the title.
 *
 * Honest by construction: it reads the SAME `/profiles` roster every identity
 * surface reads (no new state, no Hermes route), and falls back to the stable
 * "Hermes Agentdeck" mark whenever there's no running/named agent (roster loading, or
 * the unnamed default).
 */

/** The suffix every titled tab carries, so the product is always legible. */
export const TITLE_SUFFIX = 'Hermes Agentdeck'

/** The stable, agent-agnostic favicon shipped in /public (the Hermes Agentdeck mark). */
export const DEFAULT_FAVICON = '/favicon-32.png'

/** The active profile in a roster, or null. The BFF marks exactly one `isActive`;
 * we also accept the top-level `active` name as a fallback match so a roster that
 * only set the name (not the flag) still resolves. */
export function activeProfile(data: ProfilesResponse | null | undefined): ProfileSummary | null {
  if (!data || !Array.isArray(data.profiles)) return null
  const flagged = data.profiles.find((p) => p.isActive)
  if (flagged) return flagged
  const named = data.profiles.find((p) => p.name === data.active)
  return named ?? null
}

/**
 * The agent that drives AMBIENT identity (title + favicon): the one the gateway
 * has actually adopted. Stock Hermes runs ONE gateway, so at most one profile
 * reports `gatewayRunning` — that's the live agent the tab should reflect. Only
 * when NOTHING is running do we fall back to the selected `active_profile`, so a
 * just-switched-but-not-yet-restarted agent still gets a title instead of the
 * bare product mark. This keeps the tab honest across the switch→restart gap:
 * the selected agent isn't claimed as live until the restart makes it so.
 */
export function ambientProfile(data: ProfilesResponse | null | undefined): ProfileSummary | null {
  if (!data || !Array.isArray(data.profiles)) return null
  const running = data.profiles.find((p) => p.gatewayRunning)
  if (running) return running
  return activeProfile(data)
}

/** The document title for an active profile. A user-chosen display name wins;
 * a non-default profile id is next; the unnamed default (or no agent) yields the
 * bare product name — we never title a tab "your agent" or "default". */
export function titleForActive(profile: ProfileSummary | null): string {
  if (!profile) return TITLE_SUFFIX
  const display = profile.displayName?.trim()
  if (display) return `${display} - ${TITLE_SUFFIX}`
  if (profile.isDefault || profile.name === 'default') return TITLE_SUFFIX
  const name = profile.name.trim()
  if (name.length === 0) return TITLE_SUFFIX
  return `${name} - ${TITLE_SUFFIX}`
}

/** The favicon href for an active profile: the agent's resolved avatar webp, or
 * the stable Hermes Agentdeck mark when there's no active agent yet. The avatar is the
 * agent's real face (identity, never the accent) — an honest, tasteful tab mark. */
export function faviconForActive(profile: ProfileSummary | null): string {
  if (!profile) return DEFAULT_FAVICON
  return avatarSrc(resolveAvatar(profile))
}

/** Find (or lazily create) the single rel="icon" link we manage. We keep the
 * type as image/webp for an avatar mark and image/png for the default. */
function ensureIconLink(doc: Document): HTMLLinkElement {
  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  return link
}

/**
 * Drive `document.title` and the favicon from the active agent. Mount ONCE in the
 * AppShell. Re-runs only when the resolved title/href actually change (the
 * roster is memoized by TanStack Query), so a re-render doesn't thrash the DOM.
 */
export function useDynamicIdentity(): void {
  const { data } = useProfiles()
  // Ambient identity follows the RUNNING agent (the one the gateway adopted),
  // falling back to the selected active profile only when none is running — so
  // the tab never claims a just-selected-but-not-restarted agent is live.
  const profile = ambientProfile(data)
  const title = titleForActive(profile)
  const favicon = faviconForActive(profile)

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = title
  }, [title])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const link = ensureIconLink(document)
    // Only write when the href actually differs, so we don't force the browser to
    // re-fetch the same icon on every roster refresh.
    if (link.getAttribute('href') === favicon) return
    const isWebp = favicon.endsWith('.webp')
    link.type = isWebp ? 'image/webp' : 'image/png'
    // The static default ships as a fixed 32x32; an avatar mark is variable, so
    // drop the stale `sizes` hint when swapping to one (and restore it otherwise).
    if (isWebp) link.removeAttribute('sizes')
    else link.setAttribute('sizes', '32x32')
    link.setAttribute('href', favicon)
  }, [favicon])
}

/**
 * The agent-hub tab ids — the single source of truth shared by
 * {@link AgentMemoryTabs} and the `?tab=` URL it reads/writes. Kept in a plain
 * (non-component) module so the tabs component stays components-only
 * (react-refresh) and the resolver is unit-testable without the surface.
 *
 * Mirrors `connectionsTabs.ts`: the active tab is driven by `?tab=` so a refresh
 * (or a shared/deep link) lands back on the same tab instead of resetting to Soul.
 */
import type { ProfileFileKind } from '@/features/memory/api'

/**
 * Valid `?tab=` ids, in display order. The three editable files, then the
 * memory-provider controls, then the folded-in Skills browser.
 */
export const HUB_TAB_IDS = ['soul', 'memory', 'user', 'provider', 'skills'] as const

export type HubTabId = (typeof HUB_TAB_IDS)[number]

/** The three ids that name an editable file (vs. the provider/skills panels). */
export type HubFileTabId = ProfileFileKind

/** The default tab when `?tab=` is absent or unrecognised — Soul, the agent's character. */
export const DEFAULT_HUB_TAB: HubTabId = HUB_TAB_IDS[0]

/** Whether a (possibly missing/garbage) raw `?tab=` value names a real hub tab. */
export function isHubTab(raw: string | null): raw is HubTabId {
  return raw !== null && (HUB_TAB_IDS as readonly string[]).includes(raw)
}

/** Resolve a raw `?tab=` value to a real hub tab id (defaulting when invalid). */
export function resolveHubTab(raw: string | null): HubTabId {
  return isHubTab(raw) ? raw : DEFAULT_HUB_TAB
}

/** Whether a hub tab id names an editable file (Soul/Memory/User) vs. a panel. */
export function isFileTab(tab: HubTabId): tab is HubFileTabId {
  return tab === 'soul' || tab === 'memory' || tab === 'user'
}

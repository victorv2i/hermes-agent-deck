/**
 * The Connections tab ids — the single source of truth shared by the
 * {@link ConnectionsRoute} shell, the `/voice` · `/messaging` · `/mcp` →
 * `/connections?tab=…` redirects (router.tsx), and Settings' deep-links. Kept in
 * a plain (non-component) module so the route file can stay components-only
 * (react-refresh) and so the redirects/tests import the ids without pulling in
 * the lazy surface chunks.
 */

/**
 * Valid `?tab=` ids, in display order.
 * Voice · Messaging · MCP · Pairing · Webhooks · Credentials
 */
export const CONNECTIONS_TAB_IDS = [
  'voice',
  'messaging',
  'mcp',
  'pairing',
  'webhooks',
  'credentials',
] as const

export type ConnectionsTabId = (typeof CONNECTIONS_TAB_IDS)[number]

/** The default tab when `?tab=` is absent or unrecognised — the first one. */
export const DEFAULT_CONNECTIONS_TAB: ConnectionsTabId = CONNECTIONS_TAB_IDS[0]

/** Whether a (possibly missing/garbage) raw `?tab=` value names a real tab. */
export function isConnectionsTab(raw: string | null): raw is ConnectionsTabId {
  return raw !== null && (CONNECTIONS_TAB_IDS as readonly string[]).includes(raw)
}

/** Resolve a raw `?tab=` value to a real tab id (defaulting when invalid). */
export function resolveConnectionsTab(raw: string | null): ConnectionsTabId {
  return isConnectionsTab(raw) ? raw : DEFAULT_CONNECTIONS_TAB
}

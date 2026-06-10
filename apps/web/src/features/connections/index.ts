/**
 * Connections feature barrel — Voice · Messaging · MCP · Pairing · Webhooks ·
 * Credentials (`/connections`). The integrator lazy-mounts
 * {@link ConnectionsRoute} from the NAV registry; each tab mounts its surface.
 */
export { ConnectionsRoute } from './ConnectionsRoute'
export {
  CONNECTIONS_TAB_IDS,
  DEFAULT_CONNECTIONS_TAB,
  resolveConnectionsTab,
  isConnectionsTab,
  type ConnectionsTabId,
} from './connectionsTabs'

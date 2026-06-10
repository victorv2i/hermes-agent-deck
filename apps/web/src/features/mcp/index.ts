/**
 * MCP feature barrel — the MCP Server Manager surface (`/mcp`). The integrator
 * lazy-mounts {@link McpRoute} from the NAV registry; the presentational
 * {@link McpPage} is exported for tests/screenshots.
 */
export { McpRoute } from './McpRoute'
export { McpPage, type McpPageProps } from './McpPage'

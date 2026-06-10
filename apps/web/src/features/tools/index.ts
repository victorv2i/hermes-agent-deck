/**
 * Tools feature barrel — the READ-ONLY toolsets inventory surface (`/tools`). The
 * integrator lazy-mounts {@link ToolsetsRoute} from the NAV registry; the
 * presentational {@link ToolsetsPage} is exported for tests/screenshots.
 */
export { ToolsetsRoute } from './ToolsetsRoute'
export { ToolsetsPage, type ToolsetsPageProps } from './ToolsetsPage'

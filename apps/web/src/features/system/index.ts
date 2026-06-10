/**
 * System feature barrel — the Maintenance dock (`/system`). The integrator
 * lazy-mounts {@link SystemRoute} from the NAV registry; the presentational
 * {@link SystemPage} is exported for tests/screenshots.
 */
export { SystemRoute } from './SystemRoute'
export { SystemPage, type SystemPageProps } from './SystemPage'

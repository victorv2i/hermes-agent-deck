/**
 * Home feature barrel — the integrator lazy-mounts {@link HomeRoute} at `/home`
 * and reads the first-run landing flag via `@/lib/useOnboarded`. The
 * presentational {@link HomePage} is exported for screenshots/tests.
 */
export { HomeRoute } from './HomeRoute'
export { HomePage, type HomePageProps } from './HomePage'
export { CHANGELOG, RECENT_CHANGELOG } from './changelog'

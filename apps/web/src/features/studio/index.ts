/**
 * Agent Studio feature barrel. Re-exports the profile-scoped BFF client, its
 * TanStack hooks, and the pure selection-state helpers (the data layer), plus
 * the connected Studio surface ({@link StudioRoute}) the integrator lazy-mounts
 * at Home (`/`) and the presentational {@link StudioPage} for tests/screenshots.
 */
export * from './data/profileScope'
export * from './data/api'
export * from './hooks'
export * from './state/selection'
export { StudioRoute } from './StudioRoute'
export { StudioPage, type StudioPageProps } from './StudioPage'
export { StudioHero } from './StudioHero'

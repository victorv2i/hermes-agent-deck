/**
 * Messaging feature barrel — the "your agent lives where you do" surface
 * (`/messaging`). The integrator lazy-mounts {@link MessagingRoute} from the NAV
 * registry; the presentational {@link MessagingPage} is exported for
 * tests/screenshots.
 */
export { MessagingRoute } from './MessagingRoute'
export { MessagingPage, type MessagingPageProps } from './MessagingPage'

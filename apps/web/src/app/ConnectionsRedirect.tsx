import { Navigate, useSearchParams } from 'react-router-dom'

/**
 * Redirect the retired `/connections` rail path into the Agent Studio's embedded
 * Connections view (`/?view=connections`), PRESERVING a `?tab=<id>` deep link so a
 * bookmarked or shared link to a specific sub-tab (voice / messaging / mcp /
 * pairing / webhooks / credentials) still lands there instead of silently falling
 * back to the default (Voice). The sibling `/voice` `/messaging` `/mcp` redirects
 * hardcode their tab; this one forwards whatever `tab` the caller supplied. The
 * Advanced sub-tabs (pairing / webhooks / credentials) have no path alias of their
 * own, so this redirect is their ONLY deep-link entry.
 *
 * Lives in its own file so `router.tsx` stays component-free (fast-refresh).
 */
export function ConnectionsRedirect() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const to = tab
    ? `/?view=connections&tab=${encodeURIComponent(tab)}`
    : '/?view=connections'
  return <Navigate to={to} replace />
}

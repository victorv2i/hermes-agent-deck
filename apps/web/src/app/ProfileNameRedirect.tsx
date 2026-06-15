import { Navigate, useParams } from 'react-router-dom'

/**
 * Redirect a per-agent deep link `/profiles/:name` to the Agent Studio with that
 * agent OPEN (`/?agent=<name>`). The Studio (Home) is the single canonical place
 * an agent is authored, so the old per-agent hub URL forwards there with the
 * selection preserved (a cross-device deep link). An empty/missing name falls
 * back to the Studio's default selection.
 *
 * Lives in its own file so `router.tsx` stays component-free (it exports only the
 * `routes` config + the `router`), keeping fast-refresh happy.
 */
export function ProfileNameRedirect() {
  const { name } = useParams<{ name: string }>()
  const to = name ? `/?agent=${encodeURIComponent(name)}` : '/'
  return <Navigate to={to} replace />
}

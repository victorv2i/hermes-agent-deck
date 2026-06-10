import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import App from '@/App'
import { NotFound } from '@/components/system/NotFound'
import { CHAT_PATH, NAV } from './navigation'

/**
 * The app router. The {@link App} layout owns the chrome (rail · header) and
 * renders the active surface in its content Outlet. Surfaces are
 * derived 1:1 from the {@link NAV} registry — appending a NavItem there is the
 * only edit needed to add a route.
 *
 * The `/history` surface is still routed (its `chats` NAV entry is `hidden` — it
 * folded into Chat in the rail, but the route survives for deep-links, ⌘K, and
 * the mobile "Past chats" button in the chat header).
 *
 * Beyond the registry there are a few hand-authored, non-NAV children:
 *  - `/memory` → `/profiles` REDIRECT: the standalone Memory/Soul surface was
 *    folded into each agent's hub, but deep links must survive.
 *  - `/skills` → `/profiles` REDIRECT: the standalone Skills browser was folded
 *    into each agent's hub (the Skills tab), same as Memory — deep links survive.
 *  - `/voice` · `/messaging` · `/mcp` → `/connections?tab=…` REDIRECTS: those three
 *    surfaces folded into the ONE tabbed Connections surface, so the old paths
 *    redirect to the matching tab — deep-links + Settings' "Configured on the X
 *    page →" links still land on the right place.
 *  - `/models` → `/settings` REDIRECT: the standalone Models page was demoted to a
 *    Settings section (model picker lives there now), so old links still land.
 *  - the catch-all `*` renders {@link NotFound} inside the shell, so an unknown
 *    URL shows a calm "not found" (with a link home) rather than a blank page.
 */
const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      ...NAV.map((item) => ({
        // The Home surface owns '/', so it's the index route; other surfaces map
        // their path (stripped of the leading slash) to a child route. Chat takes
        // an OPTIONAL `:id?` so `/chat` and `/chat/:id` share ONE route (and one
        // mounted surface — no remount flash) while making each conversation
        // URL-addressable: the id is the refresh-safe restore key.
        ...(item.path === '/'
          ? { index: true }
          : { path: item.path === CHAT_PATH ? 'chat/:id?' : item.path.replace(/^\//, '') }),
        element: item.element,
      })),
      // Retired surfaces — keep the routes as redirects so old links survive.
      { path: 'memory', element: <Navigate to="/profiles" replace /> },
      { path: 'skills', element: <Navigate to="/profiles" replace /> },
      // Folded into the tabbed Connections surface — redirect to the right tab.
      { path: 'voice', element: <Navigate to="/connections?tab=voice" replace /> },
      { path: 'messaging', element: <Navigate to="/connections?tab=messaging" replace /> },
      { path: 'mcp', element: <Navigate to="/connections?tab=mcp" replace /> },
      // Demoted from a rail surface to a Settings section — keep the deep-link alive.
      { path: 'models', element: <Navigate to="/settings" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)

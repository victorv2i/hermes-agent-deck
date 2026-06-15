import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import App from '@/App'
import { NotFound } from '@/components/system/NotFound'
import { CHAT_PATH, NAV } from './navigation'
import { ProfileNameRedirect } from './ProfileNameRedirect'

// The unified Terminal surface element (from its NAV entry), reused for the
// `/workspaces` + `/workspaces/:id` aliases below so all three paths render ONE
// surface without a second lazy import.
const terminalElement = NAV.find((item) => item.key === 'terminal')?.element

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
 *  - `/profiles` → `/` + `/profiles/:name` → `/?agent=<name>` REDIRECTS: the
 *    Agents roster + the per-agent hub folded into the Agent Studio (Home); the
 *    old paths forward there (the `:name` deep link opens that agent).
 *  - `/tools` → `/` REDIRECT: the Tools surface became a Studio section.
 *  - `/memory` → `/` + `/skills` → `/` REDIRECTS: the standalone Memory/Soul +
 *    Skills surfaces folded into the agent's authoring surface (now the Studio).
 *  - `/voice` · `/messaging` · `/mcp` → `/connections?tab=…` REDIRECTS: those three
 *    surfaces folded into the ONE tabbed Connections surface, so the old paths
 *    redirect to the matching tab — deep-links + Settings' "Configured on the X
 *    page →" links still land on the right place.
 *  - `/models` → `/settings` REDIRECT: the standalone Models page was demoted to a
 *    Settings section (model picker lives there now), so old links still land.
 *  - the catch-all `*` renders {@link NotFound} inside the shell, so an unknown
 *    URL shows a calm "not found" (with a link home) rather than a blank page.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      ...NAV.map((item) => ({
        // The Agent Studio (Home) owns '/', so it's the index route; other
        // surfaces map their path (stripped of the leading slash) to a child
        // route. Chat takes an OPTIONAL `:id?` so `/chat` and `/chat/:id` share
        // ONE route (and one mounted surface — no remount flash) while making each
        // conversation URL-addressable: the id is the refresh-safe restore key.
        ...(item.path === '/'
          ? { index: true }
          : { path: item.path === CHAT_PATH ? 'chat/:id?' : item.path.replace(/^\//, '') }),
        element: item.element,
      })),
      // Terminal + Workspaces UNIFIED into one surface: the `terminal` NAV entry
      // owns `/terminal`, and these two aliases resolve `/workspaces` (Scratch
      // active) and `/workspaces/:id` (that workspace active, a cross-device deep
      // link) to the SAME surface element, so existing links and muscle memory do
      // not break after collapsing the two pages into one.
      { path: 'workspaces', element: terminalElement },
      { path: 'workspaces/:id', element: terminalElement },
      // Agents + Tools FOLDED into the Agent Studio (Home): keep the old paths as
      // redirects so existing links + the command palette still land. The roster
      // (`/profiles`) → Studio; a per-agent deep link (`/profiles/:name`) → Studio
      // with that agent OPEN (`/?agent=<name>`); Tools (`/tools`) → Studio (its
      // Tools section).
      { path: 'profiles', element: <Navigate to="/" replace /> },
      { path: 'profiles/:name', element: <ProfileNameRedirect /> },
      { path: 'tools', element: <Navigate to="/" replace /> },
      // Retired surfaces — keep the routes as redirects so old links survive. They
      // folded into the agent's authoring surface, which is now the Studio (Home).
      { path: 'memory', element: <Navigate to="/" replace /> },
      { path: 'skills', element: <Navigate to="/" replace /> },
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

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom'
import { routes } from './router'

/**
 * Router redirect contract for the Agent Studio fold: the Agents roster
 * (`/profiles`), the per-agent hub (`/profiles/:name`), and Tools (`/tools`) all
 * folded INTO the Studio (Home), so the old paths must still resolve as redirects
 * (deep links + the command palette keep working). The standalone Memory + Skills
 * surfaces folded in earlier, now redirecting to the Studio too.
 *
 * These extract the REAL redirect route objects from the exported `routes` config
 * (NOT a stub) and mount them under a plain Outlet — so the actual `<Navigate>` /
 * `<ProfileNameRedirect>` elements are exercised, while the heavy `App` shell that
 * owns '/' (and needs the full provider stack) is swapped for a marker. A
 * regression in the real redirect lines is therefore still caught.
 */
const realChildren = routes[0]!.children!
const realChild = (path: string) => realChildren.find((r) => r.path === path)

/** The real redirect children, re-homed under a bare Outlet (App swapped out). */
function redirectRoutes(): RouteObject[] {
  const paths = ['profiles', 'profiles/:name', 'tools', 'memory', 'skills']
  return [
    {
      path: '/',
      element: <Outlet />,
      children: [
        { index: true, element: <div data-testid="studio-home">studio</div> },
        ...paths.map((p) => {
          const real = realChild(p)
          if (!real) throw new Error(`router.tsx is missing the '${p}' redirect route`)
          return { path: p, element: real.element }
        }),
      ],
    },
  ]
}

describe('router · Studio fold redirects', () => {
  const redirectsToHome = ['/profiles', '/tools', '/memory', '/skills']
  for (const from of redirectsToHome) {
    it(`redirects ${from} → / (folded into the Agent Studio)`, () => {
      const router = createMemoryRouter(redirectRoutes(), { initialEntries: [from] })
      render(<RouterProvider router={router} />)
      expect(router.state.location.pathname).toBe('/')
    })
  }

  it('redirects /profiles/:name → /?agent=<name> (the per-agent deep link opens that agent)', () => {
    const router = createMemoryRouter(redirectRoutes(), { initialEntries: ['/profiles/scout'] })
    render(<RouterProvider router={router} />)
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('?agent=scout')
  })

  it('preserves the per-agent deep link through URL-encoding of the name', () => {
    const router = createMemoryRouter(redirectRoutes(), { initialEntries: ['/profiles/my-agent'] })
    render(<RouterProvider router={router} />)
    expect(router.state.location.search).toBe('?agent=my-agent')
  })
})

/**
 * Connections fold redirects: Connections folded INTO the Agent Studio (Home) as
 * a GLOBAL view, so `/connections` → `/?view=connections`, and the older
 * `/voice` · `/messaging` · `/mcp` paths → `/?view=connections&tab=…` (the
 * Studio's Connections view on the matching sub-tab). These exercise the REAL
 * `<Navigate>` redirect elements from the exported `routes` config.
 */
describe('router · Connections fold redirects', () => {
  function connectionsRedirectRoutes(): RouteObject[] {
    const paths = ['connections', 'voice', 'messaging', 'mcp']
    return [
      {
        path: '/',
        element: <Outlet />,
        children: [
          { index: true, element: <div data-testid="studio-home">studio</div> },
          ...paths.map((p) => {
            const real = realChild(p)
            if (!real) throw new Error(`router.tsx is missing the '${p}' redirect route`)
            return { path: p, element: real.element }
          }),
        ],
      },
    ]
  }

  it('redirects /connections → /?view=connections (the Studio Connections view)', () => {
    const router = createMemoryRouter(connectionsRedirectRoutes(), {
      initialEntries: ['/connections'],
    })
    render(<RouterProvider router={router} />)
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('?view=connections')
  })

  // The Advanced sub-tabs (pairing/webhooks/credentials) have NO path alias of
  // their own, so `/connections?tab=<id>` is their only deep-link entry. The
  // redirect must FORWARD that tab rather than dropping it (which silently landed
  // every such link on the default Voice tab).
  for (const tab of ['pairing', 'webhooks', 'credentials']) {
    it(`forwards /connections?tab=${tab} → /?view=connections&tab=${tab}`, () => {
      const router = createMemoryRouter(connectionsRedirectRoutes(), {
        initialEntries: [`/connections?tab=${tab}`],
      })
      render(<RouterProvider router={router} />)
      expect(router.state.location.pathname).toBe('/')
      expect(router.state.location.search).toBe(`?view=connections&tab=${tab}`)
    })
  }

  for (const tab of ['voice', 'messaging', 'mcp']) {
    it(`redirects /${tab} → /?view=connections&tab=${tab} (the matching sub-tab)`, () => {
      const router = createMemoryRouter(connectionsRedirectRoutes(), {
        initialEntries: [`/${tab}`],
      })
      render(<RouterProvider router={router} />)
      expect(router.state.location.pathname).toBe('/')
      // URLSearchParams ordering is stable: view first, then tab.
      expect(router.state.location.search).toBe(`?view=connections&tab=${tab}`)
    })
  }
})

/**
 * Terminal + Workspaces UNIFIED: `/terminal`, `/workspaces`, and `/workspaces/:id`
 * all resolve to the SAME surface element (an ALIAS, not a redirect - the URL is
 * the source of truth for which workspace is active, so the :id deep link keeps
 * working cross-device). These assert against the REAL `routes` config exported
 * from router.tsx (NOT a stub), so a regression in the actual alias lines (the
 * `terminal` NAV entry + the two hand-authored aliases) is caught: all three must
 * point at one and the same surface element, and the :id path must exist.
 */
describe('router · unified Terminal aliases', () => {
  /** The child routes under the App layout ('/'), where the surfaces live. */
  const children = routes[0]!.children!
  const routeFor = (path: string) => children.find((r) => r.path === path)

  it('routes /terminal, /workspaces, and /workspaces/:id to the SAME element', () => {
    const terminal = routeFor('terminal')
    const workspaces = routeFor('workspaces')
    const workspaceById = routeFor('workspaces/:id')

    // All three aliases exist in the real config.
    expect(terminal).toBeDefined()
    expect(workspaces).toBeDefined()
    expect(workspaceById).toBeDefined()

    // ...and resolve to the very same surface element (one mounted surface; the
    // aliases are NOT redirects). Reference equality proves they share the element.
    expect(terminal!.element).toBeTruthy()
    expect(workspaces!.element).toBe(terminal!.element)
    expect(workspaceById!.element).toBe(terminal!.element)
  })

  it('exposes the workspace id as a route param on the deep-link alias', () => {
    // The `:id` segment is what makes the saved-workspace deep link addressable.
    expect(routeFor('workspaces/:id')).toBeDefined()
    const router = createMemoryRouter(routes, { initialEntries: ['/workspaces/ws-42'] })
    const match = router.state.matches.at(-1)
    expect(match?.params.id).toBe('ws-42')
    expect(router.state.location.pathname).toBe('/workspaces/ws-42')
  })
})

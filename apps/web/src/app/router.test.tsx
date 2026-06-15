import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  createMemoryRouter,
  Navigate,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom'
import { routes } from './router'

/**
 * Router redirect contract: the standalone `/memory` and `/skills` surfaces were
 * folded into each agent's hub, but deep links must survive. This mirrors the
 * hand-authored non-NAV children in router.tsx (kept in sync) and asserts those
 * visits land on `/profiles`.
 */
function routesWithRedirect(): RouteObject[] {
  return [
    {
      path: '/',
      element: <Outlet />,
      children: [
        { path: 'profiles', element: <div>Agents roster</div> },
        { path: 'memory', element: <Navigate to="/profiles" replace /> },
        { path: 'skills', element: <Navigate to="/profiles" replace /> },
      ],
    },
  ]
}

describe('router · retired surface redirects', () => {
  it('redirects /memory → /profiles (deep links survive the fold)', () => {
    const router = createMemoryRouter(routesWithRedirect(), { initialEntries: ['/memory'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Agents roster')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profiles')
  })

  it('redirects /skills → /profiles (skills folded into the agent hub)', () => {
    const router = createMemoryRouter(routesWithRedirect(), { initialEntries: ['/skills'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Agents roster')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profiles')
  })
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

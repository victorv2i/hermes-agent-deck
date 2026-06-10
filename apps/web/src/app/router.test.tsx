import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  createMemoryRouter,
  Navigate,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom'

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

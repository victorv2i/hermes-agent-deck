import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom'
import { AgentDetailPage } from './AgentDetailPage'
import type { ProfilesResponse } from './types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Replace the heavy Soul/Memory tabs with a tiny stand-in that lets us toggle the
// unsaved-Soul ("dirty") signal on demand — the route-guard is the unit under test,
// not the editor internals.
vi.mock('./AgentMemoryTabs', () => ({
  AgentMemoryTabs: ({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) => (
    <button type="button" onClick={() => onDirtyChange?.(true)}>
      make soul dirty
    </button>
  ),
}))

const profiles: ProfilesResponse = {
  active: 'default',
  profiles: [
    {
      name: 'atlas',
      displayPath: 'profiles/atlas',
      isDefault: false,
      isActive: false,
      model: 'sonnet',
      provider: 'anthropic',
      hasEnv: true,
      skillCount: 3,
      gatewayRunning: false,
      avatar: 'v2',
      displayName: null,
    },
  ],
}

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/profiles'))
        return { ok: true, status: 200, json: async () => profiles } as Response
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: '', exists: false }),
      } as Response
    }),
  )
}

/** A data router (useBlocker needs one) with a sibling route to navigate to. */
function renderRouter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/profiles/:name',
        element: (
          <>
            <Link to="/profiles">leave</Link>
            {/* A same-pathname search-only nav (mirrors the hub's own ?tab= write). */}
            <Link to="/profiles/atlas?tab=memory">change tab</Link>
            <AgentDetailPage />
          </>
        ),
      },
      { path: '/profiles', element: <div>roster</div> },
    ],
    { initialEntries: ['/profiles/atlas'] },
  )
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockApi())
afterEach(() => vi.restoreAllMocks())

describe('AgentDetailPage — unsaved-Soul route guard (useBlocker)', () => {
  it('opens the THEMED dialog (not window.confirm) before leaving with unsaved edits; staying on Stay', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    renderRouter()
    await screen.findByRole('heading', { name: 'atlas' })

    await user.click(screen.getByRole('button', { name: /make soul dirty/i }))
    await user.click(screen.getByRole('link', { name: /leave/i }))

    // The app's themed ConfirmDialog appears, with the unsaved-Soul wording — never
    // a raw browser window.confirm.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/unsaved soul/i)
    expect(confirmSpy).not.toHaveBeenCalled()

    // Choosing "Stay" cancels the navigation (still on the agent).
    await user.click(screen.getByRole('button', { name: /^stay$/i }))
    expect(screen.queryByText('roster')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'atlas' })).toBeInTheDocument()
  })

  it('proceeds with the navigation when the user confirms "Leave without saving"', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    renderRouter()
    await screen.findByRole('heading', { name: 'atlas' })

    await user.click(screen.getByRole('button', { name: /make soul dirty/i }))
    await user.click(screen.getByRole('link', { name: /leave/i }))

    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /leave without saving/i }))

    await waitFor(() => expect(screen.getByText('roster')).toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('does NOT fire the route-leave guard on a same-pathname ?tab= change (the hub guards its own tabs)', async () => {
    const user = userEvent.setup()
    renderRouter()
    await screen.findByRole('heading', { name: 'atlas' })

    // Dirty the Soul, then change only the search (?tab=) — same pathname. The
    // parent route guard must stay silent; tab switches are guarded in-tabs.
    await user.click(screen.getByRole('button', { name: /make soul dirty/i }))
    await user.click(screen.getByRole('link', { name: /change tab/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'atlas' })).toBeInTheDocument()
  })

  it('does not prompt when there are no unsaved Soul edits', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    renderRouter()
    await screen.findByRole('heading', { name: 'atlas' })

    await user.click(screen.getByRole('link', { name: /leave/i }))

    await waitFor(() => expect(screen.getByText('roster')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { DeleteAgentDialog } from './DeleteAgentDialog'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/** Surfaces the current path + query so we can assert the post-delete nav Home. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function mockApi(deleteOk = true) {
  const calls: Array<{ url: string; method: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/agent-deck/profiles/') && init?.method === 'DELETE') {
        calls.push({ url, method: 'DELETE' })
        if (!deleteOk)
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'conflict',
              message: 'Switch to another agent before deleting this one.',
            }),
          } as Response
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ active: 'default', profiles: [] }),
      } as Response
    }),
  )
  return { calls }
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?agent=atlas']}>
        <LocationProbe />
        <Routes>
          <Route
            path="/"
            element={
              <DeleteAgentDialog open name="atlas" displayName="Atlas" onOpenChange={() => {}} />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('DeleteAgentDialog', () => {
  it('names the agent and warns the delete is permanent', () => {
    mockApi()
    renderDialog()
    expect(screen.getByRole('heading', { name: /delete atlas\?/i })).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })

  it('sends DELETE for the agent and navigates Home on success', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: /delete agent/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.url).toBe('/api/agent-deck/profiles/atlas')
    // Lands Home with the stale ?agent= dropped, so the gone agent's workbench
    // is replaced by the active agent.
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(toast.success).toHaveBeenCalled()
  })

  it('does NOT navigate and surfaces an error toast when the delete fails', async () => {
    mockApi(false)
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: /delete agent/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByTestId('location').textContent).toBe('/?agent=atlas')
  })
})

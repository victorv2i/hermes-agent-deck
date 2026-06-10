import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GatewayRestartCard } from './GatewayRestartCard'
import { profileKeys } from './useProfiles'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function renderCard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <GatewayRestartCard message="Restart to apply." />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('GatewayRestartCard', () => {
  it('invalidates the profiles roster after a successful restart (clears the stale "restart to apply" marker)', async () => {
    // The restart route returns the re-probed run-state.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'running' }),
      } as Response),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = userEvent.setup()
    renderCard(client)

    await user.click(screen.getByRole('button', { name: /restart your agent/i }))

    await waitFor(() => expect(screen.getByText(/reports/i)).toBeInTheDocument())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.all })
  })

  it('does NOT invalidate the roster when the restart fails (no false "applied")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'boom' }),
      } as Response),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = userEvent.setup()
    renderCard(client)

    await user.click(screen.getByRole('button', { name: /restart your agent/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(invalidate).not.toHaveBeenCalled()
  })
})

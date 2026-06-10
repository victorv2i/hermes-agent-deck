import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { SwitchAgentButton } from './SwitchAgentButton'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderIt(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => vi.restoreAllMocks())

describe('SwitchAgentButton (honest switch)', () => {
  it('switches, then offers a real browser restart and shows the re-probed state', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/agent-deck/system/gateway/restart') {
        return { ok: true, status: 200, json: async () => ({ status: 'running' }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ active: 'atlas' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    renderIt(<SwitchAgentButton name="atlas" />)
    await user.click(screen.getByRole('button', { name: /switch to this agent/i }))

    await waitFor(() =>
      expect(
        screen.getByText(
          'Switched to atlas. Hermes runs one agent at a time, so restart to make atlas the active agent.',
        ),
      ).toBeInTheDocument(),
    )
    // The switch route was hit with the target name.
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles/switch')!
    const init = call[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ name: 'atlas' })
    // Honest, not a fake "all done": the copy explains the one-agent-at-a-time
    // constraint and that a restart is still required to make the switch live.
    expect(screen.getByText(/one agent at a time/i)).toBeInTheDocument()
    expect(screen.getByText(/restart to make atlas the active agent/i)).toBeInTheDocument()
    expect(screen.queryByText('hermes gateway restart')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /restart your agent/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agent-deck/system/gateway/restart',
        expect.any(Object),
      ),
    )
    expect(screen.getByText(/your agent reports/i)).toHaveTextContent(/running/i)
  })

  it('offers the restart command only as a fallback when browser restart fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/agent-deck/system/gateway/restart') {
          return {
            ok: false,
            status: 502,
            json: async () => ({ error: 'restart_failed', message: 'Hermes did not respond.' }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({ active: 'atlas' }) } as Response
      }),
    )

    renderIt(<SwitchAgentButton name="atlas" />)
    await user.click(screen.getByRole('button', { name: /switch to this agent/i }))
    await user.click(await screen.findByRole('button', { name: /restart your agent/i }))
    const copyBtn = await screen.findByRole('button', { name: /copy fallback restart command/i })
    await user.click(copyBtn)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]![0]).toMatch(/restart/)
  })
})

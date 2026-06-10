import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { RenameAgentDialog } from './RenameAgentDialog'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/** Surfaces the current path so we can assert the post-rename navigation. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

function mockApi(renameOk = true, restartOk = true) {
  const calls: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/agent-deck/system/gateway/restart') {
        if (!restartOk) {
          return {
            ok: false,
            status: 502,
            json: async () => ({ error: 'restart_failed', message: 'Hermes did not respond.' }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({ status: 'running' }) } as Response
      }
      if (url.includes('/rename')) {
        const body = JSON.parse(String(init!.body))
        calls.push({ url, body })
        if (!renameOk)
          return {
            ok: false,
            status: 502,
            json: async () => ({ error: 'rename_failed', message: 'Hermes could not rename.' }),
          } as Response
        return { ok: true, status: 200, json: async () => ({ name: body.newName }) } as Response
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
      <MemoryRouter initialEntries={['/profiles/atlas']}>
        <LocationProbe />
        <Routes>
          <Route
            path="/profiles/:name"
            element={<RenameAgentDialog open currentName="atlas" onOpenChange={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('RenameAgentDialog', () => {
  it('disables Rename until the new name is valid and differs from the current', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    const submit = screen.getByRole('button', { name: /^rename$/i })
    // Pre-filled with the current name → no change → disabled.
    expect(submit).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Bad Name')
    expect(submit).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Mercury')
    expect(submit).toBeEnabled()
  })

  it('blocks the reserved built-in default name before submit', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'Default')
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/built-in agent/i)
    expect(calls).toHaveLength(0)
  })

  it('posts the Hermes-canonical lowercase target for mixed-case input', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'Mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await waitFor(() =>
      expect(calls[0]).toMatchObject({
        url: '/api/agent-deck/profiles/atlas/rename',
        body: { newName: 'mercury' },
      }),
    )
  })

  it('renames, then shows the loud applied card with a browser restart before navigation', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await waitFor(() =>
      expect(calls[0]).toMatchObject({
        url: '/api/agent-deck/profiles/atlas/rename',
        body: { newName: 'mercury' },
      }),
    )
    // The loud applied card names the new name and offers a browser restart,
    // not a quiet toast-and-dismiss or terminal-first command.
    const applied = await screen.findByRole('status')
    expect(applied).toHaveTextContent(
      'Agent renamed to mercury. This takes effect when your agent restarts.',
    )
    expect(within(applied).getByRole('button', { name: /restart your agent/i })).toBeInTheDocument()
    expect(within(applied).queryByText('hermes gateway restart')).not.toBeInTheDocument()
    // No premature navigation: the user stays on the card until they're done.
    expect(screen.getByTestId('location')).toHaveTextContent('/profiles/atlas')
  })

  it('navigates to the renamed /profiles/:name when the applied card is dismissed', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /^done$/i }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/profiles/mercury'),
    )
  })

  it('restarts the gateway from the applied card and shows the re-probed state', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await waitFor(() => expect(calls[0]).toMatchObject({ body: { newName: 'mercury' } }))
    await user.click(screen.getByRole('button', { name: /restart your agent/i }))
    expect(await screen.findByText(/your agent reports/i)).toHaveTextContent(/running/i)
  })

  it('offers the restart command only as a fallback when browser restart fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mockApi(true, false)
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /restart your agent/i }))
    await user.click(await screen.findByRole('button', { name: /copy fallback restart command/i }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]![0]).toMatch(/restart/)
  })

  it('on a rename failure stays put (no navigation) and surfaces the error', async () => {
    const { toast } = await import('@/lib/toast')
    mockApi(false)
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'mercury')
    await user.click(screen.getByRole('button', { name: /^rename$/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByTestId('location')).toHaveTextContent('/profiles/atlas')
  })
})

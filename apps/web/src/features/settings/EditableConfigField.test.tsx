import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { EditableConfigField } from './EditableConfigField'
import type { SettingsField } from './types'

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const TZ_FIELD: SettingsField = {
  key: 'timezone',
  label: 'timezone',
  description: 'Display timezone',
  type: 'string',
  value: 'UTC',
  isSecret: false,
}

const TURNS_FIELD: SettingsField = {
  key: 'agent.max_turns',
  label: 'max_turns',
  description: 'Agent → Max Turns',
  type: 'number',
  value: 100,
  isSecret: false,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(String(input), init)),
  )
}

describe('EditableConfigField', () => {
  it('shows the current value with an Edit affordance (not an always-on input)', () => {
    renderWithClient(<EditableConfigField field={TZ_FIELD} />)
    expect(screen.getByText('UTC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    // No live input until the user chooses to edit.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('reveals an input on Edit and saves the new value via the BFF', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; body: unknown }> = []
    stubFetch(async (url, init) => {
      if (init?.method === 'POST') {
        calls.push({ url, body: JSON.parse(init.body as string) })
        return new Response(
          JSON.stringify({ ok: true, key: 'timezone', value: 'America/New_York' }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 200 })
    })

    renderWithClient(<EditableConfigField field={TZ_FIELD} />)
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'America/New_York')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.url).toContain('/api/agent-deck/config/field')
    expect(calls[0]!.body).toEqual({ key: 'timezone', value: 'America/New_York' })
  })

  it('shows a clear error and does NOT close the editor when the write fails', async () => {
    const user = userEvent.setup()
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'invalid_value', message: 'Bad value.' }), {
          status: 400,
        })
      }
      return new Response('{}', { status: 200 })
    })

    renderWithClient(<EditableConfigField field={TURNS_FIELD} />)
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const input = await screen.findByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '7')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // The error is surfaced; the input stays open so the user can correct it.
    expect(await screen.findByText(/bad value/i)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
  })

  it('cancel discards the edit and restores the read view', async () => {
    const user = userEvent.setup()
    stubFetch(async () => new Response('{}', { status: 200 }))
    renderWithClient(<EditableConfigField field={TZ_FIELD} />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'changed-but-cancelled')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // Back to the read view with the original value; no input.
    expect(screen.getByText('UTC')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

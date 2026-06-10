import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from './SessionList'
import { getPinnedSnapshot, unpinSession } from './pinStore'
import type { SessionListResponse } from './types'

/**
 * Hermetic test of the connected SessionList delete + pin flow: a stubbed BFF
 * (mocked global fetch) feeding the real connected component through a real
 * QueryClient. Asserts delete confirms FIRST, calls the DELETE route, and the
 * row leaves the list on success.
 */

const NOW_SEC = Math.floor(Date.now() / 1000)

function row(id: string, title: string) {
  return {
    // Web-originated so rows pass §3's default source filter (these tests
    // exercise the delete flow, not the source filter).
    id,
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title,
    preview: 'preview',
    started_at: NOW_SEC,
    last_active: NOW_SEC,
    message_count: 1,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    cost_usd: null,
    is_active: false,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let deleted: Set<string>
let deleteCalls: Array<{ method: string; url: string }>

function liveList(): SessionListResponse {
  const all = [row('sess-1', 'Keep me'), row('sess-2', 'Delete me')]
  const remaining = all.filter((r) => !deleted.has(r.id))
  return { total: remaining.length, sessions: remaining }
}

beforeEach(() => {
  // Reset the module-level pin store so pins never leak between tests.
  for (const id of [...getPinnedSnapshot()]) unpinSession(id)
  deleted = new Set()
  deleteCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (method === 'DELETE' && /\/sessions\/(sess-\d+)/.test(url)) {
        deleteCalls.push({ method, url })
        const id = url.match(/\/sessions\/(sess-\d+)/)![1]!
        deleted.add(id)
        return jsonResponse({ deleted: true })
      }
      if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
      if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
      if (url.includes('/sessions')) return jsonResponse(liveList())
      throw new Error(`unexpected fetch: ${method} ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderRail(selectedId: string | null = null, onSessionDeleted?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionList
        selectedId={selectedId}
        onSelect={() => {}}
        onSessionDeleted={onSessionDeleted}
      />
    </QueryClientProvider>,
  )
}

describe('SessionList source default', () => {
  it('shows external sessions by default when there are NO web-originated ones (real-install rail is not empty)', async () => {
    // A real Hermes install: all sessions are cli/telegram/cron — ZERO web. The
    // rail must not read "No sessions yet" over hundreds of real conversations.
    const cliRow = { ...row('sess-9', 'From the CLI'), source: 'cli' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
        if (url.includes('/sessions')) return jsonResponse({ total: 1, sessions: [cliRow] })
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    renderRail()
    expect(await screen.findByText('From the CLI')).toBeInTheDocument()
    expect(screen.queryByText(/no sessions yet/i)).not.toBeInTheDocument()
  })
})

describe('SessionList delete flow (connected)', () => {
  it('confirms FIRST and only deletes after the explicit Delete button', async () => {
    const user = userEvent.setup()
    renderRail()

    await screen.findByRole('button', { name: 'Delete Delete me' })
    await user.click(screen.getByRole('button', { name: 'Delete Delete me' }))

    // A confirm dialog appears; nothing has been deleted yet.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Delete session\?/)).toBeInTheDocument()
    expect(deleteCalls).toHaveLength(0)

    // Confirm.
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteCalls).toHaveLength(1))
    expect(deleteCalls[0]!.method).toBe('DELETE')
    expect(deleteCalls[0]!.url).toContain('/sessions/sess-2')

    // The row (and its delete action) leave the list (rail refetched).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete Delete me' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument()
    // The other session is untouched.
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })

  it('cancelling the confirm deletes nothing', async () => {
    const user = userEvent.setup()
    renderRail()

    await screen.findByRole('button', { name: 'Delete Delete me' })
    await user.click(screen.getByRole('button', { name: 'Delete Delete me' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCalls).toHaveLength(0)
    expect(screen.getByText('Delete me')).toBeInTheDocument()
  })

  it('notifies the caller when the currently-open session is deleted (navigate away)', async () => {
    const user = userEvent.setup()
    const onSessionDeleted = vi.fn()
    renderRail('sess-2', onSessionDeleted)

    await screen.findByRole('button', { name: 'Delete Delete me' })
    await user.click(screen.getByRole('button', { name: 'Delete Delete me' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onSessionDeleted).toHaveBeenCalledWith('sess-2'))
  })
})

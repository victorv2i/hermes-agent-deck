import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from './SessionList'
import { getPinnedSnapshot, unpinSession } from './pinStore'
import type { SessionListResponse } from './types'

/**
 * Hermetic test of the CONNECTED SessionList bulk-ops wiring: with `enableBulkOps`
 * the connected component self-wires the multi-select bar to its real mutations.
 * A stubbed BFF (mocked global fetch) feeds the real component through a real
 * QueryClient. Asserts multi-select → "Delete selected" → confirm fires one
 * DELETE per checked id (proving the wiring is live, not dead UI).
 */

const NOW_SEC = Math.floor(Date.now() / 1000)

function row(id: string, title: string) {
  return {
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
  const all = [row('sess-1', 'Keep me'), row('sess-2', 'Delete me'), row('sess-3', 'Me too')]
  const remaining = all.filter((r) => !deleted.has(r.id))
  return { total: remaining.length, sessions: remaining }
}

beforeEach(() => {
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

function renderRail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionList selectedId={null} onSelect={() => {}} enableBulkOps />
    </QueryClientProvider>,
  )
}

describe('SessionList bulk-ops wiring (connected)', () => {
  it('does not show the Select toggle unless enableBulkOps is set', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <SessionList selectedId={null} onSelect={() => {}} />
      </QueryClientProvider>,
    )
    await screen.findByText('Delete me')
    expect(screen.queryByRole('button', { name: /^Select sessions$/i })).not.toBeInTheDocument()
  })

  it('multi-selects rows and deletes each checked session on confirm', async () => {
    const user = userEvent.setup()
    renderRail()

    await screen.findByText('Delete me')

    // Enter multi-select mode.
    await user.click(screen.getByRole('button', { name: /^Select sessions$/i }))

    // Check two of the three rows.
    await user.click(screen.getByRole('checkbox', { name: 'Delete me' }))
    await user.click(screen.getByRole('checkbox', { name: 'Me too' }))

    // The bar announces the count and offers the destructive action.
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete selected sessions/i }))

    // A confirm dialog appears; nothing deleted yet.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Delete 2 sessions\?/)).toBeInTheDocument()
    expect(deleteCalls).toHaveLength(0)

    // Confirm.
    await user.click(within(dialog).getByRole('button', { name: /^Delete 2 sessions$/i }))

    // One DELETE per checked id (order-independent).
    await waitFor(() => expect(deleteCalls).toHaveLength(2))
    const urls = deleteCalls.map((c) => c.url)
    expect(urls.some((u) => u.includes('/sessions/sess-2'))).toBe(true)
    expect(urls.some((u) => u.includes('/sessions/sess-3'))).toBe(true)
    // The unchecked session was never deleted.
    expect(urls.some((u) => u.includes('/sessions/sess-1'))).toBe(false)

    // Both deleted rows leave the list; the kept one remains.
    await waitFor(() => expect(screen.queryByText('Delete me')).not.toBeInTheDocument())
    expect(screen.queryByText('Me too')).not.toBeInTheDocument()
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })
})

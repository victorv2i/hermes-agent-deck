import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from './SessionList'
import { RAIL_PAGE_SIZE, setShowExternalSources } from './hooks'
import { getPinnedSnapshot, unpinSession } from './pinStore'

/**
 * §3 — the clean/dense chat rail. With `dense`, the connected rail must SUPPRESS
 * the power-user management UI (multi-select + bulk bar, the Projects/folders
 * section + active-filter row, the external-source "Other sessions" reveal, the
 * "Load more" pagination footer, and the duplicate "Label session (local)" rename)
 * while KEEPING the clean essentials (search box, titles, active highlight, and the
 * per-row overflow with the real Hermes Rename + Delete). A stubbed BFF feeds the
 * real connected component through a real QueryClient. We seed a mixed web/external
 * list (so the reveal WOULD show), a non-empty project store (so Folders WOULD
 * show), and a two-page total (so "Load more" WOULD show) — proving the dense flag
 * is what suppresses them, not an absence of data.
 */

const NOW_SEC = Math.floor(Date.now() / 1000)

function webRow(id: string, title: string) {
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

// A SMALL loaded page (so the virtualizer's window mounts every row — the test-only
// stub shows the tail of a long list, which would window early rows out). But the
// SERVER reports a larger TOTAL than the loaded length, so `hasMore` is true and a
// "Load more" footer WOULD render in the full rail. The first row is external (cli)
// so the "Other sessions" reveal WOULD render in the full rail too.
const TOTAL = RAIL_PAGE_SIZE
const LOADED = [
  { ...webRow('sess-0', 'CLI session'), source: 'cli' },
  webRow('sess-1', 'Session 1'),
  webRow('sess-2', 'Session 2'),
  webRow('sess-3', 'Session 3'),
]

beforeEach(() => {
  for (const id of [...getPinnedSnapshot()]) unpinSession(id)
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  setShowExternalSources(false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      // A non-empty project store, so the Folders section WOULD render in the full rail.
      if (url.includes('/organization'))
        return jsonResponse({
          projects: [{ id: 'p1', name: 'Work', color: '#888888' }],
          assignments: {},
        })
      if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
      if (url.includes('/sessions')) {
        // First page returns the small loaded set; report a larger server total so
        // hasMore (loaded < total) is true. Subsequent offsets return nothing.
        const u = new URL(url, 'http://localhost')
        const offset = Number(u.searchParams.get('offset') ?? 0)
        return jsonResponse({ total: TOTAL, sessions: offset === 0 ? LOADED : [] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDenseRail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionList selectedId={null} onSelect={() => {}} dense />
    </QueryClientProvider>,
  )
}

describe('SessionList dense rail (connected)', () => {
  it('suppresses the Projects/folders section', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    expect(screen.queryByRole('region', { name: /folders/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /all sessions/i })).not.toBeInTheDocument()
  })

  it('suppresses the multi-select "Select" toggle', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    expect(screen.queryByRole('button', { name: /^Select sessions$/i })).not.toBeInTheDocument()
  })

  it('suppresses the external-source "Other sessions" reveal toggle (and shows all sessions)', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    expect(screen.queryByRole('button', { name: /other sessions/i })).not.toBeInTheDocument()
    // With no reveal toggle, dense shows ALL sessions (web + external) by default.
    expect(screen.getByText('CLI session')).toBeInTheDocument()
  })

  it('suppresses the "Load more" pagination footer', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/loaded \d+ of/i)).not.toBeInTheDocument()
  })

  it('keeps the search box and session titles', async () => {
    renderDenseRail()
    expect(await screen.findByText('Session 1')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('keeps the per-row overflow with the real Rename + Delete (and drops the local Label path)', async () => {
    const user = userEvent.setup()
    renderDenseRail()
    await screen.findByText('Session 1')
    // Open the overflow menu for a row.
    const trigger = screen.getAllByRole('button', { name: /more actions for/i })[0]!
    await user.click(trigger)
    const menu = await screen.findByRole('menuitem', { name: /^Rename$/i })
    expect(menu).toBeInTheDocument()
    // The duplicate "Label session (local)" path is gone in dense mode.
    expect(screen.queryByRole('menuitem', { name: /label session/i })).not.toBeInTheDocument()
  })

  it('shows the active "New chat" row at the top while no session is selected', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    const row = screen.getByTestId('rail-new-chat-row')
    expect(row).toHaveTextContent(/new chat/i)
    expect(row).toHaveAttribute('aria-current', 'true')
  })
})

// A reference assertion: the FULL (non-dense) rail still renders the suppressed
// chrome, so the dense suppression above is the flag's doing — not missing data.
describe('SessionList full rail still renders management chrome (control)', () => {
  it('renders Folders + "Load more" footer in the non-dense rail', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <SessionList selectedId={null} onSelect={() => {}} />
      </QueryClientProvider>,
    )
    await screen.findByText('Session 1')
    expect(screen.getByRole('region', { name: /folders/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument(),
    )
  })
})

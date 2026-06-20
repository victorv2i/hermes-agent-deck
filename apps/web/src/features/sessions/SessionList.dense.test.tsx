import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from './SessionList'
import { RAIL_PAGE_SIZE, setShowExternalSources } from './hooks'
import { getPinnedSnapshot, unpinSession } from './pinStore'

/**
 * §3 — the clean/dense chat rail. With `dense`, the connected rail SUPPRESSES the
 * power-user management UI (multi-select + bulk bar, the Projects/folders section
 * + active-filter row, the "Load more" pagination footer, and the duplicate
 * "Label session (local)" rename) while KEEPING the clean essentials (search box,
 * titles, active highlight, and the per-row overflow with the real Hermes Rename +
 * Delete). It ALSO keeps the web-first default + the collapsed "Other sessions (N)"
 * disclosure: only agent-deck (web) sessions show by default, and the external
 * (cli/telegram/discord/cron/api) sessions fold under a closed toggle the user can
 * expand. A stubbed BFF feeds the real connected component through a real
 * QueryClient. We seed a mixed web/external list (so the reveal shows), a non-empty
 * project store (so Folders WOULD show), and a two-page total (so "Load more" WOULD
 * show) — proving the dense flag is what suppresses the power-user chrome, not an
 * absence of data.
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

  it('folds external sessions under a CLOSED "Other sessions (N)" reveal (web-first default)', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    // Web-first default: the agent-deck (web) sessions show; the external (cli)
    // session is folded away until revealed.
    expect(screen.queryByText('CLI session')).not.toBeInTheDocument()
    // The collapsed reveal toggle names the count of folded external sessions and
    // is CLOSED by default (aria-pressed false).
    const toggle = screen.getByRole('button', { name: /other sessions \(1\)/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('reveals the folded external sessions when the "Other sessions" toggle is expanded', async () => {
    const user = userEvent.setup()
    renderDenseRail()
    await screen.findByText('Session 1')
    await user.click(screen.getByRole('button', { name: /other sessions \(1\)/i }))
    // Expanding the disclosure brings the external (cli) session into the rail.
    expect(await screen.findByText('CLI session')).toBeInTheDocument()
  })

  it('shows the "Load more" pagination footer so older chats are reachable', async () => {
    renderDenseRail()
    await screen.findByText('Session 1')
    // The dense rail used to suppress this; it now pages back like History so the
    // user can reach older chats (the server reports a larger total than loaded).
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
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

// The real-install scenario the web-first fold must survive: the deck's OWN
// (dashboard-sourced) chats are sparse + OLDER than the recency page, so a busy
// install's first page is ALL external (cron/telegram) with zero deck sessions in
// view. A pure client-side split would find no web sessions and fall back to
// "show everything", defeating the fold. The dense rail fetches the deck's own
// sessions BY SOURCE so they surface regardless of age and the fold still scopes
// to them. A source-aware stub mimics this: ?source=dashboard returns an old deck
// chat absent from the recency page, which returns only external sessions.
describe("SessionList dense rail surfaces the deck's own (dashboard) sessions even when older than the recent page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
        if (url.includes('/sessions')) {
          const u = new URL(url, 'http://localhost')
          if (u.searchParams.get('source') === 'dashboard') {
            // The deck's own chat — absent from the recency page below.
            return jsonResponse({
              total: 1,
              sessions: [{ ...webRow('deck-old', 'My deck chat'), source: 'dashboard' }],
            })
          }
          // The recency page is ALL external — no deck sessions in view.
          const offset = Number(u.searchParams.get('offset') ?? 0)
          return jsonResponse({
            total: RAIL_PAGE_SIZE,
            sessions:
              offset === 0
                ? [
                    { ...webRow('cron-1', 'Nightly Ops'), source: 'cron' },
                    { ...webRow('tg-1', 'Telegram chat'), source: 'telegram' },
                  ]
                : [],
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
  })

  it('shows the deck (dashboard) chat by default and folds the recent external ones', async () => {
    renderDenseRail()
    // The deck's own chat surfaces even though it's not in the recency page.
    expect(await screen.findByText('My deck chat')).toBeInTheDocument()
    // The recent external (cron/telegram) sessions fold away by default.
    expect(screen.queryByText('Nightly Ops')).not.toBeInTheDocument()
    expect(screen.queryByText('Telegram chat')).not.toBeInTheDocument()
    // The closed "Other sessions (2)" reveal names the folded external count.
    const toggle = screen.getByRole('button', { name: /other sessions \(2\)/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('reveals the folded recent external sessions when the toggle is expanded', async () => {
    const user = userEvent.setup()
    renderDenseRail()
    await screen.findByText('My deck chat')
    await user.click(screen.getByRole('button', { name: /other sessions \(2\)/i }))
    expect(await screen.findByText('Nightly Ops')).toBeInTheDocument()
  })
})

// The SAME scenario for the CURRENT deck source. Since the 2026-05-29 gateway
// `/v1/runs` switch, a chat opened through this deck is tagged `api_server` (not
// `dashboard`). Those chats must surface in the dense rail even when older than
// the recency page (exactly like the legacy `dashboard` chats) so a device
// that did NOT create the chat can still see and continue it. A source-aware
// stub mimics this: ?source=api_server returns an old deck chat absent from the
// recency page (which returns only external sessions); ?source=dashboard is empty.
describe("SessionList dense rail surfaces the deck's own (api_server) sessions even when older than the recent page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
        if (url.includes('/sessions')) {
          const u = new URL(url, 'http://localhost')
          if (u.searchParams.get('source') === 'api_server') {
            // The deck's own current-source chat (absent from the recency page).
            return jsonResponse({
              total: 1,
              sessions: [{ ...webRow('run-old', 'My gateway chat'), source: 'api_server' }],
            })
          }
          if (u.searchParams.get('source') === 'dashboard') {
            // No legacy dashboard chats in this scenario.
            return jsonResponse({ total: 0, sessions: [] })
          }
          // The recency page is ALL external (no deck sessions in view).
          const offset = Number(u.searchParams.get('offset') ?? 0)
          return jsonResponse({
            total: RAIL_PAGE_SIZE,
            sessions:
              offset === 0
                ? [
                    { ...webRow('cron-1', 'Nightly Ops'), source: 'cron' },
                    { ...webRow('tg-1', 'Telegram chat'), source: 'telegram' },
                  ]
                : [],
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
  })

  it('shows the deck (api_server) chat by default and folds the recent external ones', async () => {
    renderDenseRail()
    // The deck's own gateway chat surfaces even though it's not in the recency page.
    expect(await screen.findByText('My gateway chat')).toBeInTheDocument()
    // The recent external (cron/telegram) sessions fold away by default.
    expect(screen.queryByText('Nightly Ops')).not.toBeInTheDocument()
    expect(screen.queryByText('Telegram chat')).not.toBeInTheDocument()
    // The closed "Other sessions (2)" reveal names the folded external count.
    const toggle = screen.getByRole('button', { name: /other sessions \(2\)/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
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

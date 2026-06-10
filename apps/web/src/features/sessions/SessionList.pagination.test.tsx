import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from './SessionList'
import { RAIL_PAGE_SIZE, setShowExternalSources, SHOW_EXTERNAL_SOURCES_STORAGE_KEY } from './hooks'
import { getPinnedSnapshot, unpinSession } from './pinStore'

/**
 * Connected SessionList pagination (P1) + the honest server-total badge (P2):
 * a stubbed BFF returns more sessions than one page, so the rail must show a
 * "Load more" footer reading "Loaded N of total" (total from the server, NOT the
 * loaded length) and page in the next offset on click. Previously the rail was
 * hard-capped at the first 50 with no way to reach older history except search.
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

// A server with TOTAL sessions, paged by limit/offset. The rail's page size is
// RAIL_PAGE_SIZE; we make the total span two pages so "Load more" is reachable.
const TOTAL = RAIL_PAGE_SIZE + 5
const ALL_ROWS = Array.from({ length: TOTAL }, (_, i) => webRow(`sess-${i}`, `Session ${i}`))

let listCalls: Array<{ limit: number; offset: number }>

beforeEach(() => {
  for (const id of [...getPinnedSnapshot()]) unpinSession(id)
  listCalls = []
  // Reset the URL + sticky toggle so prior tests' persisted state doesn't bleed in.
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  setShowExternalSources(false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
      if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
      if (url.includes('/sessions')) {
        const u = new URL(url, 'http://localhost')
        const limit = Number(u.searchParams.get('limit') ?? RAIL_PAGE_SIZE)
        const offset = Number(u.searchParams.get('offset') ?? 0)
        listCalls.push({ limit, offset })
        return jsonResponse({ total: TOTAL, sessions: ALL_ROWS.slice(offset, offset + limit) })
      }
      throw new Error(`unexpected fetch: ${url}`)
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
      <SessionList selectedId={null} onSelect={() => {}} />
    </QueryClientProvider>,
  )
}

describe('SessionList pagination (connected)', () => {
  it('shows the SERVER total in the "All sessions" badge, not the loaded length (P2)', async () => {
    renderRail()
    const allRadio = await screen.findByRole('radio', { name: /all sessions/i })
    // The loaded length is one page (RAIL_PAGE_SIZE); the badge must show TOTAL.
    await waitFor(() => expect(within(allRadio).getByText(String(TOTAL))).toBeInTheDocument())
    expect(within(allRadio).queryByText(String(RAIL_PAGE_SIZE))).not.toBeInTheDocument()
  })

  it('renders a "Load more" footer reading loaded/total and pages in older sessions (P1)', async () => {
    const user = userEvent.setup()
    renderRail()

    // First page loaded: footer says "Loaded 50 of 55" with a Load more button.
    await screen.findByText(new RegExp(`loaded ${RAIL_PAGE_SIZE} of ${TOTAL}`, 'i'))
    const loadMore = screen.getByRole('button', { name: /load more/i })
    expect(listCalls).toEqual([{ limit: RAIL_PAGE_SIZE, offset: 0 }])

    // Click → fetches the SECOND page at the right offset (older history).
    await user.click(loadMore)
    await waitFor(() =>
      expect(listCalls).toContainEqual({ limit: RAIL_PAGE_SIZE, offset: RAIL_PAGE_SIZE }),
    )

    // Now everything is loaded: the count updates and the button disappears
    // (no dead control once there's nothing more to fetch).
    await screen.findByText(new RegExp(`loaded ${TOTAL} of ${TOTAL}`, 'i'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument(),
    )
  })
})

describe('SessionList refresh-durability (connected, P3)', () => {
  it('restores the search box from the URL on mount (a reload keeps the query)', async () => {
    window.history.replaceState(null, '', '/?q=session%201')
    renderRail()
    // The search box seeds from ?q so a refresh resumes the same search.
    const box = await screen.findByRole('searchbox')
    expect(box).toHaveValue('session 1')
  })

  it('restores the sticky external-source toggle from localStorage on mount', async () => {
    // A mix of web + external sessions so the "Other sessions (N)" reveal shows.
    const mixed = [webRow('w-1', 'Web one'), { ...webRow('c-1', 'CLI one'), source: 'cli' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
        if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
        if (url.includes('/sessions')) return jsonResponse({ total: mixed.length, sessions: mixed })
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    // Persist the sticky "on" choice as a prior session would have.
    localStorage.setItem(SHOW_EXTERNAL_SOURCES_STORAGE_KEY, '1')
    setShowExternalSources(true)

    renderRail()
    // Both web AND external rows show because the sticky reveal was restored on.
    expect(await screen.findByText('Web one')).toBeInTheDocument()
    expect(screen.getByText('CLI one')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /other sessions/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})

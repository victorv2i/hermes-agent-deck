import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HistoryRoute } from './HistoryRoute'
import type { SessionListResponse } from './types'

// The History surface mounts the connected SessionList (TanStack Query) and uses
// the router for navigation. With no fetch backend the list stays empty/loading,
// which is fine for these surface-level assertions.
function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const routes: RouteObject[] = [
    { path: '/history', element: <HistoryRoute /> },
    { path: '/chat', element: <div data-testid="chat-surface">chat</div> },
    { path: '/sessions/:id', element: <div data-testid="transcript-surface">transcript</div> },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/history'] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const NOW = Math.floor(Date.now() / 1000)

function listOf(...rows: { id: string; title: string; source?: string }[]): SessionListResponse {
  return {
    total: rows.length,
    sessions: rows.map((r) => ({
      id: r.id,
      source: r.source ?? 'web',
      model: 'anthropic/claude-sonnet-4',
      title: r.title,
      preview: 'preview',
      started_at: NOW,
      last_active: NOW,
      message_count: 1,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      cost_usd: null,
      is_active: false,
    })),
  }
}

function stubSessions(list: SessionListResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/organization')) {
        return new Response(JSON.stringify({ projects: [], assignments: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/search/sessions')) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/sessions')) {
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HistoryRoute', () => {
  it('renders a full session browser (its search box) as a home for past chats', () => {
    renderHistory()
    expect(screen.getByRole('heading', { name: /^history$/i })).toBeInTheDocument()
    // The full SessionList experience is reused — its search box is always present.
    expect(screen.getByRole('searchbox', { name: /search sessions/i })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /sessions/i })).toBeInTheDocument()
  })

  it('leads with a "New chat" action at the top (start a new one above recents)', () => {
    renderHistory()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
  })

  it('gives the toolbar buttons a 44px hit-area overlay without changing their visual size', () => {
    renderHistory()
    // The sm buttons render at 28px; the before:-inset-y-2 pseudo-element
    // stretches each one's effective touch target to 44px (StatCard technique).
    for (const name of [/prune old/i, /new chat/i]) {
      const btn = screen.getByRole('button', { name })
      expect(btn.className).toContain('before:-inset-y-2')
    }
  })

  it('New chat navigates to the Chat surface', async () => {
    const user = userEvent.setup()
    renderHistory()
    await user.click(screen.getByRole('button', { name: /new chat/i }))
    expect(screen.getByTestId('chat-surface')).toBeInTheDocument()
  })

  describe('§1 one-click resume', () => {
    it('clicking a session RESUMES in place (→ /chat?continue=<id>), not the transcript page', async () => {
      const user = userEvent.setup()
      stubSessions(listOf({ id: 'sess-7', title: 'Resume me' }))
      const router = renderHistory()
      // Match the row button precisely (not the overflow action sharing the title).
      const row = await screen.findByRole('button', {
        name: (name) =>
          name.includes('Resume me') &&
          !name.startsWith('Pin ') &&
          !name.startsWith('Delete ') &&
          !name.startsWith('More actions'),
      })
      await user.click(row)
      // Lands on Chat carrying the resume intent — never the read-only transcript.
      expect(screen.getByTestId('chat-surface')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/chat')
      expect(router.state.location.search).toBe('?continue=sess-7')
      expect(screen.queryByTestId('transcript-surface')).not.toBeInTheDocument()
    })

    it('offers a secondary "View transcript (read-only)" overflow action → /sessions/:id', async () => {
      const user = userEvent.setup()
      stubSessions(listOf({ id: 'sess-9', title: 'Old chat' }))
      const router = renderHistory()
      await screen.findByText('Old chat')
      await user.click(screen.getByRole('button', { name: /More actions for Old chat/i }))
      await user.click(await screen.findByRole('menuitem', { name: /View transcript/i }))
      expect(router.state.location.pathname).toBe('/sessions/sess-9')
      expect(screen.getByTestId('transcript-surface')).toBeInTheDocument()
    })
  })
})

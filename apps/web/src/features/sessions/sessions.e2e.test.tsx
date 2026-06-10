import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useNavigate, useParams } from 'react-router-dom'
import { SessionList } from './SessionList'
import { SessionsRoute } from './SessionsRoute'
import type { SessionListResponse, SessionDetail, SessionMessagesResponse } from './types'

/**
 * Hermetic end-to-end of the Sessions surface: a stubbed BFF (mocked global
 * fetch) feeding the real connected SessionList + SessionsRoute through a real
 * QueryClient and a memory router. Covers list → open → continue without any
 * live BFF or dashboard.
 */

const NOW_SEC = Math.floor(Date.now() / 1000)

const LIST: SessionListResponse = {
  total: 1,
  sessions: [
    {
      id: 'sess-1',
      // Web-originated so the row passes §3's default source filter.
      source: 'web',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      preview: 'help me refactor',
      started_at: NOW_SEC,
      last_active: NOW_SEC,
      message_count: 2,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.01,
      is_active: true,
    },
  ],
}

const DETAIL: SessionDetail = {
  ...LIST.sessions[0]!,
  ended_at: NOW_SEC,
  end_reason: 'completed',
  tool_call_count: 0,
}

const MESSAGES: SessionMessagesResponse = {
  session_id: 'sess-1',
  messages: [
    {
      id: '1',
      role: 'user',
      content: 'refactor the parser please',
      timestamp: NOW_SEC,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Sure, here is the plan.',
      timestamp: NOW_SEC,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    },
  ],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/organization')) return jsonResponse({ projects: [], assignments: {} })
      if (url.includes('/sessions/sess-1/messages')) return jsonResponse(MESSAGES)
      if (url.includes('/sessions/sess-1')) return jsonResponse(DETAIL)
      if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
      if (url.includes('/sessions')) return jsonResponse(LIST)
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

/** A tiny harness: the rail (SessionList) + the History route, sharing a
 * memory router. §1 — a row click RESUMES in place (→ /chat?continue=); the
 * read-only transcript is reached via the row's "View transcript" overflow. */
function Harness() {
  return <Rail />
}

function Rail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  return (
    <div>
      <SessionList
        selectedId={id ?? null}
        onSelect={(sid) => navigate(`/chat?continue=${encodeURIComponent(sid)}`)}
        onViewTranscript={(sid) => navigate(`/sessions/${sid}`)}
      />
    </div>
  )
}

function renderApp() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Harness /> },
      // Continue navigates to the chat surface (/chat?continue=…); give the
      // harness a real landing route so that navigation resolves.
      { path: '/chat', element: <Harness /> },
      { path: '/sessions/:id', element: <SessionsRouteWithRail /> },
    ],
    { initialEntries: ['/'] },
  )
  return render(
    <QueryClientProvider client={newClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** History route + the rail above it (so selection highlight is exercised). */
function SessionsRouteWithRail() {
  return (
    <div>
      <Rail />
      <SessionsRoute />
    </div>
  )
}

describe('Sessions surface (hermetic e2e)', () => {
  it('lists sessions, views the transcript via overflow, and resumes', async () => {
    const user = userEvent.setup()
    renderApp()

    // The rail lists the session. (The row sits beside Pin/Delete/overflow
    // actions that also carry the title in their label, so match the row
    // precisely — the one that contains the title but is NOT a row action.)
    const row = await screen.findByRole('button', {
      name: (name) =>
        name.includes('Refactor the parser') &&
        !name.startsWith('Pin ') &&
        !name.startsWith('Delete ') &&
        !name.startsWith('More actions'),
    })
    expect(row).toBeInTheDocument()

    // §1 — the read-only transcript is the row overflow's secondary action.
    await user.click(screen.getByRole('button', { name: /More actions for Refactor the parser/i }))
    await user.click(await screen.findByRole('menuitem', { name: /View transcript/i }))

    // → navigates to /sessions/sess-1 and loads detail + messages.
    expect(await screen.findByRole('heading', { name: 'Refactor the parser' })).toBeInTheDocument()
    expect(await screen.findByText('refactor the parser please')).toBeInTheDocument()
    expect(await screen.findByText('Sure, here is the plan.')).toBeInTheDocument()

    // Resume picks up the conversation (navigates to the chat surface with ?continue=).
    const continueBtn = await screen.findByRole('button', { name: /^Resume$/i })
    await user.click(continueBtn)

    // Back on the chat surface (the rail's "New chat"-less harness root).
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Refactor the parser' })).not.toBeInTheDocument()
    })
  })
})

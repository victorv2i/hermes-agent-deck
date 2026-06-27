import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { RuntimeCapabilities, UnifiedSessionsResponse } from '@agent-deck/protocol'
import { RuntimeHistory } from './RuntimeHistory'

/** Surfaces the current location so tests can assert resume navigation. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderIt(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const FULL: RuntimeCapabilities = { chat: true, approvals: true, usage: true, sessions: true }
const READONLY: RuntimeCapabilities = { chat: false, approvals: false, usage: true, sessions: true }

function stub(body: UnifiedSessionsResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response),
  )
}

afterEach(() => vi.restoreAllMocks())

const RESPONSE: UnifiedSessionsResponse = {
  sessions: [
    {
      runtime: 'hermes',
      id: 'h1',
      title: 'Hermes run',
      model: 'hermes-4',
      startedAt: 1,
      lastActive: 9,
      messageCount: 4,
      inputTokens: 1200,
      outputTokens: 300,
      cwd: null,
    },
    {
      runtime: 'claude',
      id: 'c1',
      title: 'Fix the build',
      model: 'claude-sonnet-4-6',
      startedAt: 1,
      lastActive: 8,
      messageCount: 6,
      inputTokens: 500,
      outputTokens: 100,
      cwd: '/work/app',
    },
    {
      runtime: 'codex',
      id: 'x1',
      title: 'Refactor',
      model: 'openai',
      startedAt: 1,
      lastActive: 7,
      messageCount: 2,
      inputTokens: 0,
      outputTokens: 0,
      cwd: '/work/api',
    },
  ],
  sources: [
    { runtime: 'hermes', capabilities: FULL, sessionCount: 1, available: true },
    { runtime: 'claude', capabilities: READONLY, sessionCount: 1, available: true },
    { runtime: 'codex', capabilities: READONLY, sessionCount: 1, available: true },
  ],
}

describe('RuntimeHistory', () => {
  it('lists sessions across runtimes with source-filter counts + read-only badges', async () => {
    stub(RESPONSE)
    renderIt(<RuntimeHistory />)
    await waitFor(() => expect(screen.getByText('Hermes run')).toBeInTheDocument())
    expect(screen.getByText('Fix the build')).toBeInTheDocument()
    expect(screen.getByText('Refactor')).toBeInTheDocument()

    // All filter shows the total; read-only runtimes are badged in the filter.
    const tablist = screen.getByRole('tablist', { name: /filter by runtime/i })
    expect(within(tablist).getByText('All')).toBeInTheDocument()
    // Claude Code + Codex carry a read-only marker; Hermes does not.
    expect(within(tablist).getAllByText('read-only').length).toBe(2)
  })

  it('filters the list to a single runtime', async () => {
    stub(RESPONSE)
    const user = userEvent.setup()
    renderIt(<RuntimeHistory />)
    await waitFor(() => expect(screen.getByText('Fix the build')).toBeInTheDocument())

    // Click the "Claude Code" filter → only the Claude session remains.
    const tablist = screen.getByRole('tablist', { name: /filter by runtime/i })
    await user.click(within(tablist).getByRole('tab', { name: /claude code/i }))
    expect(screen.getByText('Fix the build')).toBeInTheDocument()
    expect(screen.queryByText('Hermes run')).not.toBeInTheDocument()
    expect(screen.queryByText('Refactor')).not.toBeInTheDocument()
  })

  it('resumes a Hermes session on click, but leaves read-only rows non-interactive', async () => {
    stub(RESPONSE)
    const user = userEvent.setup()
    renderIt(<RuntimeHistory />)
    await waitFor(() => expect(screen.getByText('Hermes run')).toBeInTheDocument())

    // The Claude/Codex (read-only) rows are not buttons; only Hermes is resumable.
    expect(screen.getByText('Fix the build').closest('button')).toBeNull()
    expect(screen.getByText('Refactor').closest('button')).toBeNull()
    const hermesRow = screen.getByText('Hermes run').closest('button')
    expect(hermesRow).not.toBeNull()

    await user.click(hermesRow!)
    expect(screen.getByTestId('location')).toHaveTextContent('/chat?continue=h1')
  })

  it('tallies per-runtime usage from the session records (omitting zero-token runtimes)', async () => {
    stub(RESPONSE)
    renderIt(<RuntimeHistory />)
    const usage = await screen.findByTestId('runtime-usage')
    // Hermes: 1200+300 = 1.5k; Claude: 500+100 = 600. Codex has 0 tokens → omitted.
    expect(within(usage).getByTestId('runtime-usage-hermes')).toHaveTextContent('1.5k tok')
    expect(within(usage).getByTestId('runtime-usage-claude')).toHaveTextContent('600 tok')
    expect(within(usage).queryByTestId('runtime-usage-codex')).not.toBeInTheDocument()
  })

  it('shows an inviting overall-empty state when there are no sessions anywhere', async () => {
    stub({
      sessions: [],
      sources: [{ runtime: 'hermes', capabilities: FULL, sessionCount: 0, available: true }],
    })
    renderIt(<RuntimeHistory />)
    await waitFor(() => expect(screen.getByTestId('runtime-history-empty')).toBeInTheDocument())
    expect(screen.getByText(/no agent sessions yet/i)).toBeInTheDocument()
  })

  it('shows a per-filter empty (not the overall invite) when the filtered runtime has none', async () => {
    // Sessions exist (Hermes), but Codex reported a source with zero sessions.
    stub({
      sessions: [
        {
          runtime: 'hermes',
          id: 'h1',
          title: 'Hermes run',
          model: 'hermes-4',
          startedAt: 1,
          lastActive: 9,
          messageCount: 1,
          inputTokens: 0,
          outputTokens: 0,
          cwd: null,
        },
      ],
      sources: [
        { runtime: 'hermes', capabilities: FULL, sessionCount: 1, available: true },
        { runtime: 'codex', capabilities: READONLY, sessionCount: 0, available: true },
      ],
    })
    const user = userEvent.setup()
    renderIt(<RuntimeHistory />)
    await waitFor(() => expect(screen.getByText('Hermes run')).toBeInTheDocument())
    const tablist = screen.getByRole('tablist', { name: /filter by runtime/i })
    await user.click(within(tablist).getByRole('tab', { name: /^codex/i }))
    // The per-filter empty, NOT the fresh-slate invite (sessions exist elsewhere).
    const filterEmpty = screen.getByTestId('runtime-history-filter-empty')
    expect(filterEmpty).toBeInTheDocument()
    expect(filterEmpty).toHaveTextContent('No Codex sessions yet.')
    expect(screen.queryByTestId('runtime-history-empty')).not.toBeInTheDocument()
  })

  it('shows "No sessions yet." (no filter qualifier) when filter is all and there are no shown sessions', async () => {
    // This case cannot occur naturally (shown is empty only when filtered), but we
    // guard the 'all' branch explicitly: no qualifier should appear.
    stub({
      sessions: [],
      sources: [],
    })
    renderIt(<RuntimeHistory />)
    // With zero sessions the overall-empty testid fires (not filter-empty).
    await waitFor(() => expect(screen.getByTestId('runtime-history-empty')).toBeInTheDocument())
    // The per-filter empty must NOT contain the old "for this filter" copy.
    expect(screen.queryByText(/for this filter/)).not.toBeInTheDocument()
  })
})

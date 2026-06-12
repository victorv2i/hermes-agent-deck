import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionBreakdown } from './SessionBreakdown'
import type { SessionSummary } from '@/features/sessions/types'

const NOW = 1_700_000_000 // unix seconds, injected so the window is deterministic

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    source: 'api_server',
    model: 'claude-sonnet-4',
    title: null,
    preview: '',
    started_at: NOW - 3_600,
    last_active: NOW - 600,
    message_count: 4,
    input_tokens: 1_000,
    output_tokens: 200,
    total_tokens: 1_200,
    cost_usd: null,
    is_active: false,
    ...overrides,
  }
}

function renderBreakdown(props: Partial<React.ComponentProps<typeof SessionBreakdown>> = {}) {
  return render(
    <MemoryRouter>
      <SessionBreakdown periodDays={7} nowSeconds={NOW} {...props} />
    </MemoryRouter>,
  )
}

describe('SessionBreakdown', () => {
  it('ranks the window sessions by total tokens, descending', () => {
    renderBreakdown({
      sessions: [
        session({
          id: 's-small',
          title: 'Small',
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        }),
        session({
          id: 's-big',
          title: 'Big',
          input_tokens: 64_321,
          output_tokens: 1_234,
          total_tokens: 65_555,
        }),
        session({
          id: 's-mid',
          title: 'Mid',
          input_tokens: 900,
          output_tokens: 100,
          total_tokens: 1_000,
        }),
      ],
    })
    const rows = screen.getAllByTestId('session-usage-row')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Big'),
      expect.stringContaining('Mid'),
      expect.stringContaining('Small'),
    ])
    // The top row carries the compact token figures.
    expect(rows[0]).toHaveTextContent('64.3K')
    expect(rows[0]).toHaveTextContent('1.2K')
  })

  it('excludes sessions whose last activity falls outside the selected window', () => {
    renderBreakdown({
      sessions: [
        session({ id: 's-in', title: 'In window' }),
        session({ id: 's-out', title: 'Out of window', last_active: NOW - 8 * 86_400 }),
      ],
    })
    expect(screen.getByText('In window')).toBeInTheDocument()
    expect(screen.queryByText('Out of window')).toBeNull()
  })

  it('links each session back to its conversation at /chat/:id', () => {
    renderBreakdown({ sessions: [session({ id: 'sess one', title: 'Linked' })] })
    expect(screen.getByRole('link', { name: 'Linked' })).toHaveAttribute('href', '/chat/sess%20one')
  })

  it('shows real dollars when a session recorded a cost', () => {
    renderBreakdown({ sessions: [session({ id: 's1', cost_usd: 1.25 })] })
    expect(screen.getByText('$1.25')).toBeInTheDocument()
  })

  it('says "included" under a subscription instead of a fake $0', () => {
    renderBreakdown({
      sessions: [session({ id: 's1', cost_usd: 0 })],
      billingMode: 'subscription',
    })
    expect(screen.getByText('included')).toBeInTheDocument()
  })

  it('never implies free when the billing signal is unresolved', () => {
    renderBreakdown({ sessions: [session({ id: 's1', cost_usd: null })] })
    expect(screen.getByText('not recorded')).toBeInTheDocument()
  })

  it('shows an honest empty state for a quiet window', () => {
    renderBreakdown({ sessions: [] })
    expect(screen.getByText(/no sessions with activity/i)).toBeInTheDocument()
  })

  it('shows a calm error line when the sessions source is unavailable', () => {
    renderBreakdown({ error: new Error('boom') })
    expect(screen.getByText(/couldn’t load sessions/i)).toBeInTheDocument()
    expect(screen.queryByText('boom')).toBeNull()
  })

  it('owns the whole-session-totals caveat and acknowledges rows beyond the cap', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      session({ id: `s${i}`, title: `S${i}`, total_tokens: 1_000 - i }),
    )
    // Under the fetch limit: the fetched rows ARE the whole window, so the
    // plain ranking claim holds and the hidden rows really are smaller.
    renderBreakdown({ sessions: many, fetchLimit: 100 })
    expect(screen.getAllByTestId('session-usage-row')).toHaveLength(12)
    expect(screen.getByText(/whole-session totals/i)).toBeInTheDocument()
    expect(screen.getByText(/ranked by total tokens\./i)).toBeInTheDocument()
    expect(screen.queryByText(/most recently active sessions/i)).toBeNull()
    expect(screen.getByText(/3 smaller sessions are not shown/i)).toBeInTheDocument()
  })

  it('scopes the ranking claim when the fetch came back full (window may be cut off)', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      session({ id: `s${i}`, title: `S${i}`, total_tokens: 1_000 - i }),
    )
    renderBreakdown({ sessions: many, fetchLimit: 15 })
    // The claim is scoped to the fetched recency slice, not the whole window…
    expect(
      screen.getByText(/ranked by total tokens among your 15 most recently active sessions/i),
    ).toBeInTheDocument()
    // …and the overflow line cannot call hidden rows "smaller": an unfetched
    // in-window session could be the biggest of all.
    expect(screen.getByText(/3 more sessions are not shown/i)).toBeInTheDocument()
    expect(screen.queryByText(/smaller/i)).toBeNull()
  })
})

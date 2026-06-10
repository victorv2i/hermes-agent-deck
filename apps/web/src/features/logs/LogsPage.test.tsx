import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { AgentDeckLogs } from '@agent-deck/protocol'
import { LogsPage, type LogsPageProps } from './LogsPage'

const LOGS: AgentDeckLogs = {
  file: 'agent',
  truncated: true,
  entries: [
    {
      id: 0,
      timestamp: '2026-05-30 22:35:00,123',
      level: 'INFO',
      logger: 'hermes.gateway',
      message: 'gateway started on :8643',
      raw: '2026-05-30 22:35:00,123 INFO hermes.gateway gateway started on :8643',
    },
    {
      id: 1,
      timestamp: '2026-05-30 22:35:01,002',
      level: 'WARNING',
      logger: 'hermes.cron',
      message: 'token nearing expiry',
      raw: '2026-05-30 22:35:01,002 WARNING hermes.cron token nearing expiry',
    },
    {
      id: 2,
      timestamp: '2026-05-30 22:35:02,500',
      level: 'ERROR',
      logger: 'hermes.agent',
      message: 'failed to dispatch',
      raw: '2026-05-30 22:35:02,500 ERROR hermes.agent failed to dispatch',
    },
    {
      id: 3,
      timestamp: null,
      level: 'unknown',
      logger: null,
      message: 'Traceback (most recent call last):',
      raw: 'Traceback (most recent call last):',
    },
  ],
}

function noop() {}

function baseProps(overrides: Partial<LogsPageProps> = {}): LogsPageProps {
  return {
    file: 'agent',
    onFileChange: noop,
    level: 'ALL',
    onLevelChange: noop,
    keyword: '',
    onKeywordChange: noop,
    autoRefresh: true,
    onAutoRefreshChange: noop,
    onRefresh: noop,
    data: LOGS,
    isLoading: false,
    isFetching: false,
    error: null,
    ...overrides,
  }
}

describe('LogsPage', () => {
  it('renders the surface header and all loaded lines', () => {
    render(<LogsPage {...baseProps()} />)
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByText(/4 of 4 lines shown · Agent · all levels/i)).toBeInTheDocument()
    expect(screen.getByText('gateway started on :8643')).toBeInTheDocument()
    expect(screen.getByText('token nearing expiry')).toBeInTheDocument()
    expect(screen.getByText('failed to dispatch')).toBeInTheDocument()
    // The continuation/traceback line still renders (as a quiet full-width row).
    expect(screen.getByText('Traceback (most recent call last):')).toBeInTheDocument()
  })

  it('colors rows by level via semantic tokens (error=destructive, warn=warning)', () => {
    render(<LogsPage {...baseProps()} />)
    const rows = screen.getAllByRole('row')
    const error = rows.find((r) => r.getAttribute('data-level') === 'ERROR')!
    const warn = rows.find((r) => r.getAttribute('data-level') === 'WARNING')!
    // ERROR carries the destructive level token; WARNING the warning token.
    expect(within(error).getByText('ERROR')).toHaveClass('text-destructive')
    expect(within(warn).getByText('WARNING')).toHaveClass('text-warning')
  })

  it('fires onFileChange when a different file segment is clicked', () => {
    const onFileChange = vi.fn()
    render(<LogsPage {...baseProps({ onFileChange })} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Gateway' }))
    expect(onFileChange).toHaveBeenCalledWith('gateway')
  })

  it('fires onLevelChange when a level segment is clicked', () => {
    const onLevelChange = vi.fn()
    render(<LogsPage {...baseProps({ onLevelChange })} />)
    fireEvent.click(screen.getByRole('radio', { name: 'ERROR' }))
    expect(onLevelChange).toHaveBeenCalledWith('ERROR')
  })

  it('filters the visible lines client-side by keyword (instant)', () => {
    // The keyword is a controlled prop; with it set, only matching lines render.
    render(<LogsPage {...baseProps({ keyword: 'dispatch' })} />)
    expect(screen.getByText(/1 of 4 lines shown .* matching "dispatch"/i)).toBeInTheDocument()
    expect(screen.getByText('failed to dispatch')).toBeInTheDocument()
    expect(screen.queryByText('gateway started on :8643')).not.toBeInTheDocument()
    expect(screen.queryByText('token nearing expiry')).not.toBeInTheDocument()
  })

  it('subtitle shows the filtered count (not the unfiltered total) when a keyword is active', () => {
    // LOGS has 4 entries and truncated=true; 'dispatch' matches only 1.
    // The subtitle must not say "last 4 lines" — that would be dishonest.
    render(<LogsPage {...baseProps({ keyword: 'dispatch' })} />)
    // The subtitle should reflect the 1 visible line, not the raw 4.
    const heading = screen.getByRole('heading', { name: 'Logs' })
    const header = heading.closest('[class]')?.parentElement ?? heading.parentElement!
    // The stale count "4 lines" must not appear in the page header area.
    // We assert the filtered count 1 is shown and the total 4 is NOT shown as-is.
    expect(header).not.toHaveTextContent(/last 4 lines/)
    // The subtitle count should reflect visible (1) not total (4).
    // Grab the subtitle span in the header region.
    const subtitleCount = header.querySelector('.opacity-70')
    expect(subtitleCount).not.toBeNull()
    expect(subtitleCount!.textContent).not.toMatch(/4 lines/)
    expect(subtitleCount!.textContent).toMatch(/1 line/)
  })

  it('shows a "no matching lines" empty state when the keyword excludes everything', () => {
    render(<LogsPage {...baseProps({ keyword: 'zzz-nope' })} />)
    expect(screen.getByText('No matching lines')).toBeInTheDocument()
  })

  it('reflects and toggles auto-refresh', () => {
    const onAutoRefreshChange = vi.fn()
    render(<LogsPage {...baseProps({ autoRefresh: true, onAutoRefreshChange })} />)
    const toggle = screen.getByRole('checkbox', { name: /auto-refresh/i })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(onAutoRefreshChange).toHaveBeenCalledWith(false)
  })

  it('fires onRefresh from the refresh button', () => {
    const onRefresh = vi.fn()
    render(<LogsPage {...baseProps({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /refresh logs/i }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('shows a skeleton while loading (no rows yet)', () => {
    const { container } = render(<LogsPage {...baseProps({ data: undefined, isLoading: true })} />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByRole('row')).not.toBeInTheDocument()
  })

  it('shows an error state with a retry that calls onRefresh', () => {
    const onRefresh = vi.fn()
    render(
      <LogsPage
        {...baseProps({
          data: undefined,
          error: new Error('dashboard logs unavailable'),
          onRefresh,
        })}
      />,
    )
    expect(screen.getByText(/Couldn’t load logs/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('renders a calm human sentence on error — never the raw internal plumbing string', () => {
    render(
      <LogsPage
        {...baseProps({
          data: undefined,
          error: new Error(
            'dashboard logs unavailable: session-token request failed: fetch failed',
          ),
        })}
      />,
    )
    // The user sees the calm, hardcoded sentence...
    expect(
      screen.getByText('Logs come from Hermes. Start Hermes or retry when it is reachable again.'),
    ).toBeInTheDocument()
    // ...and never the raw internal error text.
    expect(screen.queryByText(/session-token request failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fetch failed/i)).not.toBeInTheDocument()
  })

  it('shows an empty state when the file has no lines', () => {
    render(<LogsPage {...baseProps({ data: { file: 'agent', truncated: false, entries: [] } })} />)
    expect(screen.getByText(/nothing logged yet/i)).toBeInTheDocument()
  })

  it('caps the rendered rows to keep the DOM bounded', () => {
    const many: AgentDeckLogs = {
      file: 'agent',
      truncated: true,
      entries: Array.from({ length: 900 }, (_, i) => ({
        id: i,
        timestamp: '2026-05-30 22:35:00',
        level: 'INFO' as const,
        logger: 'l',
        message: `m${i}`,
        raw: `2026-05-30 22:35:00 INFO l m${i}`,
      })),
    }
    render(<LogsPage {...baseProps({ data: many })} />)
    // MAX_RENDERED_LINES = 500 → only the most-recent 500 render.
    expect(screen.getAllByRole('row')).toHaveLength(500)
    // The newest line is kept; the oldest is dropped.
    expect(screen.getByText('m899')).toBeInTheDocument()
    expect(screen.queryByText('m0')).not.toBeInTheDocument()
  })
})

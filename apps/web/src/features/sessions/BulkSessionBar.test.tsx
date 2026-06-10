/**
 * TDD: bulk session operations (capability 1).
 * Failing tests written first; implement in BulkSessionBar.tsx + SessionList.tsx.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkSessionBar } from './BulkSessionBar'
import { SessionListView } from './SessionList'
import type { SessionSummary } from './types'

function s(over: Partial<SessionSummary> & { id: string }): SessionSummary {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title: null,
    preview: 'a preview line',
    started_at: nowSec,
    last_active: nowSec,
    message_count: 3,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: 'none',
    ...over,
  }
}

// ── BulkSessionBar unit tests ──────────────────────────────────────────────

describe('BulkSessionBar', () => {
  it('shows the selected count in the status label', () => {
    render(
      <BulkSessionBar
        selectedCount={3}
        totalCount={10}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('3 selected')
  })

  it('calls onSelectAll when "Select all" is clicked', async () => {
    const user = userEvent.setup()
    const onSelectAll = vi.fn()
    render(
      <BulkSessionBar
        selectedCount={1}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={onSelectAll}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /select all/i }))
    expect(onSelectAll).toHaveBeenCalledTimes(1)
  })

  it('calls onClearSelection when clear is clicked', async () => {
    const user = userEvent.setup()
    const onClearSelection = vi.fn()
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={onClearSelection}
        allVisibleSelected={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('calls onArchive when Archive selected is clicked', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={onArchive}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /archive selected/i }))
    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('calls onExport when Export selected is clicked', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={onExport}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /export selected/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when Delete selected is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={onDelete}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /delete selected/i }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('is keyboard-reachable (all buttons have accessible roles)', () => {
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(4)
    for (const btn of buttons) {
      expect(btn.tagName).toBe('BUTTON')
    }
  })

  it('keeps action labels icon-only on mobile (hidden sm:inline) so the bar never overflows a narrow rail', () => {
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    // The visible text labels collapse on narrow viewports but the controls stay
    // named via aria-label, so each action remains usable + announced.
    for (const name of [/export selected/i, /archive selected/i, /delete selected/i]) {
      const btn = screen.getByRole('button', { name })
      const label = btn.querySelector('span')
      expect(label?.className).toContain('hidden')
      expect(label?.className).toContain('sm:inline')
    }
  })

  it('gives each action a 44px touch target on mobile (min-h-11 / min-w-11)', () => {
    render(
      <BulkSessionBar
        selectedCount={2}
        totalCount={5}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    for (const name of [
      /export selected/i,
      /archive selected/i,
      /delete selected/i,
      /clear selection/i,
    ]) {
      const btn = screen.getByRole('button', { name })
      expect(btn.className).toContain('min-h-11')
      expect(btn.className).toContain('min-w-11')
    }
  })

  it('announces selected count via aria-live status region for SR', () => {
    render(
      <BulkSessionBar
        selectedCount={4}
        totalCount={10}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        allVisibleSelected={false}
      />,
    )
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('4 selected')
  })
})

// ── SessionListView multi-select integration ───────────────────────────────

describe('SessionListView multi-select mode', () => {
  it('renders a "Select" toggle button when onBulkOps is wired', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'First' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /^select sessions$/i })).toBeInTheDocument()
  })

  it('does NOT render the Select toggle when onBulkOps is absent', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'First' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /^select sessions$/i })).not.toBeInTheDocument()
  })

  it('reveals row checkboxes when Select mode is toggled on', async () => {
    const user = userEvent.setup()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Item A' }), s({ id: 'b', title: 'Item B' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
  })

  it('shows the bulk bar after at least one row is checked', async () => {
    const user = userEvent.setup()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Item A' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    const checkbox = screen.getByRole('checkbox', { name: /Item A/i })
    await user.click(checkbox)
    expect(screen.getByRole('status')).toHaveTextContent('1 selected')
  })

  it('calls onBulkArchive with the selected ids', async () => {
    const user = userEvent.setup()
    const onBulkArchive = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Item A' }), s({ id: 'b', title: 'Item B' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive,
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Item A/i }))
    await user.click(screen.getByRole('button', { name: /archive selected/i }))
    expect(onBulkArchive).toHaveBeenCalledWith(['a'])
  })

  it('calls onBulkExport with the selected ids', async () => {
    const user = userEvent.setup()
    const onBulkExport = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'x', title: 'Export Me' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete: vi.fn(),
          onBulkExport,
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Export Me/i }))
    await user.click(screen.getByRole('button', { name: /export selected/i }))
    expect(onBulkExport).toHaveBeenCalledWith(['x'])
  })

  it('calls onBulkDelete with the selected ids after confirm dialog', async () => {
    const user = userEvent.setup()
    const onBulkDelete = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'd', title: 'Delete This' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete,
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Delete This/i }))
    // "Delete selected" opens a confirm dialog (cancel-default) — confirm it
    await user.click(screen.getByRole('button', { name: /delete selected/i }))
    // The confirm dialog now shows the count
    const confirmBtn = await screen.findByRole('button', { name: /delete session/i })
    await user.click(confirmBtn)
    expect(onBulkDelete).toHaveBeenCalledWith(['d'])
  })

  it('"select all" selects every visible row', async () => {
    const user = userEvent.setup()
    const onBulkArchive = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'A' }), s({ id: 'b', title: 'B' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{
          onBulkArchive,
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^select sessions$/i }))
    await user.click(screen.getByRole('checkbox', { name: /^A$/i }))
    await user.click(screen.getByRole('button', { name: /select all/i }))
    await user.click(screen.getByRole('button', { name: /archive selected/i }))
    const ids: string[] = onBulkArchive.mock.calls[0]![0]
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it("row click still navigates (doesn't select) when select mode is OFF", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Nav me' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={onSelect}
        onBulkOps={{
          onBulkArchive: vi.fn(),
          onBulkDelete: vi.fn(),
          onBulkExport: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Nav me/i }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})

/**
 * a11y — session rail row-action touch targets.
 *
 * The row overlay actions (pin, delete, overflow ⋯) use
 * `rounded-md p-1` which renders at ~28px on desktop and collapses further on
 * narrow viewports. WCAG 2.5.5 (AAA) requires 44×44px; we enforce AA-equivalent
 * 44px on mobile via `min-h-11 min-w-11` and allow the desktop density to remain
 * compact via `sm:min-h-0 sm:min-w-0` (or equivalent responsive shrink).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionListView } from './SessionList'
import { BulkSessionBar } from './BulkSessionBar'
import type { SessionSummary } from './types'

function s(over: Partial<SessionSummary> & { id: string }): SessionSummary {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title: 'Test session',
    preview: 'a preview',
    started_at: nowSec,
    last_active: nowSec,
    message_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: 'none',
    ...over,
  }
}

describe('Session row-action touch targets (a11y)', () => {
  it('pin action has min-h-11 min-w-11 for 44px touch target on mobile', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Floaty' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        pinnedIds={new Set()}
        onTogglePin={() => {}}
      />,
    )
    const pin = screen.getByRole('button', { name: 'Pin Floaty' })
    expect(pin.className).toContain('min-h-11')
    expect(pin.className).toContain('min-w-11')
  })

  it('delete action has min-h-11 min-w-11 for 44px touch target on mobile', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Trashable' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const del = screen.getByRole('button', { name: 'Delete Trashable' })
    expect(del.className).toContain('min-h-11')
    expect(del.className).toContain('min-w-11')
  })

  it('overflow (⋯) action has min-h-11 min-w-11 for 44px touch target on mobile', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'More one' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onViewTranscript={() => {}}
      />,
    )
    const overflow = screen.getByRole('button', { name: /More actions for More one/i })
    expect(overflow.className).toContain('min-h-11')
    expect(overflow.className).toContain('min-w-11')
  })
})

describe('History bulk-select touch targets (a11y)', () => {
  it('the "Select sessions" toggle has min-h-11 for a 44px touch target on mobile', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Pickable' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onBulkOps={{ onBulkArchive: vi.fn(), onBulkDelete: vi.fn(), onBulkExport: vi.fn() }}
      />,
    )
    const toggle = screen.getByRole('button', { name: /^select sessions$/i })
    expect(toggle.className).toContain('min-h-11')
  })

  it('the bulk bar "Select all" has min-h-11 for a 44px touch target on mobile', () => {
    render(
      <BulkSessionBar
        selectedCount={1}
        totalCount={3}
        allVisibleSelected={false}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onExport={() => {}}
      />,
    )
    const selectAll = screen.getByRole('button', { name: /select all visible sessions/i })
    expect(selectAll.className).toContain('min-h-11')
  })
})

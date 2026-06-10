import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Turn } from '@/state/chatStore'
import { VirtualMessageList } from './VirtualMessageList'

/**
 * VirtualMessageList windows a Turn[] so a long transcript never mounts the whole
 * DOM. Under jsdom the windowing engine is the deterministic stub aliased in by
 * vitest.config.ts (simulated 600px viewport over ~120px estimated rows), so the
 * mounted subset is bounded and the scroll behaviours are observable.
 */

function turns(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${i}`,
    role: 'user' as const,
    content: `message ${i}`,
  }))
}

function renderList(props?: Partial<Parameters<typeof VirtualMessageList>[0]>) {
  return render(
    <VirtualMessageList
      turns={props?.turns ?? turns(500)}
      renderTurn={(turn) => <div data-testid="row">{(turn as { content: string }).content}</div>}
      stickToBottom={props?.stickToBottom ?? true}
      ariaLabel="Conversation"
      {...props}
    />,
  )
}

describe('VirtualMessageList', () => {
  it('renders only a windowed SUBSET of a large list, not every row', () => {
    renderList({ turns: turns(500) })
    const rows = screen.getAllByTestId('row')
    // The window is a small fraction of 500 — the whole point of virtualization.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
  })

  it('exposes the scroll region as a labelled log for a11y', () => {
    renderList()
    const log = screen.getByRole('log', { name: /conversation/i })
    expect(log).toHaveAttribute('tabindex', '0')
  })

  it('keeps the list pinned to the bottom (newest visible) when stickToBottom is on', () => {
    renderList({ turns: turns(500), stickToBottom: true })
    const rows = screen.getAllByTestId('row')
    const texts = rows.map((r) => r.textContent)
    // The very last message is mounted; an early one is NOT (it is windowed out).
    expect(texts).toContain('message 499')
    expect(texts).not.toContain('message 0')
  })

  it('renders a footer slot (e.g. approval / bottom anchor) after the windowed rows', () => {
    renderList({
      turns: turns(500),
      footer: <div data-testid="list-footer">footer</div>,
    })
    expect(screen.getByTestId('list-footer')).toBeInTheDocument()
  })
})

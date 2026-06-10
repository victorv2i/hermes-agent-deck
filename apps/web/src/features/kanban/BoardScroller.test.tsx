import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BoardScroller } from './BoardScroller'

/** Give the jsdom scroller real-looking scroll metrics (jsdom lays nothing out). */
function setMetrics(el: HTMLElement, { scrollWidth = 0, clientWidth = 0, scrollLeft = 0 }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  el.scrollLeft = scrollLeft
}

describe('BoardScroller', () => {
  it('shows no edge fades when the lane does not overflow', () => {
    render(
      <BoardScroller>
        <div>lane</div>
      </BoardScroller>,
    )
    expect(screen.queryByTestId('kanban-board-fade-start')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-fade-end')).not.toBeInTheDocument()
  })

  it('carries the always-visible thin scrollbar styling on the scroller', () => {
    render(
      <BoardScroller>
        <div>lane</div>
      </BoardScroller>,
    )
    const scroller = screen.getByTestId('kanban-board-scroller')
    expect(scroller.className).toContain('overflow-auto')
    expect(scroller.className).toContain('[scrollbar-width:thin]')
    expect(scroller.className).toContain('scrollbar-color')
    expect(scroller.className).toContain('-webkit-scrollbar-thumb')
  })

  it('shows only the right fade at rest, both mid-scroll, only the left at the end', () => {
    render(
      <BoardScroller>
        <div>lane</div>
      </BoardScroller>,
    )
    const scroller = screen.getByTestId('kanban-board-scroller')

    // At rest with a 1200px hidden overflow → more content to the right only.
    setMetrics(scroller, { scrollWidth: 2300, clientWidth: 1100, scrollLeft: 0 })
    fireEvent.scroll(scroller)
    expect(screen.queryByTestId('kanban-board-fade-start')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-fade-end')).toBeInTheDocument()

    // Mid-scroll → content remains on both sides.
    setMetrics(scroller, { scrollWidth: 2300, clientWidth: 1100, scrollLeft: 600 })
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('kanban-board-fade-start')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-fade-end')).toBeInTheDocument()

    // Scrolled to the far end → only the left fade remains.
    setMetrics(scroller, { scrollWidth: 2300, clientWidth: 1100, scrollLeft: 1200 })
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('kanban-board-fade-start')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-fade-end')).not.toBeInTheDocument()
  })

  it('keeps the fades pointer-inert and decorative (no semantics)', () => {
    render(
      <BoardScroller>
        <div>lane</div>
      </BoardScroller>,
    )
    const scroller = screen.getByTestId('kanban-board-scroller')
    setMetrics(scroller, { scrollWidth: 2300, clientWidth: 1100, scrollLeft: 600 })
    fireEvent.scroll(scroller)
    for (const id of ['kanban-board-fade-start', 'kanban-board-fade-end']) {
      const fade = screen.getByTestId(id)
      expect(fade).toHaveAttribute('aria-hidden')
      expect(fade.className).toContain('pointer-events-none')
    }
  })
})

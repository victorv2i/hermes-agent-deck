/**
 * BoardScroller — the board surface's scroll container with an HONEST resting
 * affordance for its wide column lane. A bare `overflow-auto` hides a >1000px
 * horizontal overflow with zero hint (the lane just looks cut off / broken), so
 * this adds two cues, used by both the in-flow board and the expanded overlay:
 *
 *  1. A slightly stronger always-there thin horizontal scrollbar — the same
 *     quiet pattern index.css applies globally (thin, rounded, foreground
 *     color-mix thumb), bumped a notch so it reads at rest.
 *  2. Edge fade hints: a right-edge fade while more columns remain off-screen,
 *     and a left-edge fade once scrolled — each rendered only when true, so a
 *     fully-visible board shows no fades at all. The fades are pointer-inert
 *     and aria-hidden (pure affordance, no semantics).
 *
 * `scroll-padding` keeps keyboard/focus-driven scrolls from parking a column
 * header flush against the clipped edge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export function BoardScroller({ children }: { children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  // start=true → at the far left (no left fade); end=true → no more content to
  // the right (no right fade). Both true until measured, so jsdom / a
  // non-overflowing board honestly shows no fades.
  const [edges, setEdges] = useState({ start: true, end: true })

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft <= 1
    const end = el.scrollLeft >= maxScroll - 1
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  // Re-measure on every commit (columns load async) and on real size changes.
  useEffect(updateEdges)
  // Re-wire the observer whenever `children` changes: the first child element
  // can be swapped across renders, and observing only the mount-time node would
  // leave the observer holding a detached element (size changes then go unseen).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [updateEdges, children])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        data-testid="kanban-board-scroller"
        className={cn(
          'h-full overflow-auto px-6 py-5 [scroll-padding-inline:1.5rem]',
          // The global index.css scrollbar pattern, a notch stronger so the
          // horizontal thumb is a visible resting affordance, not hover-only.
          '[scrollbar-width:thin]',
          '[scrollbar-color:color-mix(in_oklch,var(--foreground)_28%,transparent)_transparent]',
          '[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_oklch,var(--foreground)_28%,transparent)]',
          '[&::-webkit-scrollbar-thumb:hover]:bg-[color-mix(in_oklch,var(--foreground)_38%,transparent)]',
        )}
      >
        {children}
      </div>
      {!edges.start ? (
        <div
          aria-hidden
          data-testid="kanban-board-fade-start"
          className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent"
        />
      ) : null}
      {!edges.end ? (
        <div
          aria-hidden
          data-testid="kanban-board-fade-end"
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent"
        />
      ) : null}
    </div>
  )
}

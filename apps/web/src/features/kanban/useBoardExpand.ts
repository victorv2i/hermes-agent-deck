/**
 * Board EXPAND state — the fullscreen toggle for the Kanban surface. The board is
 * a wide, multi-column tool; on a narrow content area you can't see every lane at
 * once, so this hook drives a full-viewport overlay that breaks the board out of
 * the shell's center column.
 *
 * Responsibilities (kept tiny + testable, pure state + two effects):
 *  - `expanded` + `toggle` / `collapse` — the open state.
 *  - Esc collapses when expanded (capture phase so it preempts other Esc handlers
 *    only while we're actually open — registered conditionally).
 *  - Body scroll lock while expanded (restored on collapse AND on unmount), so the
 *    page behind the overlay can't scroll.
 *
 * It does NOT own focus-trap or the overlay markup — the overlay component
 * ({@link KanbanExpandedShell}) wraps the board in a radix Dialog for trap + ARIA.
 */
import { useCallback, useEffect, useState } from 'react'

export interface BoardExpand {
  expanded: boolean
  toggle: () => void
  collapse: () => void
}

export function useBoardExpand(): BoardExpand {
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback(() => setExpanded((e) => !e), [])
  const collapse = useCallback(() => setExpanded(false), [])

  // Esc collapses, but only while expanded (so we don't shadow other Esc handlers
  // when the board is in its normal in-flow state). Capture phase + stopPropagation
  // so a press meant to leave fullscreen doesn't also bubble to a parent handler.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded])

  // Lock the page scroll behind the overlay; always restore on collapse/unmount.
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  return { expanded, toggle, collapse }
}

/**
 * Test-only stub for `@tanstack/react-virtual`, aliased in by `vitest.config.ts`.
 *
 * jsdom gives every element a height of 0 and never lays out, so the real
 * virtualizer would render either everything or nothing — neither lets us assert
 * the windowing CONTRACT. This stub reproduces just that contract deterministically:
 * it windows the item range against a simulated viewport (a fixed virtual height
 * over a fixed estimated row size, plus overscan), exposes `getVirtualItems()` /
 * `getTotalSize()` / `measureElement` / `scrollToIndex`, and re-derives the window
 * from the live scroll offset of the scroll element so a scrolled-to-bottom list
 * shows the TAIL. Production builds use the real package (vite.config.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

export interface VirtualItem {
  index: number
  key: string | number
  start: number
  size: number
  end: number
}

interface UseVirtualizerOptions {
  count: number
  getScrollElement: () => HTMLElement | null
  estimateSize: (index: number) => number
  overscan?: number
  getItemKey?: (index: number) => string | number
}

/** Simulated viewport height for the stubbed window (jsdom reports 0). */
const SIM_VIEWPORT = 600

export function useVirtualizer(options: UseVirtualizerOptions) {
  const { count, getScrollElement, estimateSize, overscan = 4, getItemKey } = options
  // Re-render hook so scroll handlers can recompute the window.
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sizes = useMemo(() => {
    const arr: number[] = new Array(count)
    for (let i = 0; i < count; i++) arr[i] = estimateSize(i)
    return arr
  }, [count, estimateSize])

  const offsets = useMemo(() => {
    const arr: number[] = new Array(count + 1)
    arr[0] = 0
    for (let i = 0; i < count; i++) arr[i + 1] = (arr[i] ?? 0) + (sizes[i] ?? 0)
    return arr
  }, [sizes, count])

  const at = (i: number): number => offsets[i] ?? 0

  const totalSize = at(count)

  const el = getScrollElement()
  const scrollTop = el ? el.scrollTop : Math.max(0, totalSize - SIM_VIEWPORT)
  const viewport = el && el.clientHeight ? el.clientHeight : SIM_VIEWPORT

  // Binary-ish linear scan for the first/last visible index in the simulated viewport.
  let firstVisible = 0
  while (firstVisible < count && at(firstVisible + 1) <= scrollTop) firstVisible++
  let lastVisible = firstVisible
  while (lastVisible < count - 1 && at(lastVisible) < scrollTop + viewport) lastVisible++

  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(count - 1, lastVisible + overscan)

  const items: VirtualItem[] = []
  if (count > 0) {
    for (let i = start; i <= end; i++) {
      items.push({
        index: i,
        key: getItemKey ? getItemKey(i) : i,
        start: at(i),
        size: sizes[i] ?? 0,
        end: at(i + 1),
      })
    }
  }

  // Recompute the window whenever the scroll element scrolls (re-derives the
  // visible range from the live scrollTop). Re-attaches if the element changes.
  useEffect(() => {
    if (!el) return
    el.addEventListener('scroll', rerender, { passive: true })
    return () => el.removeEventListener('scroll', rerender)
  }, [el, rerender])

  return {
    getVirtualItems: () => items,
    getTotalSize: () => totalSize,
    measureElement: () => {
      // jsdom can't measure; the estimate stands. A no-op keeps the ref callback safe.
    },
    scrollToIndex: (index: number) => {
      const target = getScrollElement()
      if (target) target.scrollTop = at(Math.min(Math.max(index, 0), count))
    },
    scrollToOffset: (offset: number) => {
      const target = getScrollElement()
      if (target) target.scrollTop = offset
    },
  }
}

export type Virtualizer = ReturnType<typeof useVirtualizer>

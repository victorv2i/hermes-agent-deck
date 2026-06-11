import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Turn } from '@/state/chatStore'
import { cn } from '@/lib/utils'

/**
 * The single windowing primitive for both chat surfaces — the live ChatView log
 * and the persisted SessionHistory transcript. It mounts only the visible slice
 * of `turns` (plus a small overscan) via `@tanstack/react-virtual`, so a 10k-turn
 * session keeps a handful of rows in the DOM instead of all of them: that is the
 * fix for the long-session jank/OOM gap. Virtualization is invisible to the user —
 * streaming auto-scroll/stick-to-bottom, jump-to-latest (driven by the parent via
 * the returned scroll element), variable-height rows (measured), and a11y (a
 * labelled `role="log"`) all behave exactly as before.
 *
 * Variable heights: rows are MEASURED (`measureElement`) rather than assumed, so
 * a tall tool/markdown turn and a one-line user turn both place correctly.
 *
 * Both callers pass the FULL transcript: the confirmed hermes dashboard build's
 * `GET /messages` returns the whole transcript in one response (no
 * cursor/offset/limit), so there is no backend page to fetch — virtualization
 * alone keeps even a fully-loaded long transcript off the DOM.
 */

export interface VirtualMessageListProps {
  /** The full ordered turn list to render (windowed internally). */
  turns: Turn[]
  /** Render one turn's row content (Message, etc.). */
  renderTurn: (turn: Turn, index: number) => ReactNode
  /** Accessible name for the scroll region (role="log"). */
  ariaLabel: string
  /** Keep the viewport pinned to the newest row while it changes (live stream). */
  stickToBottom?: boolean
  /** Estimated row height (px) before measurement. Tunes the first paint. */
  estimateSize?: number
  /** Trailing content rendered after the windowed rows (approval, error, anchor). */
  footer?: ReactNode
  /** Extra classes for the scroll container. */
  className?: string
  /** Inner content max-width wrapper classes (matches the 720px column). */
  innerClassName?: string
  /** Notified when the user's pinned-to-bottom state changes (drives jump-to-latest). */
  onAtBottomChange?: (atBottom: boolean) => void
  /** Imperative scroll element handle for the parent (jump-to-latest, focus). */
  scrollRef?: (el: HTMLDivElement | null) => void
}

const DEFAULT_ESTIMATE = 120
const BOTTOM_THRESHOLD = 80

/** The subset of `@tanstack/react-virtual`'s VirtualItem this component reads —
 * declared locally so the row map stays soundly typed regardless of the module's
 * own type surface. */
interface VirtualRow {
  index: number
  key: string | number
  start: number
}

export function VirtualMessageList({
  turns,
  renderTurn,
  ariaLabel,
  stickToBottom = false,
  estimateSize = DEFAULT_ESTIMATE,
  footer,
  className,
  innerClassName,
  onAtBottomChange,
  scrollRef,
}: VirtualMessageListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const setParent = useCallback(
    (el: HTMLDivElement | null) => {
      parentRef.current = el
      scrollRef?.(el)
    },
    [scrollRef],
  )

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 6,
    getItemKey: (index: number) => turns[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems() as VirtualRow[]
  const totalSize = virtualizer.getTotalSize()

  // --- stick-to-bottom -------------------------------------------------------
  const [atBottom, setAtBottom] = useState(stickToBottom)
  const atBottomRef = useRef(atBottom)
  atBottomRef.current = atBottom

  const reportAtBottom = useCallback(
    (next: boolean) => {
      // Notify the parent OUTSIDE the state updater. React may replay updaters
      // during a later render pass, and a parent setState inside one fires the
      // "cannot update a component while rendering a different component"
      // error (ChatView updated while VirtualMessageList renders). The ref
      // mirrors the committed state, so the change check stays accurate here.
      if (atBottomRef.current !== next) {
        atBottomRef.current = next
        onAtBottomChange?.(next)
      }
      setAtBottom(next)
    },
    [onAtBottomChange],
  )

  // Pin to the newest content while the user is at the bottom (live streaming).
  const tail = lastTurnSignature(turns)
  useLayoutEffect(() => {
    if (stickToBottom && atBottomRef.current && turns.length > 0) {
      virtualizer.scrollToIndex(turns.length - 1, { align: 'end' })
    }
    // Re-pin whenever the tail content or count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail, turns.length, stickToBottom])

  const onScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    reportAtBottom(distanceFromBottom < BOTTOM_THRESHOLD)
  }, [reportAtBottom])

  // Expose a programmatic jump-to-latest via the scroll element + this effect's
  // re-pin; parents call scrollToBottom through the returned scrollRef element.
  useEffect(() => {
    if (stickToBottom && turns.length > 0 && atBottomRef.current) {
      virtualizer.scrollToIndex(turns.length - 1, { align: 'end' })
    }
    // Mount-only initial pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={setParent}
      onScroll={onScroll}
      role="log"
      aria-label={ariaLabel}
      aria-live="off"
      tabIndex={0}
      data-testid="message-list"
      className={cn(
        'min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset',
        className,
      )}
    >
      <div className={cn('mx-auto w-full max-w-[720px]', innerClassName)}>
        {/* The spacer carries the full virtual height; rows are absolutely placed
            at their measured offset so only the window mounts. */}
        <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
          {virtualItems.map((item: VirtualRow) => {
            const turn = turns[item.index]
            if (!turn) return null
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {renderTurn(turn, item.index)}
              </div>
            )
          })}
        </div>

        {footer}
      </div>
    </div>
  )
}

/**
 * A cheap signature of the tail turn's growth, so the stick-to-bottom effect
 * re-pins on streaming token-appends (content/tool/reasoning length) as well as
 * on a new turn — mirroring the previous ChatView heuristic.
 */
function lastTurnSignature(turns: Turn[]): number {
  const last = turns[turns.length - 1]
  if (!last) return 0
  if (last.role === 'assistant') {
    return last.content.length + last.toolCalls.length + last.reasoning.length
  }
  return turns.length
}

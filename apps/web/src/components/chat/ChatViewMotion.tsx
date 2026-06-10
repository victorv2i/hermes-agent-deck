import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown } from 'lucide-react'

/**
 * The animated bit of {@link ChatView} — the only framer-motion user in the chat
 * surface. This module is `React.lazy`-loaded by ChatView so framer-motion ships
 * in a deferred chunk (off the eager entry path) instead of `index.js`. Until it
 * loads, ChatView's Suspense fallback renders the same control without animation,
 * so the surface is correct and interactive immediately.
 *
 * `reduce` (prefers-reduced-motion) is threaded in so the no-motion variants
 * match the prior inline behavior exactly.
 *
 * (The per-row `MessageEnter` slide-in was retired when the conversation log was
 * virtualized: animating measured, absolutely-positioned virtual rows fights the
 * height measurement and thrashes layout. The windowed log renders rows directly.)
 */

export interface JumpToLatestProps {
  show: boolean
  reduce: boolean
  onClick: () => void
}

/** Presence-animated "jump to latest" pill (fade + slide, exit-animated). */
export function JumpToLatest({ show, reduce, onClick }: JumpToLatestProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          onClick={onClick}
          data-testid="jump-to-latest"
          aria-label="Jump to latest"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute -top-12 left-1/2 z-20 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground shadow-lg transition-colors hover:text-foreground focus-visible:ad-focus sm:min-h-0 sm:px-3 sm:py-1.5"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Jump to latest
        </motion.button>
      )}
    </AnimatePresence>
  )
}

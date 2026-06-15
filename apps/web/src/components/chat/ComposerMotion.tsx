import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Square } from 'lucide-react'

/**
 * The composer's animated Send to Stop morph, the only framer-motion user in the
 * composer. Lazy-loaded by {@link Composer} so framer-motion ships in a DEFERRED
 * chunk (off the eager entry path that the non-lazy ChatRoute pulls in) instead
 * of the entry bundle. Until it loads, Composer's Suspense fallback renders the
 * same button without animation, so the primary send control is interactive
 * immediately.
 *
 * `reduce` (prefers-reduced-motion) is passed in as a prop so the no-motion
 * variants match the prior inline behavior exactly, and the media-query hook
 * stays in the eager Composer (this chunk imports no app hooks).
 */
export interface SendStopButtonProps {
  running: boolean
  canSend: boolean
  onSend: () => void
  onStop: () => void
  reduce: boolean
}

export function SendStopButton({ running, canSend, onSend, onStop, reduce }: SendStopButtonProps) {
  const duration = reduce ? 0 : 0.12

  return (
    <AnimatePresence mode="wait" initial={false}>
      {running ? (
        <motion.button
          key="stop"
          type="button"
          onClick={onStop}
          aria-label="Stop"
          data-testid="composer-stop"
          initial={reduce ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
          transition={{ duration, ease: 'easeOut' }}
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground transition-[transform,background-color] hover:bg-foreground/15 focus-visible:ad-focus active:scale-95 sm:size-10"
        >
          <Square className="size-3.5 fill-current" aria-hidden />
        </motion.button>
      ) : (
        <motion.button
          key="send"
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send"
          data-testid="composer-send"
          initial={reduce ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
          transition={{ duration, ease: 'easeOut' }}
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-[transform,background-color] hover:bg-primary-hover focus-visible:ad-focus active:scale-95 disabled:cursor-not-allowed disabled:bg-primary/15 disabled:text-primary/60 disabled:opacity-100 sm:size-10"
        >
          <ArrowUp className="size-4" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

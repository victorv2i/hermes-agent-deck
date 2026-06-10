import { Monitor, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ThemeMode } from './theme-context'

/**
 * The animated half of {@link ThemeToggle}: a crossfade/rotate swap between the
 * mode glyphs (Sun / Moon / Monitor) as the cycle moves light → dark → system.
 * This module is the ONLY consumer of framer-motion in the theme toggle, and it
 * is `React.lazy`-loaded by `ThemeToggle.tsx` so the library ships in a deferred
 * chunk (off the eager entry path) rather than in `index.js`. Until it loads —
 * and for `prefers-reduced-motion` users — the wrapper shows the static current
 * icon, so the control is correct immediately.
 */
export default function ThemeToggleIcon({ mode }: { mode: ThemeMode }) {
  const reduce = useReducedMotion()
  const Icon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={mode}
        initial={reduce ? false : { opacity: 0, rotate: -45, scale: 0.7 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, rotate: 45, scale: 0.7 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="grid place-items-center"
      >
        <Icon className="size-4" />
      </motion.span>
    </AnimatePresence>
  )
}

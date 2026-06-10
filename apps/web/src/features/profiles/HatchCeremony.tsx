import { useEffect, useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { AvatarId } from '@agent-deck/protocol'
import { Avatar } from '@/components/ui/avatar'

/**
 * HatchCeremony — the birth moment made visible. When a new agent is hatched, a
 * brief particle burst blooms around its face and "{name} has hatched" is
 * announced, then `onDone` fires (the dialog navigates to the new agent's hub).
 *
 * This is the ONE place a celebratory >300ms motion is intentional (the design
 * spine's ≤300ms rule governs UI transitions, not a one-time ceremony). It stays
 * honest + accessible:
 *  - `role="status"`/`aria-live` announces the birth to screen readers.
 *  - `prefers-reduced-motion`: no particles or scale-in, just the face + line,
 *    held briefly. Still fully announced; still auto-dismisses.
 *  - The whole overlay is click/Escape dismissible (never traps; never blocks).
 *  - Plain scrim (no backdrop-blur — glassmorphism is banned by the spine).
 *  - The burst uses `--primary`: the single live/active spark, not decoration.
 */

const PARTICLE_COUNT = 22
// Hold long enough for the ~1.1s particle burst + ring to fully settle before the
// dialog auto-advances — 1600ms cut it off mid-bloom, so the ceremony never got to
// breathe. Reduced-motion skips the burst entirely, so it can dismiss much sooner.
const HOLD_MS = 2400
const HOLD_MS_REDUCED = 900

export interface HatchCeremonyProps {
  name: string
  avatar: AvatarId
  onDone: () => void
}

export function HatchCeremony({ name, avatar, onDone }: HatchCeremonyProps) {
  const reduced = useReducedMotion()
  const titleId = useId()

  // Auto-dismiss after the hold (shorter when motion is reduced).
  useEffect(() => {
    const t = setTimeout(onDone, reduced ? HOLD_MS_REDUCED : HOLD_MS)
    return () => clearTimeout(t)
  }, [onDone, reduced])

  // Escape dismisses early (parity with click).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  // Particles fan out at even angles — deterministic (no per-render randomness),
  // so the burst is stable and test-friendly.
  const particles = reduced
    ? []
    : Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2
        const distance = 116 + (i % 3) * 28
        return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, i }
      })

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-background/85"
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      onClick={onDone}
    >
      <div className="relative grid place-items-center">
        {particles.map((p) => (
          <motion.span
            key={p.i}
            className="absolute size-1.5 rounded-full bg-primary"
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
            transition={{ duration: 1.1, ease: 'easeOut', delay: 0.04 }}
            aria-hidden
          />
        ))}

        {!reduced && (
          <motion.span
            className="absolute rounded-full border border-primary/40"
            initial={{ width: 64, height: 64, opacity: 0.7 }}
            animate={{ width: 248, height: 248, opacity: 0 }}
            transition={{ duration: 1.0, ease: 'easeOut' }}
            aria-hidden
          />
        )}

        <motion.div
          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative z-10 grid place-items-center gap-3"
        >
          <Avatar avatarId={avatar} name={name} size={56} />
          <p id={titleId} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {name} has hatched
          </p>
        </motion.div>
      </div>
    </div>
  )
}

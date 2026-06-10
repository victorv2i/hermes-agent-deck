import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * The animated chrome of {@link AppShell} — the only framer-motion users in the
 * shell. This module is `React.lazy`-loaded by AppShell so framer-motion ships
 * in a deferred chunk (off the eager entry path) rather than in `index.js`.
 *
 * Each animated piece has a structurally-identical, un-animated Suspense
 * fallback in AppShell rendered at the TARGET geometry, so the shell lays out
 * correctly on first paint and the springs simply smooth subsequent toggles
 * once the chunk lands. `reduce` (prefers-reduced-motion) is threaded in so the
 * no-motion behavior matches the prior inline code.
 */

const RAIL_WIDTH = 260

type Spring = { duration: number } | { type: 'spring'; stiffness: number; damping: number }

function railSpring(reduce: boolean): Spring {
  return reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }
}

/** Dismiss backdrop for the mobile slide-over (fade in/out). */
export function MobileBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.button
          type="button"
          data-testid="mobile-rail-backdrop"
          aria-label="Close menu"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-0 z-30 bg-black/55"
        />
      )}
    </AnimatePresence>
  )
}

/** The off-canvas mobile rail: slides in/out along x. */
export function MobileRailNav({
  open,
  reduce,
  children,
}: {
  open: boolean
  reduce: boolean
  children: ReactNode
}) {
  return (
    <motion.nav
      aria-label="Sidebar"
      aria-modal={open ? true : undefined}
      aria-hidden={open ? undefined : true}
      data-mobile-open={open}
      inert={open ? undefined : true}
      // Start offscreen so the slide-in plays even when this (lazy) component
      // first mounts already-open — i.e. the motion chunk resolved AFTER the
      // open click. Mounting with `initial={false}` would snap it to x:0 with no
      // animation window, momentarily overlaying the dismiss backdrop. Animating
      // from the closed x reproduces the eager behavior (rail slides in; backdrop
      // stays clickable during the transition). Reduced-motion skips the slide.
      initial={reduce ? false : { x: -(RAIL_WIDTH + 8) }}
      animate={{ x: open ? 0 : -(RAIL_WIDTH + 8) }}
      transition={railSpring(reduce)}
      style={{ width: RAIL_WIDTH }}
      className="fixed inset-y-0 left-0 z-40 border-r border-border bg-sidebar shadow-2xl shadow-black/40"
    >
      {children}
    </motion.nav>
  )
}

/** The desktop rail: animates its width between 0 (collapsed) and RAIL_WIDTH. */
export function DesktopRailNav({
  collapsed,
  reduce,
  children,
}: {
  collapsed: boolean
  reduce: boolean
  children: ReactNode
}) {
  return (
    <motion.nav
      aria-label="Sidebar"
      data-collapsed={collapsed}
      aria-hidden={collapsed ? true : undefined}
      inert={collapsed ? true : undefined}
      initial={false}
      animate={{ width: collapsed ? 0 : RAIL_WIDTH }}
      transition={railSpring(reduce)}
      className="relative z-10 shrink-0 overflow-hidden border-r border-border bg-sidebar"
    >
      <div style={{ width: RAIL_WIDTH } satisfies CSSProperties} className="h-full">
        {children}
      </div>
    </motion.nav>
  )
}

const PREVIEW_WIDTH = 480

/** Dismiss backdrop for the right Preview panel (fade in/out, modal mode only). */
export function PreviewBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.button
          type="button"
          data-testid="preview-backdrop"
          aria-label="Close preview"
          tabIndex={-1}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-0 z-40 bg-black/40"
        />
      )}
    </AnimatePresence>
  )
}

/**
 * The right PREVIEW panel (#116) — an iframe browser docked beside the
 * conversation. Same two-morphology pattern as {@link ActivityDrawer}: a docked
 * in-flow column at the wide cockpit (animates width), a fixed slide-over below
 * it (animates x, paired with a scrim + focus-trap in AppShell). One mounted
 * element across toggles so the iframe doesn't reload when you hide/show it.
 * Closed panels are inert (aria-hidden + pointer-events-none). Reduced-motion
 * snaps in both modes.
 */
export function PreviewDrawer({
  open,
  reduce,
  docked = false,
  children,
}: {
  open: boolean
  reduce: boolean
  docked?: boolean
  children: ReactNode
}) {
  if (docked) {
    return (
      <motion.aside
        aria-label="Preview"
        data-testid="preview-drawer"
        data-open={open}
        data-docked
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        initial={false}
        animate={{ width: open ? PREVIEW_WIDTH : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
        className="relative z-[5] shrink-0 overflow-hidden border-l border-border bg-surface-1 data-[open=false]:pointer-events-none"
      >
        <div style={{ width: PREVIEW_WIDTH } satisfies CSSProperties} className="h-full">
          {children}
        </div>
      </motion.aside>
    )
  }
  return (
    <motion.aside
      aria-label="Preview"
      data-testid="preview-drawer"
      data-open={open}
      data-docked={false}
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      initial={false}
      animate={{ x: open ? 0 : PREVIEW_WIDTH + 16 }}
      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
      style={{ width: PREVIEW_WIDTH }}
      className="fixed inset-y-0 right-0 z-50 max-w-[92vw] border-l border-border bg-surface-1 shadow-2xl shadow-black/40 data-[open=false]:pointer-events-none"
    >
      {children}
    </motion.aside>
  )
}

/** The header wordmark, shown when the rail isn't (collapsed/mobile): fade + slide. */
export function HeaderWordmark({
  show,
  reduce,
  children,
}: {
  show: boolean
  reduce: boolean
  children: ReactNode
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="header-wordmark"
          initial={reduce ? false : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: -6 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

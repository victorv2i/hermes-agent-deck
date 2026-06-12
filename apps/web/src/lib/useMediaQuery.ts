import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * SSR/test-safe: defaults to `false` when matchMedia is unavailable, and reads
 * the live value synchronously on mount. Used to drive the responsive AppShell
 * (the left rail becomes a slide-over drawer under the mobile breakpoint).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** The app's mobile breakpoint: below the design-language ~768px three-zone cutover. */
export const MOBILE_QUERY = '(max-width: 767px)'

/**
 * The width gate for the split-rail's dedicated SESSIONS PANE. The pane (the
 * second column on Chat/Sessions) only MOUNTS at/above this width — below it,
 * the split rail degrades to the icon-nav alone so a narrow desktop/tablet
 * viewport isn't crushed by three columns. The mobile slide-over (which carries
 * the full labeled rail + session list) covers everything under MOBILE_QUERY.
 */
export const SESSIONS_PANE_QUERY = '(min-width: 1024px)'

/**
 * The WIDE breakpoint where the right Activity drawer becomes a true live
 * COCKPIT: at/above this width it DOCKS as a static in-flow third column beside
 * the conversation (no scrim, no focus-trap, no aria-modal) so the operator can
 * watch tools/approvals stream WHILE typing. Below it, the drawer stays a
 * modal-with-scrim slide-over (dim + focus-trap) — the right call on a phone or
 * narrow window where a third column wouldn't fit. Also gates the first-run
 * Activity auto-open so a narrow viewport never auto-reveals an empty panel as
 * the first screen.
 */
export const WIDE_QUERY = '(min-width: 1280px)'

/** Whether this device takes touch input: a coarse primary pointer OR any touch
 * points. Evaluated in JS (not a CSS gate) so callers can branch render logic. */
function computeTouchInput(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false
  const touchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  return coarse || touchPoints
}

/**
 * `true` on devices that take TOUCH input: a coarse primary pointer (phones,
 * tablets) OR any reported touch points (hybrid laptops). Re-evaluated when the
 * pointer media query flips and on resize/orientation change (e.g. a
 * convertible switching modes, a tab moved between screens). Drives the
 * terminal's touch key bar, which a CSS-only coarse-pointer gate misses on
 * touch-capable hybrids whose primary pointer is fine.
 */
export function useTouchInput(): boolean {
  const [touch, setTouch] = useState(computeTouchInput)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setTouch(computeTouchInput())
    const mql = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null
    mql?.addEventListener('change', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    update()
    return () => {
      mql?.removeEventListener('change', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return touch
}

/**
 * `true` when the user prefers reduced motion. A framer-motion-free replacement
 * for its `useReducedMotion` hook, so the eager shell/chat surfaces can branch
 * on the setting WITHOUT statically importing framer-motion (which would pin the
 * library to the entry chunk). Same semantics: tracks `(prefers-reduced-motion:
 * reduce)` live, defaults to `false` when matchMedia is unavailable.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

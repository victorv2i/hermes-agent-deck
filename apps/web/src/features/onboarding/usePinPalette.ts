/**
 * `usePinPalette` — pin a palette to the DOM for the lifetime of the wizard,
 * then restore the user's SAVED palette on exit, WITHOUT ever persisting the pin.
 *
 * The onboarding wizard shows the owner's default look (Clay & Sky) regardless of
 * whatever palette a returning user has saved — but it must never CLOBBER that
 * saved choice. So this hook:
 *   - captures the saved palette ONCE at mount,
 *   - `applyPalette(pinned)` (DOM only — `setPalette` would persist + clobber),
 *   - on unmount `applyPalette(saved)` to restore the owner's exact look.
 *
 * Persistence is untouched throughout: `localStorage`/the palette store still
 * hold the user's real choice, so after the wizard the rest of the app keeps it.
 */
import { useEffect, useRef } from 'react'
import { applyPalette, getPalette, type Palette } from '@/features/themes/palette'

/** Pin `pinned` to the DOM for this component's lifetime; restore on unmount. */
export function usePinPalette(pinned: Palette): void {
  // Capture the saved palette ONCE (a re-render must not lose it to the pin).
  const savedRef = useRef<Palette | null>(null)
  if (savedRef.current === null) savedRef.current = getPalette()

  useEffect(() => {
    const saved = savedRef.current ?? pinned
    applyPalette(pinned)
    return () => {
      // Restore the owner's saved look exactly — never leave the pinned palette.
      applyPalette(saved)
    }
    // The pin is fixed for the wizard's lifetime; restore is keyed off the
    // mount-time capture, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

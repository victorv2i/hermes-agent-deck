import { useEffect, useState } from 'react'

/**
 * The number of CSS px at the BOTTOM of the layout viewport currently hidden by
 * the on-screen keyboard (0 when no keyboard / on desktop).
 *
 * iOS Safari never resizes the layout viewport for the keyboard — it only
 * shrinks (and pans) the VISUAL viewport — so a bottom-anchored surface like the
 * terminal ends up typing under the keyboard. Consumers pad their bottom by this
 * inset so the interactive line stays visible. On browsers that DO resize the
 * layout viewport (Android Chrome with `interactive-widget=resizes-content`),
 * the visual and layout viewports agree and this stays 0 — no double inset.
 */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return

    const update = () => {
      // The visual viewport shows [offsetTop, offsetTop + height) of the layout
      // viewport; anything below that is behind the keyboard (or panned away).
      const hidden = window.innerHeight - vv.height - vv.offsetTop
      // Ignore sub-pixel noise and small browser-chrome shifts; a real keyboard
      // is far taller than 50px.
      setInset(hidden > 50 ? Math.round(hidden) : 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

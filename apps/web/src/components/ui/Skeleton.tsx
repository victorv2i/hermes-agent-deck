import { cn } from '@/lib/utils'

/**
 * The reusable loading-skeleton primitive — a neutral block with a calm,
 * left-to-right SHIMMER instead of the old whole-block opacity pulse. The
 * shimmer reads as "content is arriving" (a sweep of light moving across the
 * placeholder) which feels more crafted than a flashing rectangle, while
 * staying strictly neutral: the sweep is a faint foreground tint over `bg-muted`
 * — NEVER the `--primary` accent (design spine: decoration is neutral).
 *
 * Reduced-motion safe: the keyframe animation is gated to
 * `prefers-reduced-motion: no-preference`, so a reduced-motion user sees a
 * static muted block (no sweep, no pulse) — honest and still clearly a
 * placeholder.
 *
 * The treatment ships as a scoped `<style>` injected once (below), so this
 * component is self-contained and does NOT touch the shared `index.css`.
 */

const SHIMMER_STYLE_ID = 'ad-skeleton-shimmer-style'

/** The scoped shimmer CSS, injected exactly once into <head>. Token-driven
 * (color-mix off --foreground) so it reads in every theme + light/dark, and
 * gated behind no-preference so reduced-motion gets a static block. */
const SHIMMER_CSS = `
.ad-skeleton-shimmer {
  position: relative;
  overflow: hidden;
  background-color: var(--muted);
}
.ad-skeleton-shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklch, var(--foreground) 8%, transparent) 50%,
    transparent 100%
  );
}
@media (prefers-reduced-motion: no-preference) {
  .ad-skeleton-shimmer::after {
    animation: ad-skeleton-shimmer 1.6s ease-in-out infinite;
  }
}
@keyframes ad-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}
`

/** Inject the scoped shimmer style once. Idempotent (id-guarded) and SSR-safe
 * (no-ops without a document). Module-level so the first <Skeleton> paints with
 * the treatment already present. */
function ensureShimmerStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(SHIMMER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SHIMMER_STYLE_ID
  style.textContent = SHIMMER_CSS
  document.head.appendChild(style)
}

ensureShimmerStyle()

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render as a circle (e.g. an avatar placeholder). */
  circle?: boolean
}

/**
 * A single shimmering placeholder block. Compose width/height/shape via
 * className (e.g. `h-4 w-32`); `circle` adds `rounded-full`. Defaults to a
 * `rounded` rectangle. Decorative by nature — marked `aria-hidden` so the
 * shimmer isn't announced; the surrounding container owns the `aria-busy` /
 * "Loading…" semantics.
 */
export function Skeleton({ circle = false, className, ...rest }: SkeletonProps) {
  // Defensive: ensure the style exists even if the module-level call was
  // tree-shaken away in some bundling edge case.
  ensureShimmerStyle()
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={cn('ad-skeleton-shimmer', circle ? 'rounded-full' : 'rounded', className)}
    />
  )
}

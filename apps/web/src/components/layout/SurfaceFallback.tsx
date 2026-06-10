/**
 * Suspense fallback shown while a route-level code-split surface chunk loads on
 * first navigation. Calm shimmer skeletons (never a spinner-of-doom) per design
 * language §8 — a faint header bar plus a few placeholder rows, centered in the
 * content column so the transition reads as "loading", not "broken". Marked
 * aria-hidden + role=status with an SR-only label so assistive tech announces a
 * load without reading the decorative bars.
 */
export function SurfaceFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-10"
    >
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="flex flex-col gap-6">
        {/* Header tile + title */}
        <div className="flex items-center gap-3">
          <div className="ad-surface size-9 animate-pulse rounded-xl bg-surface-2/60" />
          <div className="flex flex-col gap-2">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-2/70" />
            <div className="h-3 w-64 animate-pulse rounded bg-surface-2/40" />
          </div>
        </div>
        {/* A few content rows */}
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ad-surface h-16 animate-pulse rounded-xl bg-surface-2/50" />
          ))}
        </div>
      </div>
    </div>
  )
}

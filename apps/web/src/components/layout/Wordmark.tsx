import { cn } from '@/lib/utils'

/**
 * The brand mark: the raster "AD" wing monogram (an "A" whose wing curls into a
 * "D"), a fixed sky-blue identity image on transparent — it is the brand's
 * permanent IDENTITY, so it never follows the theme and is NEVER the `--primary`
 * accent (unlike the former inline-SVG mark). The mark is decorative (aria-hidden);
 * the visible "Agentdeck" wordmark carries the accessible name.
 */
export function BrandMark({ className }: { className?: string }) {
  return <img src="/brand-mark.png" alt="" className={cn('h-6 w-auto select-none', className)} />
}

/**
 * Brand wordmark lockup: the brand-mark image + the "Agentdeck" text. The mark
 * is the fixed-identity flourish; the text stays as LIVE TEXT via `font-wordmark`
 * (the body sans, bold + tracked — never baked into an image, so it stays crisp +
 * themeable). The visible text carries the accessible name; the mark is decorative.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex select-none items-center gap-2', className)}>
      <BrandMark />
      <span className="font-wordmark text-[17px] leading-none font-bold uppercase tracking-[0.08em] text-foreground">
        Agentdeck
      </span>
    </span>
  )
}

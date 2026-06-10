import { type ReactNode, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * A self-contained, accessible image lightbox for the chat transcript. Wraps the
 * app's themed radix {@link Dialog} primitive, which already supplies the
 * `role="dialog"` semantics, the focus trap, Escape-to-close, focus return to the
 * trigger, and reduced-motion-safe fade/zoom (the `tw-animate-css` classes are
 * no-ops under `prefers-reduced-motion`). We do NOT reuse the Preview iframe dock
 * — a shared image is shown directly, never proxied through a browser frame.
 *
 * The `trigger` is the in-bubble thumbnail; clicking it (or pressing Enter/Space
 * on it) opens the modal with the full image fit to the viewport. The image's
 * `alt` doubles as the dialog's accessible title so a screen reader announces
 * what was enlarged.
 */
export function ImageLightbox({
  src,
  alt,
  trigger,
}: {
  /** The full-resolution image source (a data: or http(s) URL). */
  src: string
  /** Honest alt text — also the dialog's accessible title. */
  alt: string
  /** The clickable thumbnail that opens the lightbox. */
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // A non-empty title is required for an accessible dialog name; fall back to a
  // generic-but-honest label when the attachment carried no name.
  const title = alt.trim() || 'Enlarged image'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        // A real button so the thumbnail is keyboard-operable (Enter/Space) and
        // exposed to assistive tech as the "enlarge" affordance, not a bare image.
        onClick={() => setOpen(true)}
        aria-label={`Enlarge image: ${title}`}
        aria-haspopup="dialog"
        className="block max-w-full cursor-zoom-in rounded-[10px] focus-visible:ad-focus"
      >
        {trigger}
      </button>
      <DialogContent
        // The image IS the content — no padded popover card, no max-width cap, and
        // it stretches to fill the available viewport while preserving aspect.
        className="grid max-w-[min(92vw,1100px)] place-items-center border-0 bg-transparent p-0 shadow-none"
        // The default close sits bare over the image (muted X, no resting surface),
        // so it can vanish over a light image region. We supply our own below with a
        // guaranteed-contrast backing disc instead.
        showClose={false}
      >
        {/* The accessible name for the dialog. Visually hidden — the image carries
            the visible meaning; the title narrates it to screen readers. */}
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <img src={src} alt={alt} className="max-h-[88dvh] max-w-full rounded-xl object-contain" />
        {/* A solid dark disc backs the X so it always reads against any image —
            light or dark — never relying on the (transparent) dialog surface.
            Keeps the Dialog's focus-trap/Esc/labelled-title contract intact. */}
        <DialogClose
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid size-11 touch-manipulation place-items-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/80 focus-visible:ad-focus"
        >
          <X className="size-5" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageLightbox } from './ImageLightbox'

/**
 * A chat image — a constrained, rounded thumbnail that enlarges in the
 * {@link ImageLightbox} on click. Shared by the user's sent attachments (in the
 * transcript bubble) and the agent's markdown `![alt](src)` images.
 *
 * HONEST on failure: when the source can't load (404, expired data URL, blocked
 * host) we never show a browser's broken-image glyph. Instead we render a plain,
 * legible link to the source with its alt text, so the user still sees WHAT was
 * meant and can open it directly. Until then the image loads lazily.
 */
export function ChatImage({
  src,
  alt,
  className,
}: {
  src: string
  /** Honest alt text. Empty alt still renders (decorative), but the lightbox and
   * fallback fall back to a generic label so neither is nameless. */
  alt: string
  /** Extra classes for the thumbnail sizing (defaults to a transcript thumbnail). */
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const label = alt.trim()

  if (broken) {
    // Broken-image fallback: an honest link, never a broken glyph. data: URLs
    // aren't openable links, so those degrade to a quiet inline note instead.
    const isData = /^data:/i.test(src)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-foreground-tertiary">
        <ImageOff className="size-3.5 shrink-0" aria-hidden />
        {isData ? (
          <span>{label || 'Image unavailable'}</span>
        ) : (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {label || src}
          </a>
        )}
      </span>
    )
  }

  return (
    <ImageLightbox
      src={src}
      alt={label}
      trigger={
        <img
          src={src}
          alt={label}
          loading="lazy"
          onError={() => setBroken(true)}
          className={cn(
            'h-auto max-h-80 max-w-full rounded-md border border-border object-contain',
            className,
          )}
        />
      }
    />
  )
}

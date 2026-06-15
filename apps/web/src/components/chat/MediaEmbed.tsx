import { type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { PreviewLink } from '@/features/preview/PreviewLink'
import { ChatImage } from './ChatImage'
import { classifyMedia, isPlayableSource } from './mediaClassify'

/**
 * Agent-rendered media. A markdown link whose target is an audio or video file is
 * embedded inline with native controls instead of left as a bare link; anything
 * else routes to {@link PreviewLink} (the existing chat-link behavior) untouched.
 *
 * RESOLUTION POLICY (honest, no invented backend):
 *  - `data:` and `http(s)` sources are played directly by the browser.
 *  - `workspace://` and other app-internal schemes have NO media-serving route in
 *    this app (there is no files→media endpoint), so we do NOT fabricate one — we
 *    fall back to an honest "open" link rather than pointing a player at a URL the
 *    browser can't fetch.
 *
 * This is used as the markdown `a` renderer; non-media links pass straight through
 * to `PreviewLink`, so mailto:/anchors/relative paths/normal web links are
 * unchanged.
 */

export function MediaEmbed({ href, children }: { href?: string; children: ReactNode }) {
  if (href == null || href.trim() === '') {
    // Degenerate link (no target) — leave it to PreviewLink's safe handling.
    return <PreviewLink href={href}>{children}</PreviewLink>
  }
  const kind = classifyMedia(href)
  if (kind == null) {
    // Not media → the normal chat link (Preview panel + new-tab escape).
    return <PreviewLink href={href}>{children}</PreviewLink>
  }

  // An app-internal / un-fetchable media source (e.g. workspace://): we have no
  // route to serve it, so be honest — offer to open it, never a dead player.
  if (!isPlayableSource(href)) {
    return <UnresolvableMedia href={href}>{children}</UnresolvableMedia>
  }

  if (kind === 'image') {
    // A markdown LINK to an image (rare vs. ![]()): still show it inline.
    return <ChatImage src={href} alt={linkText(children) || 'Image'} />
  }
  if (kind === 'audio') {
    return (
      <audio
        controls
        preload="metadata"
        src={href}
        className="my-2 w-full max-w-md"
        aria-label={linkText(children) || 'Audio clip'}
      />
    )
  }
  // video
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={href}
      className="my-2 max-h-80 w-full max-w-xl rounded-md border border-border"
      aria-label={linkText(children) || 'Video clip'}
    />
  )
}

/** Honest fallback for a media link the browser can't fetch (no in-app route):
 * a plain link with an explicit "open" affordance — never a broken player. */
function UnresolvableMedia({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2"
      title="Open media (no in-app preview available for this location)"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

/** Best-effort plain text of a link's children, for an accessible media label. */
function linkText(children: ReactNode): string {
  if (children == null || children === false) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(linkText).join('')
  if (typeof children === 'object' && 'props' in children) {
    return linkText((children as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

import { type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { usePreviewStore, normalizeUrl } from './previewStore'

/**
 * An agent-rendered chat link, made openable INTO the Preview panel (#116). The
 * design line from the spec: clicking an agent link opens it in the in-app iframe
 * browser by default, WITHOUT hijacking every link destructively — a
 * modifier/middle click still does the native new-tab thing, and a small
 * adjacent control always offers the explicit new-tab escape.
 *
 * Used as the `a` renderer for chat markdown (see MarkdownContent). Only http(s)
 * links route to the panel; anything else (a mailto:, an anchor, a relative
 * path) falls back to a plain anchor so we never break those.
 */
export function PreviewLink({ href, children }: { href?: string; children: ReactNode }) {
  const openUrl = usePreviewStore((s) => s.openUrl)
  const previewable = href != null ? normalizeUrl(href) : null

  // Not a previewable http(s) URL (mailto:, in-page anchor, relative link, …) →
  // a plain, safe new-tab anchor, exactly as before. We don't reroute these.
  if (previewable == null) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }

  return (
    <span className="inline-flex max-w-full items-baseline gap-0.5">
      <a
        href={previewable}
        // Keep the anchor a real link (right-click → open, copy, screen-reader
        // "link") but intercept a PLAIN left click to open in the panel. A
        // modifier click (⌘/Ctrl/Shift/Alt) or a non-primary button falls through
        // to the browser's native new-tab/window behavior — never hijacked.
        target="_blank"
        rel="noopener noreferrer"
        data-testid="preview-link"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          openUrl(previewable)
        }}
      >
        {children}
      </a>
      {/* The always-present explicit new-tab escape hatch — a tiny control so the
          new-tab option is discoverable, not just a hidden modifier-click. */}
      <a
        href={previewable}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="preview-link-external"
        aria-label="Open link in a new tab"
        title="Open in a new tab"
        // Don't let this anchor's click bubble to the preview-open handler.
        onClick={(e) => e.stopPropagation()}
        className="inline-flex translate-y-px items-center text-foreground-tertiary no-underline hover:text-foreground"
      >
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </span>
  )
}

/**
 * The terminal → Preview panel link bridge (#116). xterm's web-links addon
 * tokenizes `http(s)://…` runs in the output and calls a handler with the
 * matched URI on click; this is that handler.
 *
 * Default action for a HOST-LOCAL URL (a localhost dev server): open it in the
 * in-app Preview panel (the local-preview loop), NOT a new browser tab. A PUBLIC
 * URL opens in a native new tab instead, because public sites set
 * `X-Frame-Options` / `frame-ancestors` and would dead-end the iframe. A
 * modifier click (⌘/Ctrl/Shift/Alt) is always honored as the "I actually want a
 * real new tab" escape hatch, mirroring the chat-link affordance, so the
 * terminal never destructively hijacks a URL click.
 *
 * Lives in the preview feature (not the terminal) so the terminal wiring stays a
 * one-line `new WebLinksAddon(handler)` and the preview ownership is contained.
 */
import { usePreviewStore, isHostLocalUrl } from './previewStore'

/** Open a host-local `uri` in the Preview panel; a public URL or a modifier
 * click opens a native new tab instead. */
export function handleTerminalLink(event: MouseEvent, uri: string): void {
  const modifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  if (modifier || !isHostLocalUrl(uri)) {
    // Native new-tab: the escape hatch, or a public site that can't be framed.
    // Safe (noopener/noreferrer), never the panel.
    window.open(uri, '_blank', 'noopener,noreferrer')
    return
  }
  usePreviewStore.getState().openUrl(uri)
}

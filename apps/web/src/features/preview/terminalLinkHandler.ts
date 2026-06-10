/**
 * The terminal → Preview panel link bridge (#116). xterm's web-links addon
 * tokenizes `http(s)://…` runs in the output and calls a handler with the
 * matched URI on click; this is that handler.
 *
 * Default action: open the URL in the in-app Preview panel (the local-preview
 * loop), NOT a new browser tab. A modifier click (⌘/Ctrl/Shift/Alt) is honored
 * as the "I actually want a real new tab" escape hatch, mirroring the chat-link
 * affordance — so the terminal never destructively hijacks every URL click.
 *
 * Lives in the preview feature (not the terminal) so the terminal wiring stays a
 * one-line `new WebLinksAddon(handler)` and the preview ownership is contained.
 */
import { usePreviewStore } from './previewStore'

/** Open `uri` in the Preview panel, unless a modifier asks for a native new tab. */
export function handleTerminalLink(event: MouseEvent, uri: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    // Native new-tab escape hatch — safe (noopener/noreferrer), never the panel.
    window.open(uri, '_blank', 'noopener,noreferrer')
    return
  }
  usePreviewStore.getState().openUrl(uri)
}

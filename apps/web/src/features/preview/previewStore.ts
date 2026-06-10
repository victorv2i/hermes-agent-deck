/**
 * The PREVIEW panel store (#116) — a tiny Zustand singleton driving the in-app
 * iframe browser. The agent surfaces a link in chat, or a URL appears in
 * terminal output; clicking it opens the URL HERE (a side panel) so the user can
 * check it without leaving Agent Deck — the local-preview loop.
 *
 * The store is intentionally dumb: it holds the current URL, whether the panel
 * is open, and the honest LOAD STATE of the iframe. The panel component drives
 * the state machine off the real `<iframe>` lifecycle (onLoad → loaded, a
 * load-timeout or onError → blocked), because an iframe can't tell us WHY a load
 * failed (X-Frame-Options / CSP `frame-ancestors` are opaque to script) — only
 * that nothing painted. We never show a silent blank panel: a load that doesn't
 * resolve in time is surfaced as `blocked` with an open-in-new-tab fallback.
 *
 * `nonce` bumps on `reload()` (and on each fresh `openUrl`) so the panel can key
 * its `<iframe>` to force a real remount/reload even when the URL is unchanged.
 */
import { create } from 'zustand'

/** The honest lifecycle of the previewed iframe. */
export type PreviewStatus =
  /** No URL yet (nothing to show). */
  | 'idle'
  /** A URL is set; the iframe is loading (awaiting onLoad / the timeout). */
  | 'loading'
  /** The iframe fired `load` — content (or at least a document) painted. */
  | 'loaded'
  /** The load failed or never resolved (likely X-Frame-Options / CSP): show the
   * "can't be previewed inline" fallback + open-in-new-tab, never a blank panel. */
  | 'blocked'

export interface PreviewState {
  /** Whether the panel is open (mounted-visible). */
  open: boolean
  /** The currently-previewed URL (normalized, http/https only), or null. */
  url: string | null
  /** The honest iframe load state. */
  status: PreviewStatus
  /** Bumped on every fresh open / reload so the panel can re-key its iframe. */
  nonce: number

  /**
   * Open `raw` in the preview panel. The URL is normalized (a bare host gets
   * `https://`); a non-http(s) or unparseable URL is REJECTED (no-op) so we never
   * point the iframe at `javascript:`/`data:`/`file:` etc. Opening always resets
   * the load state to `loading` and bumps the nonce (so re-opening the same URL
   * still triggers a real reload).
   */
  openUrl: (raw: string) => void
  /** Close the panel (keeps the URL so re-opening returns to it). */
  close: () => void
  /** Toggle open/closed. Opening with no URL yet just opens the empty panel. */
  toggle: () => void
  /** The iframe fired `load`: mark it loaded (clears any pending blocked state). */
  markLoaded: () => void
  /** The load failed / timed out: mark it blocked (show the inline fallback). */
  markBlocked: () => void
  /** Reload the current URL: back to `loading` + a fresh nonce (iframe remount). */
  reload: () => void
}

/**
 * Normalize a raw link/URL into a safe http(s) absolute URL string, or `null`
 * when it isn't previewable. A bare `host[/path]` (no scheme) is assumed https.
 * Only `http:`/`https:` survive — `javascript:`, `data:`, `file:`, `mailto:`,
 * `about:`, etc. are rejected so the iframe is never pointed at a dangerous or
 * un-previewable scheme.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Reject the known dangerous/opaque schemes UP FRONT. These carry a `scheme:`
  // but no `//` authority, so the host-vs-scheme heuristic below would otherwise
  // mistake them for a bare host and prepend `https://`. Listing them explicitly
  // keeps the iframe off `javascript:`/`data:`/`file:`/`mailto:`/`about:` etc.
  if (/^(javascript|data|file|mailto|about|blob|vbscript|tel):/i.test(trimmed)) return null
  const hasAuthorityScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  // A schemeless input that begins with a path/fragment/query marker is a
  // RELATIVE reference (`/p`, `./p`, `../p`, `#anchor`, `?q=1`), not a host — we
  // can't (and shouldn't) preview those, so reject rather than fabricate a host.
  if (!hasAuthorityScheme && /^[/.#?]/.test(trimmed)) return null
  // A leading `scheme://` is a real absolute URL; anything else (incl. a bare
  // `host:port/path`, where the `:` is a PORT, not a scheme) is treated as a
  // schemeless host and gets `https://`. After parsing we still reject any
  // protocol that isn't http(s), so a stray exotic `scheme://` can't slip
  // through.
  const candidate = hasAuthorityScheme ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.href
}

export const usePreviewStore = create<PreviewState>((set) => ({
  open: false,
  url: null,
  status: 'idle',
  nonce: 0,

  openUrl: (raw) => {
    const url = normalizeUrl(raw)
    if (url == null) return
    set((s) => ({ open: true, url, status: 'loading', nonce: s.nonce + 1 }))
  },
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  markLoaded: () => set((s) => (s.status === 'loading' ? { status: 'loaded' } : {})),
  markBlocked: () => set((s) => (s.status === 'loading' ? { status: 'blocked' } : {})),
  reload: () =>
    set((s) => (s.url == null ? {} : { status: 'loading', nonce: s.nonce + 1, open: true })),
}))

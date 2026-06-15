import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Globe, RotateCw, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { usePreviewStore } from './previewStore'

/**
 * The PREVIEW panel (#116) — an in-app iframe browser docked beside the
 * conversation. Minimal chrome (editable address bar · reload · open-in-new-tab ·
 * close) over an `<iframe>` that loads the current URL.
 *
 * Honesty is the whole point (the spec's hard line): a site that sends
 * `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'` simply won't paint in
 * an iframe, and the browser tells script NOTHING about why. So we run a
 * load-timeout: if the iframe's `load` event hasn't fired within the window, we
 * flip to a clear BLOCKED state ("can't be previewed inline — open in a new
 * tab") with the external-open button, never a silent blank panel. A real load
 * (onLoad) resolves to `loaded` and cancels the timeout. The store guards the
 * race both ways (a late timeout can't clobber a good load; a late load can't
 * resurrect a blocked one).
 *
 * The iframe `sandbox` is deliberately scoped (`allow-scripts allow-same-origin
 * allow-forms allow-popups`) so local dev apps actually work, and
 * `referrerpolicy="no-referrer"` keeps the host private. There is NO
 * `allow-top-navigation`, so a previewed page can't navigate Agent Deck away.
 *
 * Reachability is host-local-honest: an iframe loads from the USER'S browser, so
 * a `localhost` URL only resolves when the browser runs on the same machine as
 * the dev server. We say so in a one-line note rather than pretending a remote
 * (Tailscale) browser could reach the host's localhost — a proxy for that is out
 * of v1 scope.
 */

/**
 * How long to wait for the iframe's `load` before deciding the site refused to
 * frame us. Generous enough for a slow local dev server's first compile, short
 * enough that a blocked site doesn't leave the user staring at a blank panel.
 */
const LOAD_TIMEOUT_MS = 8000

export interface PreviewPanelProps {
  /**
   * Whether the panel is open. The panel stays mounted (offscreen) while closed
   * so the iframe doesn't reload on every toggle; we only run the load-timeout
   * while open. Defaults to `true` for standalone use/tests.
   */
  open?: boolean
}

export function PreviewPanel({ open = true }: PreviewPanelProps) {
  const url = usePreviewStore((s) => s.url)
  const status = usePreviewStore((s) => s.status)
  const nonce = usePreviewStore((s) => s.nonce)
  const openUrl = usePreviewStore((s) => s.openUrl)
  const close = usePreviewStore((s) => s.close)
  const reload = usePreviewStore((s) => s.reload)
  const markLoaded = usePreviewStore((s) => s.markLoaded)
  const markBlocked = usePreviewStore((s) => s.markBlocked)

  // The honest blocked-load timeout: armed each time we (re)enter `loading` while
  // open. A real `load` cancels it (markLoaded → status leaves 'loading'); if it
  // fires first, the site almost certainly refused to be framed.
  useEffect(() => {
    if (!open || status !== 'loading') return
    const id = window.setTimeout(() => markBlocked(), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [open, status, nonce, markBlocked])

  const onOpenExternal = useCallback(() => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [url])

  const hasUrl = url != null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-panel">
      <header className="shrink-0 border-b border-border px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <h2 className="sr-only">Preview</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={reload}
            disabled={!hasUrl}
            aria-label="Reload preview"
            data-testid="preview-reload"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <RotateCw
              className={cn('size-4', status === 'loading' && 'motion-safe:animate-spin')}
            />
          </Button>

          {/* Address bar: editable, Enter navigates. A bare host gets https://
              on submit (normalizeUrl, in the store). Re-keyed on the current
              url+nonce so each real navigation reseeds the draft from the store
              WITHOUT a setState-in-effect — an in-progress edit is only replaced
              when the panel actually navigates somewhere. */}
          <AddressBar key={`${url ?? ''}#${nonce}`} initial={url ?? ''} onSubmit={openUrl} />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenExternal}
            disabled={!hasUrl}
            aria-label="Open in a new tab"
            data-testid="preview-open-external"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close preview"
            data-testid="preview-close"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-1">
        {!hasUrl ? (
          <PreviewEmpty />
        ) : status === 'blocked' ? (
          <PreviewBlocked url={url} onOpenExternal={onOpenExternal} onRetry={reload} />
        ) : (
          <iframe
            // Re-key on the nonce so a reopen/reload of the SAME url forces a real
            // remount + fresh load (and re-arms the timeout via status='loading').
            key={`${url}#${nonce}`}
            title="Preview"
            data-testid="preview-iframe"
            src={url}
            onLoad={markLoaded}
            // onError rarely fires for cross-origin frames, but when it does (e.g.
            // a network failure) we treat it the same as a refused frame.
            onError={markBlocked}
            // Scoped sandbox: enough for a real local app (scripts/forms/same-origin/
            // popups), but NO top-navigation so a previewed page can't redirect
            // Agent Deck itself.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-surface-elevated"
          />
        )}
      </div>

      {/* The one honest line about same-machine reachability (always shown, calm
          chrome). A host-local URL works only when the browser is ON the host. */}
      <footer className="shrink-0 border-t border-border px-3 py-1.5">
        <p className="text-[11px] leading-snug text-foreground-tertiary">
          A host-local URL (localhost) loads when your browser is on the same machine. A remote
          (Tailscale) browser would need a proxy.
        </p>
      </footer>
    </div>
  )
}

/**
 * The editable address bar. A self-contained controlled draft seeded once from
 * `initial`; submitting (Enter) hands the value to `onSubmit` (the store's
 * `openUrl`, which normalizes a bare host to https://). The PARENT re-keys this
 * on each navigation so a new url reseeds the draft via the mount initializer —
 * no setState-in-effect, no cascading render.
 */
function AddressBar({ initial, onSubmit }: { initial: string; onSubmit: (raw: string) => void }) {
  const [draft, setDraft] = useState(initial)
  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(draft)
      }}
    >
      <label className="sr-only" htmlFor="preview-address">
        Preview address
      </label>
      <Input
        id="preview-address"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Enter a URL to preview"
        inputMode="url"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        data-testid="preview-address"
        aria-keyshortcuts="Meta+L Control+L"
        className="h-10 text-[12.5px]"
      />
    </form>
  )
}

/** The idle state: nothing has been opened yet. */
function PreviewEmpty() {
  return (
    <div
      className="flex h-full items-center justify-center p-6 text-center"
      data-testid="preview-empty"
    >
      <div className="max-w-xs">
        <Globe className="mx-auto size-6 text-foreground-tertiary" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">Nothing to preview yet</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Open a link your agent shares in chat, or a URL from the terminal, to load it here without
          leaving Agent Deck.
        </p>
      </div>
    </div>
  )
}

/**
 * The honest BLOCKED state — never a silent blank panel. A site that refuses to
 * be framed (X-Frame-Options / CSP `frame-ancestors`) is opaque to script, so we
 * say plainly that it can't be previewed inline and offer the new-tab escape
 * hatch (plus a retry, in case it was just a slow first compile).
 */
function PreviewBlocked({
  url,
  onOpenExternal,
  onRetry,
}: {
  url: string
  onOpenExternal: () => void
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      data-testid="preview-blocked"
      className="flex h-full items-center justify-center p-6 text-center"
    >
      <div className="max-w-xs">
        <ShieldAlert className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">
          This site can&apos;t be previewed inline
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          It either refused to load in a frame (a common security header) or didn&apos;t respond in
          time. Open it in a new tab instead.
        </p>
        <p className="mt-2 truncate font-mono text-[11px] text-foreground-tertiary" title={url}>
          {url}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onOpenExternal}
            data-testid="preview-blocked-external"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Open in new tab
          </Button>
          <Button variant="outline" size="sm" onClick={onRetry} data-testid="preview-blocked-retry">
            <RotateCw className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}

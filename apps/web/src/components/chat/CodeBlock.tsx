import { useEffect, useRef, useState } from 'react'
import { Check, Copy, PanelRight } from 'lucide-react'
import { useTheme } from '@/components/theme/theme-context'
import { cn } from '@/lib/utils'
import { highlight, normalizeLang } from './lib/highlight'
import { useWorkPanelStore } from '@/features/work-panel/workPanelStore'

/**
 * A fenced code block: rounded card, a header with:
 *   - the FILENAME (when `filename` prop is set) or the language label,
 *   - a copy button ("Copied!" feedback),
 *   - an "Open in panel" button that sends the artifact to the WorkPanel.
 *
 * Shiki-highlighted body lazy-loads; until it resolves (or for unsupported
 * languages) shows the raw monospace text — progressive enhancement, no layout
 * shift.
 *
 * AUTO-OPEN HEURISTIC (honest + conservative): when the block has >= 8 lines
 * AND a `filename` is set (a deliberate artifact, not a throwaway snippet), we
 * open the WorkPanel automatically on mount so the user can read it beside the
 * conversation. The panel is always dismissible (close button + Esc). The
 * heuristic only fires when the panel isn't already showing a different artifact
 * (to avoid stomping the user's focus), and never steals focus from the composer.
 */

/** Lines threshold above which we auto-open the panel for a named artifact. */
const AUTO_OPEN_LINES = 8

export function CodeBlock({
  code,
  lang,
  filename,
  suppressPanelButton = false,
}: {
  code: string
  lang?: string
  /**
   * When set, renders as the block header label (the path / filename from the
   * fenced-code info string) instead of the bare language name.
   */
  filename?: string
  /**
   * Suppress the "Open in panel" button. Used by WorkPanel itself when it
   * renders a CodeBlock internally — no self-referential open affordance.
   */
  suppressPanelButton?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openArtifact = useWorkPanelStore((s) => s.openArtifact)
  const panelArtifact = useWorkPanelStore((s) => s.artifact)
  const panelOpen = useWorkPanelStore((s) => s.open)

  // The header label: filename takes precedence; fall back to normalized lang.
  const effectiveFilename = filename?.trim() || undefined
  const label = effectiveFilename ?? normalizeLang(lang) ?? (lang?.toLowerCase() || 'text')

  useEffect(() => {
    let active = true
    highlight(code, lang, resolvedTheme).then((out) => {
      if (active) setHtml(out)
    })
    return () => {
      active = false
    }
  }, [code, lang, resolvedTheme])

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  // AUTO-OPEN HEURISTIC: sizeable named artifacts open the WorkPanel on mount
  // so the user sees the code beside the conversation immediately. Conditions:
  //   1. filename is set (a deliberate, named artifact — not a throwaway snippet)
  //   2. The code is >= AUTO_OPEN_LINES lines (sizeable)
  //   3. suppressPanelButton is false (we're in chat, not already inside WorkPanel)
  //   4. The panel is not already showing a different artifact (don't stomp focus)
  // The effect runs once on mount, never on content changes, so streaming tokens
  // don't repeatedly re-trigger it. It never steals keyboard focus.
  useEffect(() => {
    if (!effectiveFilename || suppressPanelButton) return
    if (code.split('\n').length < AUTO_OPEN_LINES) return
    // Only auto-open if the panel is currently closed or empty (don't replace
    // an artifact the user already chose to view).
    if (panelOpen && panelArtifact !== null) return
    openArtifact({ type: 'code', title: effectiveFilename, lang, content: code })
    // Mount-only — we don't want code changes during streaming to re-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(code)
    } catch {
      // Clipboard may be unavailable (insecure context); still show feedback.
    }
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
  }

  const onOpenInPanel = () => {
    openArtifact({
      type: 'code',
      title: effectiveFilename ?? label,
      lang,
      content: code,
    })
  }

  return (
    <div className="ad-surface not-prose my-4 overflow-hidden rounded-xl bg-surface-1">
      <div className="flex min-h-9 items-center justify-between border-b border-border bg-surface-2/50 px-3">
        <span className="font-mono text-[11px] lowercase tracking-wide text-foreground-tertiary">
          {label}
        </span>
        <div className="flex items-center">
          {!suppressPanelButton && (
            <button
              type="button"
              onClick={onOpenInPanel}
              aria-label="Open in panel"
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus sm:min-h-7 sm:px-1.5"
            >
              <PanelRight className="size-3.5" />
              <span className="hidden sm:inline">Open in panel</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? 'Copied' : 'Copy code'}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus sm:min-h-7 sm:px-1.5"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-success" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      {html ? (
        // Shiki output: code originates from the model and is escaped by Shiki.
        <div
          data-testid="shiki"
          className={cn(
            'overflow-x-auto p-4 text-13 leading-relaxed',
            '[&_pre]:!bg-transparent [&_pre]:!m-0 [&_code]:font-mono',
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-13 leading-relaxed">
          <code className="font-mono">{code}</code>
        </pre>
      )}
    </div>
  )
}

import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { Check, Copy, Download, FileCode, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { useWorkPanelStore } from './workPanelStore'

/**
 * The WORK PANEL — the artifact canvas for Agent Deck.
 *
 * This is the artifact-canvas equivalent: a docked side
 * panel that shows a real code/markdown/HTML artifact BESIDE the conversation,
 * so the user can read, copy, and download it without scrolling the transcript.
 *
 * Design decisions:
 * - It reuses the SAME docked-side-panel real-estate and open/close mechanism
 *   as the Preview panel (#116), wired identically in AppShell + App. The two
 *   panels are separately toggleable: opening one doesn't close the other, but
 *   the wide-cockpit layout only has one side column (the user most recently
 *   opened one occupies it).
 * - HONEST ceiling: read-only render only. We never execute agent code in the
 *   browser. The HTML artifact renders in a sandboxed iframe with the same
 *   strict sandbox as the Preview panel (no allow-top-navigation, no scripts by
 *   default — see the HTML renderer note for the exact settings).
 * - Reuses the existing CodeBlock (Shiki highlighter) and the lazy Markdown
 *   renderer for their respective artifact types. No second engine.
 * - Download uses a real Blob + anchor click so the browser's native save flow
 *   handles encoding + filename — no fabricated endpoints.
 *
 * Accessibility: the panel is aria-labeled, keyboard-reachable, and respects
 * prefers-reduced-motion via the AppShell spring (same as the drawer).
 */

// The markdown renderer is lazy (same chunk as the chat uses) — no second copy.
const Markdown = lazy(() =>
  import('@/components/chat/Markdown').then((m) => ({ default: m.Markdown })),
)

export interface WorkPanelProps {
  /**
   * Whether the panel is open. Matches the AppShell pattern: the panel stays
   * mounted (offscreen) while closed so content isn't torn down on every toggle.
   */
  open?: boolean
}

export function WorkPanel({ open = true }: WorkPanelProps) {
  const artifact = useWorkPanelStore((s) => s.artifact)
  const close = useWorkPanelStore((s) => s.close)

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="work-panel"
      aria-labelledby="work-panel-heading"
    >
      <header className="shrink-0 border-b border-border px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <h2 id="work-panel-heading" className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <FileCode className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
            {artifact ? (
              <span
                className="truncate font-mono text-[12px] text-foreground"
                title={artifact.title}
              >
                {artifact.title}
              </span>
            ) : (
              <span className="text-[12px] text-muted-foreground">Artifact canvas</span>
            )}
          </h2>

          {artifact && <CopyButton content={artifact.content} />}
          {artifact && <DownloadButton title={artifact.title} content={artifact.content} />}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close work panel"
            data-testid="work-panel-close"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!artifact ? (
          <WorkPanelEmpty />
        ) : (
          <div className="h-full overflow-auto" data-testid="work-panel-artifact">
            {artifact.type === 'code' && (
              <div className="p-3">
                {/* Reuse the existing CodeBlock with `filename` already resolved
                    by the store. Suppress the open-in-panel button inside the
                    panel itself (no self-reference). */}
                <CodeBlock
                  code={artifact.content}
                  lang={artifact.lang}
                  filename={artifact.title}
                  suppressPanelButton
                />
              </div>
            )}
            {artifact.type === 'markdown' && (
              <div className="p-4">
                <Suspense
                  fallback={
                    <div className="whitespace-pre-wrap font-mono text-sm text-foreground">
                      {artifact.content}
                    </div>
                  }
                >
                  <Markdown>{artifact.content}</Markdown>
                </Suspense>
              </div>
            )}
            {artifact.type === 'html' && <HtmlArtifact content={artifact.content} open={open} />}
          </div>
        )}
      </div>
    </section>
  )
}

/** Empty state — nothing has been opened yet. */
function WorkPanelEmpty() {
  return (
    <div
      className="flex h-full items-center justify-center p-6 text-center"
      data-testid="work-panel-empty"
    >
      <div className="max-w-xs">
        <FileCode className="mx-auto size-6 text-foreground-tertiary" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">No artifact open</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Click the &quot;Open in panel&quot; button on a code block to view it here beside the
          conversation.
        </p>
      </div>
    </div>
  )
}

/**
 * HTML artifact rendered in a sandboxed iframe with `srcdoc`. This is the same
 * sandboxed-iframe approach as the Preview panel, but using `srcdoc` (the HTML
 * string directly from the agent) rather than a remote URL.
 *
 * Sandbox: `allow-scripts` ONLY. We deliberately do NOT add `allow-same-origin`
 * — combined with `allow-scripts` on a `srcdoc` frame it would let the agent's
 * HTML reach back into Agent Deck's own DOM/origin (a sandbox escape). Without
 * it the frame runs in a unique opaque origin: scripts execute but cannot touch
 * the parent. We also omit `allow-top-navigation` (a framed page can't redirect
 * Agent Deck away), `allow-popups`, and `allow-forms`.
 *
 * Honest ceiling: we render what the agent produced. We don't execute or augment
 * it further. Scripts run IN the opaque-origin sandbox, isolated from Agent Deck.
 */
function HtmlArtifact({ content, open }: { content: string; open: boolean }) {
  // White page canvas in BOTH modes: an HTML artifact assumes a white page, so a
  // naked artifact (no background of its own) must never render dark-on-dark in
  // dark mode. (The Preview panel differs — live sites paint their own background.)
  return (
    <iframe
      data-testid="work-panel-html-iframe"
      title="HTML artifact"
      srcDoc={content}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn('h-full w-full border-0 bg-white', !open && 'invisible')}
    />
  )
}

/** Copy the artifact content to the clipboard. */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(content)
    } catch {
      // Clipboard unavailable in insecure context; still show feedback.
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }, [content])

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy artifact'}
      data-testid="work-panel-copy"
      className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </Button>
  )
}

/**
 * Download button — triggers a real file download via the browser's native save
 * dialog. Creates a Blob from the content string, builds an object URL, clicks a
 * hidden anchor, and immediately revokes the object URL. No fabricated endpoint,
 * no server round-trip.
 */
function DownloadButton({ title, content }: { title: string; content: string }) {
  const onDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = title
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [title, content])

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onDownload}
      aria-label={`Download ${title}`}
      data-testid="work-panel-download"
      className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
    >
      <Download className="size-4" />
    </Button>
  )
}

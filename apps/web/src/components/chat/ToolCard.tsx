import { useState } from 'react'
import { Collapsible } from 'radix-ui'
import { ChevronRight, Loader2, Terminal, TriangleAlert } from 'lucide-react'
import type { ToolCall } from '@/state/chatStore'
import { cn } from '@/lib/utils'

/**
 * A tool call rendered as a quiet, metadata-colored one-line chip:
 *   ⟩ <icon> Ran <tool> · <summary> · <duration> · <when>
 * Click to expand the detail panel. Never auto-expands. While the call is still
 * running it shows a spinner; a failed call is tinted with the semantic
 * destructive color.
 *
 * Detail panel — operational honesty: the gateway's `tool.completed` frame
 * carries no result/output payload (only `tool`, `duration`, `error`). The only
 * per-tool text on this transport is the started `preview` and, on failure, the
 * `tool.failed` error string. So we surface the BEST available signal and label
 * it for what it is — the failure error for failed calls, the command preview
 * for successful ones — rather than fabricating a "result".
 *
 * Open state is uncontrolled by default; pass `open`/`onOpenChange` to drive it
 * from a turn-level "expand all / collapse all" control.
 */
/**
 * Plain-language labels for the most common tools, so a newcomer reads the
 * chip as an action ("Run command") instead of an opaque tool name. Falls back
 * to the raw tool name for anything unmapped — we never invent a label, and the
 * real name always remains visible in the expanded detail panel (honesty).
 */
const PLAIN_LANGUAGE_TOOLS: Record<string, string> = {
  bash: 'Run command',
  shell: 'Run command',
  read_file: 'Read a file',
  write_file: 'Write a file',
  edit_file: 'Edit a file',
  web_search: 'Search the web',
  web_fetch: 'Fetch a page',
}

/** A friendly label for a tool, or the raw name when unmapped. */
function plainLanguageTool(tool: string): string {
  return PLAIN_LANGUAGE_TOOLS[tool] ?? tool
}

export function ToolCard({
  call,
  open,
  onOpenChange,
  defaultOpen,
}: {
  call: ToolCall
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Open on mount when uncontrolled (driven by the "Detailed" verbosity pref). */
  defaultOpen?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const running = call.status === 'running'
  const failed = call.status === 'failed' || call.error
  const summary = call.preview?.trim() || (running ? 'running…' : failed ? 'failed' : 'done')
  const duration = typeof call.duration === 'number' ? formatDuration(call.duration) : null
  const when =
    typeof call.completedAt === 'number' && Number.isFinite(call.completedAt)
      ? formatRelative(call.completedAt)
      : null

  const errorText = call.errorMessage?.trim() || ''
  const previewText = call.preview?.trim() || ''

  // A known tool already reads as an action ("Run command"), so it stands alone;
  // an unmapped tool keeps the "Ran <tool>" form with its raw name. Liveness for a
  // mapped running tool is carried honestly by the spinner + the "· running…"
  // summary, so we don't prepend a "Running" verb to a label that already implies
  // the action (which produced the broken "Running Search the web").
  const plainLabel = plainLanguageTool(call.tool)
  const isMapped = plainLabel !== call.tool
  const verb = running ? 'Running' : 'Ran'

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={setOpen}
      className="not-prose my-1 w-fit max-w-full"
    >
      <Collapsible.Trigger
        data-testid="toolcard-trigger"
        className={cn(
          'group/tool inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11.5px] transition-colors',
          'hover:border-border hover:bg-surface-2/60 hover:opacity-100 focus-visible:ad-focus focus-visible:bg-surface-2/40',
          'data-[state=open]:border-border data-[state=open]:bg-surface-2/60 data-[state=open]:opacity-100',
          failed ? 'text-destructive' : 'text-foreground-tertiary',
          !isOpen && !running && !failed && 'opacity-60',
        )}
      >
        <ChevronRight
          className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]/tool:rotate-90"
          aria-hidden
        />
        {running ? (
          <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden />
        ) : failed ? (
          <TriangleAlert className="size-3 shrink-0 text-destructive" aria-hidden />
        ) : (
          <Terminal className="size-3 shrink-0" aria-hidden />
        )}
        <span className="truncate">
          {isMapped ? (
            // A mapped tool reads as a plain action ("Run command", "Search the
            // web") in both states — the spinner + "· running…" summary carry
            // liveness, so no "Running" verb is prepended onto the action label.
            <span className="font-medium text-muted-foreground">{plainLabel}</span>
          ) : (
            // An unmapped tool keeps the "Running/Ran <name>" form so the live
            // state stays explicit and the raw tool name is shown.
            <>
              {verb} <span className="font-medium text-muted-foreground">{call.tool}</span>
            </>
          )}
          <span> · {summary}</span>
        </span>
        {duration && <span className="shrink-0 opacity-80">· {duration}</span>}
        {when && (
          <time
            className="shrink-0 tabular-nums opacity-70"
            title={new Date(call.completedAt!).toLocaleString()}
            dateTime={new Date(call.completedAt!).toISOString()}
          >
            · {when}
          </time>
        )}
      </Collapsible.Trigger>

      <Collapsible.Content
        data-testid="toolcard-content"
        className="overflow-hidden data-[state=closed]:hidden"
      >
        <div className="mt-1 max-w-[640px] space-y-2">
          {/* The real tool name — always visible here, never hidden behind the
              plain-language chip label (honesty for power users). */}
          <div className="rounded-lg border border-border bg-surface-1 px-3 py-2">
            <p className="ad-section-label mb-0.5 text-foreground-tertiary">Tool</p>
            <code className="font-mono text-[12px] text-muted-foreground">{call.tool}</code>
          </div>

          {failed && errorText && (
            <div
              data-testid="toolcard-error"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-destructive"
            >
              <p className="ad-section-label mb-1 text-destructive/80">Error</p>
              <pre className="max-h-72 overflow-auto font-mono text-[12px] leading-[1.55] whitespace-pre-wrap">
                {errorText}
              </pre>
            </div>
          )}

          {previewText ? (
            <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5">
              <p className="ad-section-label mb-1 text-foreground-tertiary">Preview</p>
              <pre className="max-h-72 overflow-auto font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-muted-foreground">
                {previewText}
              </pre>
            </div>
          ) : (
            !errorText && (
              <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5">
                <p className="text-[12px] text-foreground-tertiary">
                  No output captured for this call.
                </p>
              </div>
            )
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

/** Calm relative time for the chip: "just now" → "Nm ago" → "Nh ago" → "Nd ago".
 * Mirrors the conversation hover-timestamp vocabulary. */
function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs
  if (diff < 45_000) return 'just now'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

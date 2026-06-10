import { Loader2 } from 'lucide-react'

/**
 * A quiet live-state chip shown while a tool is running.
 * Derived ONLY from real tool.started wire data: tool name + optional preview.
 *
 * Honesty rules:
 * - stepNumber comes from the REAL running tool index in the current turn
 * - Never shows "Step N of M" because no event provides a plan total
 * - Uses --primary accent because this IS a live-state signal (design spine)
 * - Renders nothing when status !== 'running'
 */

/**
 * Human-readable live labels for the most common tools.
 * Falls back to the raw tool name for unknown tools — never invents a label.
 */
const LIVE_TOOL_LABELS: Record<string, string> = {
  bash: 'Running code',
  shell: 'Running code',
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  web_search: 'Searching the web',
  web_fetch: 'Fetching page',
}

function liveLabel(tool: string): string {
  return LIVE_TOOL_LABELS[tool] ?? tool
}

export function ToolStatusChip({
  tool,
  status,
  stepNumber,
}: {
  tool: string
  status: 'running' | 'completed' | 'failed'
  /** The real 1-based step index from the caller (count of tool calls so far).
   * Omit to suppress the counter. Never fabricate a total ("of N"). */
  stepNumber?: number
}) {
  if (status !== 'running') return null

  const label = liveLabel(tool)
  const ariaLabel = stepNumber != null ? `Step ${stepNumber}: ${label}` : label

  return (
    <span
      data-testid="tool-status-chip"
      aria-label={ariaLabel}
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-[11.5px] text-primary"
    >
      <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden />
      {stepNumber != null && <span className="font-medium opacity-70">Step {stepNumber}</span>}
      <span>{label}…</span>
    </span>
  )
}

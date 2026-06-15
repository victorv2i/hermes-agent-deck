import { useState } from 'react'
import { Collapsible } from 'radix-ui'
import { Brain, ChevronRight } from 'lucide-react'

/**
 * A one-line preview of the reasoning for the collapsed chip. Multi-step chains
 * read more clearly when their segments are separated rather than run together,
 * so segments are joined with " / " before the 72-char cut.
 */
function collapsedSummary(segments: string[]): string {
  const first = segments
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ')
  if (first.length <= 72) return first
  return `${first.slice(0, 71).trimEnd()}…`
}

/**
 * A collapsible "Thinking" disclosure for the agent's reasoning summaries. It
 * RECEDES: muted, small, collapsed by default with a one-line preview of the
 * thought; expanding reveals the full segments in a subtle container with a
 * neutral left-border (decoration is never the accent). One block may carry
 * several reasoning segments.
 */
export function ReasoningBlock({
  segments,
  defaultOpen,
}: {
  segments: string[]
  /** Open on mount (driven by the "Detailed" reasoning-verbosity pref). */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  if (segments.length === 0) return null

  const summary = collapsedSummary(segments)

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="not-prose my-1.5 w-fit max-w-full"
    >
      <Collapsible.Trigger
        data-testid="reasoning-trigger"
        className="group/think inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11.5px] text-foreground-tertiary transition-colors hover:border-border hover:bg-surface-2/60 data-[state=open]:border-border data-[state=open]:bg-surface-2/60 focus-visible:ad-focus"
      >
        <Brain className="size-3 shrink-0 text-foreground-tertiary" aria-hidden />
        <span className="font-medium text-muted-foreground">Thinking</span>
        {summary && (
          <span className="truncate group-data-[state=open]/think:hidden"> · {summary}</span>
        )}
        <ChevronRight
          className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]/think:rotate-90"
          aria-hidden
        />
      </Collapsible.Trigger>

      <Collapsible.Content data-testid="reasoning-content" className="data-[state=closed]:hidden">
        <div className="mt-1 max-w-[640px] space-y-2 rounded-lg border border-border border-l-2 border-l-border-strong bg-surface-1 px-3 py-2.5 text-13 leading-relaxed text-muted-foreground">
          {segments.map((seg, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {seg}
            </p>
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/**
 * KanbanExpandedShell — the FULLSCREEN board overlay. When the board is
 * expanded, its lane of columns is too wide for the shell's center column to
 * show at once; this renders the board into a full-viewport radix Dialog that
 * BREAKS OUT of that column entirely, so every lane is visible side by side.
 *
 * Why a Dialog: radix gives the focus-trap, Esc-to-close, `aria-modal`, and a
 * restore-focus-to-trigger for free — exactly the keyboard/SR parity the spine
 * requires — without hand-rolling any of it. The content fills the viewport
 * (inset-0) with a slim bar carrying the title + a clear COLLAPSE control, and
 * the board body fills the rest with the columns flowing across the full width.
 *
 * Motion: a brief fade/zoom that is fully suppressed under reduced-motion
 * (`motion-safe:` only). Amber stays governed — the collapse control is a muted
 * ghost, not an accent fill.
 */
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BoardScroller } from './BoardScroller'

export interface KanbanExpandedShellProps {
  open: boolean
  onCollapse: () => void
  /** A short label for the bar (e.g. the board name). */
  title: string
  /** The board lane (columns) — rendered full-width inside the overlay. */
  children: React.ReactNode
  /** Optional header actions (board selector, new-card, live dot) for the bar. */
  actions?: React.ReactNode
}

export function KanbanExpandedShell({
  open,
  onCollapse,
  title,
  children,
  actions,
}: KanbanExpandedShellProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onCollapse()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-background/80',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out',
            'motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          data-testid="kanban-expanded"
          aria-label={`${title}: expanded board`}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out',
            'motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0',
            'motion-safe:data-[state=open]:zoom-in-[0.99] motion-safe:data-[state=closed]:zoom-out-[0.99]',
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <DialogPrimitive.Title className="font-heading text-sm font-medium tracking-tight text-foreground">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              The full task board, expanded to fill the window so every column is visible. Press
              Escape or use Collapse to return.
            </DialogPrimitive.Description>
            <div className="ml-auto flex items-center gap-2">
              {actions}
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  aria-label="Collapse board"
                  aria-keyshortcuts="Escape"
                  data-testid="kanban-collapse"
                  className={cn(
                    'inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 text-[13px] text-muted-foreground transition-colors md:h-10',
                    'hover:border-border-strong hover:text-foreground',
                    'focus-visible:ad-focus',
                  )}
                >
                  <Minimize2 className="size-4" aria-hidden />
                  <span>Collapse</span>
                </button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* The board lane fills the full viewport width; horizontal scroll only
              kicks in when the columns genuinely exceed the (now much wider) space,
              with the same resting scrollbar + edge-fade affordance as in-flow. */}
          <BoardScroller>{children}</BoardScroller>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

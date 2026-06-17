/**
 * MoveMenu — the per-card "move to column" control. A quiet icon trigger →
 * popover listing the REAL, backend-accepted move targets ({@link
 * KANBAN_MOVE_TARGETS}); choosing one fires an optimistic move. The card's
 * CURRENT column is shown as the disabled, checked row so the menu reads as a
 * column picker, never a mystery.
 *
 * Honesty (the writable contract): the menu only ever offers columns the bulk
 * route accepts — `running` and `review` are absent because the backend refuses
 * a direct move into them, so we never present an action that can only fail. If
 * the backend still refuses an offered move (e.g. promoting to `ready` with
 * unfinished parents), the caller rolls the optimistic move back and toasts the
 * real reason — this control just dispatches.
 *
 * The action accent is governed: the trigger is a muted ghost (never a sky-blue fill); the
 * checkmark on the current column is neutral. The trigger is touch-sized on
 * narrow screens and fully keyboard reachable (radix Popover gives focus +
 * arrow-key roving for free).
 */
import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, MoveRight } from 'lucide-react'
import {
  KANBAN_MOVE_TARGETS,
  type KanbanColumnName,
  type KanbanMoveTarget,
} from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { COLUMN_META, TONE_DOT_CLASS } from './columnMeta'

export interface MoveMenuProps {
  /** The card's current column (shown checked + disabled). */
  current: KanbanColumnName
  /** Fire a move to `target`. The parent owns the optimistic update + rollback. */
  onMove: (target: KanbanMoveTarget) => void
  /** Disable the whole control while a move is in flight. */
  disabled?: boolean
}

export function MoveMenu({ current, onMove, disabled = false }: MoveMenuProps) {
  const [open, setOpen] = useState(false)

  function handleMove(target: KanbanMoveTarget) {
    setOpen(false)
    if (target === current) return
    onMove(target)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Move to column"
          title="Move to column"
          disabled={disabled}
          // Stop the click from also opening the card drawer (the card is a button).
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2/60 text-muted-foreground transition-colors md:size-7',
            'hover:border-border-strong hover:text-foreground',
            'focus-visible:ad-focus',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <MoveRight className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          // Keep the card's click handler from firing when interacting with the menu.
          onClick={(e) => e.stopPropagation()}
          className="ad-surface z-50 w-44 rounded-xl bg-popover p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="Move to column" className="flex flex-col gap-0.5">
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-foreground-tertiary">
              Move to
            </p>
            {KANBAN_MOVE_TARGETS.map((target) => {
              const meta = COLUMN_META[target]
              const isCurrent = target === current
              return (
                <button
                  key={target}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  disabled={isCurrent}
                  onClick={() => handleMove(target)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 transition-colors',
                    'hover:bg-muted hover:text-foreground focus-visible:ad-focus',
                    isCurrent ? 'cursor-default text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT_CLASS[meta.tone])}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                  {isCurrent ? (
                    <Check className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
                  ) : null}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * TaskDrawer — the card-detail panel. A right-side slide-in sheet built on
 * radix-ui's Dialog primitive (focus-trap + Esc-to-close + ARIA + a
 * reduced-motion-safe slide come for free, matching the app's drawer language),
 * re-styled as a side sheet rather than a centred modal. It shows the task's full
 * body, latest worker summary, run history (the "log"), comments, and events —
 * and offers the ONE write a reader does from here: ADD A COMMENT (the composer,
 * wired to the real `POST /tasks/:id/comments` route via {@link CommentComposer}).
 *
 * The detail is fetched lazily ({@link useKanbanTask}, enabled only when open) and
 * the live hook invalidates it on each board snapshot, so an open card's log
 * tracks the running worker. While the fetch is in flight we keep the clicked
 * card's slim data visible (passed as `card`) so the drawer never flashes empty.
 */
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X, User, Clock, MessageSquare, ScrollText, Activity, Cpu } from 'lucide-react'
import type { KanbanCard, KanbanTask } from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { COLUMN_META } from './columnMeta'
import { CommentComposer } from './CommentComposer'
import { RunControls } from './RunControls'

export interface TaskDrawerProps {
  /** The card that was clicked (its slim data backs the header while detail loads). */
  card: KanbanCard | null
  /** The fetched full detail, when available. */
  task: KanbanTask | undefined
  isLoading: boolean
  open: boolean
  onClose: () => void
  /** Board slug the open card lives on (for the comment write). */
  board?: string
  /** Known assignees on the board (quick reassign targets for {@link RunControls}). */
  assignees?: string[]
}

export function TaskDrawer({
  card,
  task,
  isLoading,
  open,
  onClose,
  board,
  assignees,
}: TaskDrawerProps) {
  const title = task?.card.title ?? card?.title ?? 'Task'
  const column = task?.card.column ?? card?.column
  const assignee = task?.card.assignee ?? card?.assignee ?? null
  const body = task?.body ?? null
  const summary = task?.latestSummary ?? card?.latestSummary ?? null
  // The card id backing the open drawer (detail when loaded, else the slim card).
  const taskId = task?.card.id ?? card?.id ?? null
  // The card backing the run controls -- prefer the freshest (detail) card so the
  // column/worker the controls gate on is up to date.
  const controlCard = task?.card ?? card ?? null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/45',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          data-testid="kanban-task-drawer"
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl shadow-black/40',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          )}
        >
          <header className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-heading text-base font-medium leading-snug text-foreground">
                {title}
              </DialogPrimitive.Title>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {column ? (
                  <Badge
                    variant={column === 'running' ? 'active' : 'muted'}
                    className="h-4 px-1.5 text-[10px]"
                  >
                    {COLUMN_META[column].label}
                  </Badge>
                ) : null}
                {assignee ? (
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3" aria-hidden />
                    {assignee}
                  </span>
                ) : null}
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="inline-flex size-11 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus md:size-7"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <DialogPrimitive.Description className="sr-only">
            Read-only task detail, including its description, latest worker summary, run history,
            comments, and events.
          </DialogPrimitive.Description>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* Orchestration -- the run-control cut: Run / Stop / Reassign. Sits at
                the top because it's the primary thing you DO from a card. Each
                control is gated to when its real backing route can succeed. */}
            {controlCard ? (
              <DrawerSection title="Orchestration" icon={<Cpu className="size-3.5" aria-hidden />}>
                <RunControls card={controlCard} task={task} board={board} assignees={assignees} />
              </DrawerSection>
            ) : null}

            {summary ? (
              <DrawerSection
                title="Latest summary"
                icon={<ScrollText className="size-3.5" aria-hidden />}
              >
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
                  {summary}
                </p>
              </DrawerSection>
            ) : null}

            {body ? (
              <DrawerSection title="Description">
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </DrawerSection>
            ) : null}

            {task && task.runs.length > 0 ? (
              <DrawerSection
                title="Run history"
                icon={<Activity className="size-3.5" aria-hidden />}
              >
                <ul className="flex flex-col gap-2" data-testid="kanban-task-runs">
                  {task.runs.map((run) => (
                    <li
                      key={run.id}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-[12px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {run.profile ?? 'worker'}
                        </span>
                        <span className="text-foreground-tertiary">
                          {run.outcome ?? run.status ?? 'running'}
                        </span>
                        {run.startedAt ? (
                          <span className="ml-auto inline-flex items-center gap-1 tabular-nums text-foreground-tertiary">
                            <Clock className="size-3" aria-hidden />
                            {formatRelative(run.startedAt)}
                          </span>
                        ) : null}
                      </div>
                      {run.summary ? (
                        <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                          {run.summary}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </DrawerSection>
            ) : null}

            {/* Comments — the list (when present) PLUS the composer (the one write
                from the drawer). The composer renders once the task detail has
                loaded and we have a real id; it posts to the real comments route. */}
            {task && taskId ? (
              <DrawerSection
                title="Comments"
                icon={<MessageSquare className="size-3.5" aria-hidden />}
              >
                {task.comments.length > 0 ? (
                  <ul className="mb-2 flex flex-col gap-2">
                    {task.comments.map((comment) => (
                      <li key={comment.id} className="rounded-lg bg-muted/40 px-3 py-2 text-[12px]">
                        <div className="flex items-center gap-2 text-[11px] text-foreground-tertiary">
                          <span className="font-medium text-muted-foreground">
                            {comment.author ?? 'system'}
                          </span>
                          {comment.createdAt ? (
                            <span>{formatRelative(comment.createdAt)}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-foreground/90">
                          {comment.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <CommentComposer taskId={taskId} board={board} />
              </DrawerSection>
            ) : null}

            {task && task.events.length > 0 ? (
              <DrawerSection title="Events">
                <ul className="flex flex-col gap-1 text-[11.5px] text-foreground-tertiary">
                  {task.events.map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{event.kind}</span>
                      {event.createdAt ? (
                        <span className="tabular-nums">{formatRelative(event.createdAt)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </DrawerSection>
            ) : null}

            {isLoading && !task ? (
              <div className="space-y-2" aria-hidden data-testid="kanban-task-skeleton">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2/60" />
                ))}
              </div>
            ) : null}

            {!isLoading &&
            task &&
            !summary &&
            !body &&
            task.runs.length === 0 &&
            task.comments.length === 0 ? (
              <p className="text-[12.5px] text-foreground-tertiary">No detail recorded yet.</p>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function DrawerSection({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="ad-section-label mb-1.5 flex items-center gap-1.5 text-foreground-tertiary">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

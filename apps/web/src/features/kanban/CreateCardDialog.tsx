/**
 * CreateCardDialog — the board composer. A radix Dialog (focus-trap / Esc /
 * ARIA / reduced-motion for free via `ui/dialog`) holding the minimal honest
 * create form: a required title, an optional description, and an optional
 * assignee. On confirm it POSTs to the real `POST /api/plugins/kanban/tasks`
 * route via {@link useCreateTask}; success toasts + closes + the board refetch
 * pulls the new card in, failure surfaces the BFF's real message (no fake
 * success). Create stays disabled until the title is non-empty.
 *
 * A new task lands in the upstream's default lane (triage/todo per the plugin's
 * own rules) — we don't claim a column we don't control, so the form offers no
 * column picker (that's what the per-card MoveMenu is for once it exists).
 *
 * The action accent is governed: the primary Create button is the ONE sanctioned accent here
 * (a primary action); everything else is neutral.
 */
import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useCreateTask } from './hooks'

export interface CreateCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Board slug to create the card on (omit for the active board). */
  board?: string
}

export function CreateCardDialog({ open, onOpenChange, board }: CreateCardDialogProps) {
  const create = useCreateTask(board)
  const titleId = useId()
  const bodyId = useId()
  const assigneeId = useId()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState('')

  const trimmedTitle = title.trim()
  const valid = trimmedTitle.length > 0
  const submitting = create.isPending

  function reset() {
    setTitle('')
    setBody('')
    setAssignee('')
    create.reset()
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return
    if (!next) reset()
    onOpenChange(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || submitting) return
    create.mutate(
      {
        title: trimmedTitle,
        body: body.trim() || undefined,
        assignee: assignee.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Card created')
          reset()
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Couldn’t create the card', {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>
            Add a task to your board. It lands in the queue for your agent to pick up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={titleId} className="text-13 font-medium text-foreground">
              Title
            </label>
            <Input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              autoFocus
              maxLength={500}
              required
              className="font-sans"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={bodyId} className="text-13 font-medium text-foreground">
              Description <span className="text-foreground-tertiary">(optional)</span>
            </label>
            <textarea
              id={bodyId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add detail, links, acceptance criteria…"
              rows={4}
              maxLength={20_000}
              className={cn(
                'ad-surface w-full resize-y rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground shadow-xs outline-none',
                'placeholder:text-foreground-tertiary',
                'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={assigneeId} className="text-13 font-medium text-foreground">
              Assignee <span className="text-foreground-tertiary">(optional)</span>
            </label>
            <Input
              id={assigneeId}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="profile name"
              maxLength={200}
              className="font-sans"
            />
          </div>

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {submitting ? 'Creating…' : 'Create card'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

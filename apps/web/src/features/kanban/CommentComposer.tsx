/**
 * CommentComposer — the drawer's add-a-comment control. A compact textarea +
 * Send that POSTs to the real `POST /api/plugins/kanban/tasks/{id}/comments`
 * route via {@link useAddComment}; success clears the field + invalidates the
 * task (so the new comment appears in the list above) and the board (its comment
 * count badge), failure toasts the real reason. Send stays disabled until the
 * body is non-empty. ⌘/Ctrl+Enter submits (the app's composer convention).
 *
 * The action accent is governed: Send is the ONE sanctioned accent (a primary action).
 */
import { useId, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useAddComment } from './hooks'

export interface CommentComposerProps {
  taskId: string
  board?: string
}

export function CommentComposer({ taskId, board }: CommentComposerProps) {
  const add = useAddComment(board)
  const fieldId = useId()
  const [body, setBody] = useState('')

  const trimmed = body.trim()
  const valid = trimmed.length > 0
  const submitting = add.isPending

  function submit() {
    if (!valid || submitting) return
    add.mutate(
      { id: taskId, input: { body: trimmed } },
      {
        onSuccess: () => setBody(''),
        onError: (err) => {
          toast.error('Couldn’t add the comment', {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // ⌘/Ctrl+Enter sends (matches the chat composer); plain Enter keeps newlines.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="sr-only">
        Add a comment
      </label>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment…"
        rows={2}
        maxLength={20_000}
        className={cn(
          'ad-surface w-full resize-y rounded-lg bg-surface-1 px-3 py-2 text-[12.5px] text-foreground shadow-xs outline-none',
          'placeholder:text-foreground-tertiary',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
        )}
      />
      <div className="flex items-center justify-end">
        <Button type="submit" size="sm" disabled={!valid || submitting}>
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="size-3.5" aria-hidden />
          )}
          {submitting ? 'Sending…' : 'Comment'}
        </Button>
      </div>
    </form>
  )
}

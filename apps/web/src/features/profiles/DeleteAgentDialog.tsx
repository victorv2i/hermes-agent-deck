import { useNavigate } from 'react-router-dom'
import { Loader2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { useDeleteProfile } from './mutations'

/**
 * DeleteAgentDialog — the REAL, irreversible agent delete. Built on `ui/dialog`
 * (radix focus-trap / keyboard / ARIA / reduced-motion). A plain confirm with no
 * fake states: it names the agent and spells out exactly what is removed (soul,
 * memory, skills, .env), and the primary action is destructive-styled so a
 * misclick reads as dangerous.
 *
 * On confirm: DELETE -> the BFF runs guarded `hermes profile delete <name> --yes`
 * -> refetch the roster (the mutation invalidates it) -> navigate Home, so the
 * now-gone agent's workbench is replaced by the active agent (Home resolves the
 * open agent from the live roster once `?agent=` is dropped). Honest failure: the
 * BFF's generic message, the dialog stays open, nothing navigates.
 *
 * The `default` agent cannot be deleted (the CLI reserves it) and the BFF refuses
 * the ACTIVE agent (switch away first); callers hide this affordance for the
 * default and disable it while active, so the dialog is never opened for either.
 */
export function DeleteAgentDialog({
  open,
  name,
  displayName,
  onOpenChange,
}: {
  open: boolean
  name: string
  displayName?: string | null
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const del = useDeleteProfile()
  const friendly = displayName?.trim() || name
  const submitting = del.isPending

  function handleOpenChange(next: boolean) {
    if (!next) del.reset()
    onOpenChange(next)
  }

  async function handleDelete() {
    if (submitting) return
    try {
      await del.mutateAsync(name)
      toast.success(`Deleted ${friendly}`)
      handleOpenChange(false)
      navigate('/', { replace: true })
    } catch (err) {
      toast.error("Couldn't delete the agent", {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {friendly}?</DialogTitle>
          <DialogDescription>
            This permanently removes the agent and everything it owns: its soul, memory, skills, and
            .env. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Trash2 aria-hidden />}
            Delete agent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

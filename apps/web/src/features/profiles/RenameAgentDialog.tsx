import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { PROFILE_ID_RE } from '@agent-deck/protocol'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { GatewayRestartCard } from './GatewayRestartCard'
import { useRenameProfile } from './mutations'

function canonicalizeProfileName(name: string): string {
  return name.trim().toLowerCase()
}

/** The verbatim honest applied line shown after a rename (no quiet dismiss). */
function renameAppliedLine(name: string): string {
  return `Agent renamed to ${name}. This takes effect when your agent restarts.`
}

/**
 * RenameAgentDialog — the REAL rename. Built on `ui/dialog` (radix focus-trap /
 * keyboard / ARIA / reduced-motion). The new name is canonicalized like Hermes
 * (trim + lowercase), then live-validated against the SHARED `PROFILE_ID_RE`;
 * Rename is disabled until the name is valid, not `default`, and differs from
 * the current one.
 *
 * On confirm: POST rename → the BFF runs guarded `hermes profile rename` →
 * refetch the roster (the mutation invalidates it) → navigate to the new
 * `/profiles/:name`. Honest failure: the BFF's generic message, no fake success,
 * no navigation (the agent keeps its old name on disk).
 *
 * The `default` agent cannot be renamed (the CLI reserves it); callers must not
 * offer this dialog for it — the affordance is hidden there, not faked here.
 */
export function RenameAgentDialog({
  open,
  currentName,
  onOpenChange,
}: {
  open: boolean
  currentName: string
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const rename = useRenameProfile()
  const nameId = useId()
  const errId = useId()

  const [name, setName] = useState(currentName)
  // After a successful rename we hold the NEW name and swap the form for a loud
  // applied-state card (mirrors SwitchAgentButton) — never a quiet toast+dismiss.
  const [appliedName, setAppliedName] = useState<string | null>(null)

  // Re-seed the field whenever the dialog (re)opens for a given agent, so it
  // always starts from the current name rather than a stale draft. Uses the
  // adjust-state-during-render pattern (no effect → no cascading render), keyed
  // on open+name so a real edit while open is never clobbered.
  const seedKey = `${open ? '1' : '0'} ${currentName}`
  const [lastSeedKey, setLastSeedKey] = useState(seedKey)
  if (seedKey !== lastSeedKey) {
    setLastSeedKey(seedKey)
    setName(currentName)
    setAppliedName(null)
  }

  const trimmed = name.trim()
  const canonicalName = canonicalizeProfileName(name)
  const defaultReserved = canonicalName === 'default'
  const valid = PROFILE_ID_RE.test(canonicalName) && !defaultReserved
  const unchanged = canonicalName === currentName
  const showError = trimmed.length > 0 && !valid
  const submitting = rename.isPending
  const canSubmit = valid && !unchanged && !submitting

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName(currentName)
      setAppliedName(null)
      rename.reset()
    }
    onOpenChange(next)
  }

  async function handleRename() {
    if (!canSubmit) return
    try {
      await rename.mutateAsync({ oldName: currentName, newName: canonicalName })
      // Honest applied state: the rename landed on disk, but a running gateway
      // still needs a restart to pick it up. Show the loud card, don't navigate
      // until the user dismisses it (so the restart line isn't missed).
      setAppliedName(canonicalName)
    } catch (err) {
      toast.error('Couldn’t rename the agent', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  // Dismiss the applied card → close and land on the agent's new home.
  function finishApplied() {
    const dest = appliedName
    handleOpenChange(false)
    if (dest) navigate(`/profiles/${encodeURIComponent(dest)}`)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{appliedName ? 'Agent renamed' : 'Rename agent'}</DialogTitle>
          <DialogDescription>
            {appliedName
              ? 'The agent kept its soul, memory, and skills.'
              : 'Renames the agent everywhere; its soul, memory, and skills come along.'}
          </DialogDescription>
        </DialogHeader>

        {appliedName ? (
          <div className="grid gap-5">
            {/* Loud applied state: the honest restart-required line plus a real
                browser restart action. */}
            <GatewayRestartCard message={renameAppliedLine(appliedName)} />

            <div className="flex justify-end">
              <Button type="button" onClick={finishApplied}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleRename()
            }}
            className="grid gap-5"
          >
            <div className="grid gap-1.5">
              <label htmlFor={nameId} className="ad-section-label">
                New name
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mercury"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showError || undefined}
                aria-describedby={showError ? errId : undefined}
              />
              {showError && (
                <p id={errId} role="alert" className="text-xs text-destructive">
                  {defaultReserved ? (
                    'Default is already your built-in agent.'
                  ) : (
                    <>
                      Use letters, numbers, <code className="font-mono">-</code> or{' '}
                      <code className="font-mono">_</code> (start with a letter or number). Names
                      save lowercase.
                    </>
                  )}
                </p>
              )}
            </div>

            <p className="text-xs leading-relaxed text-foreground-tertiary">
              If your agent is running, restart it afterwards to pick up the new name.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting && <Loader2 className="animate-spin" />}
                Rename
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

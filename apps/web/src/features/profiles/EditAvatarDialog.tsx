import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AvatarId } from '@agent-deck/protocol'
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
import { AvatarPicker } from './AvatarPicker'
import { useWriteAvatar } from './mutations'

/**
 * EditAvatarDialog — edit an existing agent's IDENTITY (its face + display name)
 * from its hub. Reuses the same keyboard/SR `AvatarPicker` (identity ring, never
 * the action accent). The display name is the friendly label shown everywhere the agent
 * appears (the chip, the tab title, the hub heading); it does NOT rename the
 * underlying profile id (that's the separate, CLI-backed Rename). Clearing it
 * falls back to the real profile id. Confirm is the one sky-blue action; on success
 * it persists via the partial-merge `PUT .../avatar` (sending the avatar always,
 * and the display name only when it changed — so a face-only edit never wipes the
 * name and vice-versa) and refetches so every surface updates at once.
 */
export function EditAvatarDialog({
  open,
  onOpenChange,
  name,
  current,
  displayName = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  /** The currently resolved avatar id (the pre-selected tile). */
  current: AvatarId
  /** The agent's current display name (pre-fills the field), or null when unset. */
  displayName?: string | null
}) {
  const writeAvatar = useWriteAvatar()
  const nameId = useId()
  const [picked, setPicked] = useState<AvatarId>(current)
  const [draftName, setDraftName] = useState(displayName ?? '')
  // Reset the picked value + display-name draft from the current props whenever the
  // dialog (re)opens, so a stale selection from a prior unsaved session never leaks
  // into a reopen. Done as a render-time adjustment (React's "adjusting state on a
  // prop change" pattern) rather than an effect, avoiding a cascading setState.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setPicked(current)
      setDraftName(displayName ?? '')
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
  }

  const currentName = displayName ?? ''
  const nameChanged = draftName.trim() !== currentName.trim()

  async function handleSave() {
    try {
      await writeAvatar.mutateAsync({
        name,
        avatar: picked,
        // Only forward the display name when it actually changed — so a pure face
        // edit omits it (preserving any existing name on the BFF). A blank draft
        // is a deliberate clear (the BFF resets to the profile id).
        ...(nameChanged ? { displayName: draftName.trim() } : {}),
      })
      toast.success('Identity updated')
      onOpenChange(false)
    } catch (err) {
      toast.error('Couldn’t update this agent’s identity', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit identity</DialogTitle>
          <DialogDescription>
            Choose {name}&apos;s face and a display name; they show everywhere this agent appears.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="ad-section-label">
            Display name
          </label>
          <Input
            id={nameId}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={name}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
          />
          <p className="text-xs leading-relaxed text-foreground-tertiary">
            A friendly name shown in the UI. Leave blank to use the agent&apos;s id (&nbsp;
            <span className="font-mono">{name}</span>&nbsp;). This doesn&apos;t rename the agent on
            disk.
          </p>
        </div>

        <AvatarPicker
          value={picked}
          name={draftName.trim() || name}
          onChange={setPicked}
          className="py-1"
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={writeAvatar.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={writeAvatar.isPending}>
            {writeAvatar.isPending && <Loader2 className="animate-spin" />}
            Save identity
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

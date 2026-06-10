import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function SessionLabelDialog({
  open,
  title,
  value,
  onSave,
  onOpenChange,
}: {
  open: boolean
  title: string
  value: string
  onSave: (value: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <SessionLabelForm
          key={`${open ? 'open' : 'closed'}:${title}:${value}`}
          title={title}
          value={value}
          onSave={onSave}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function SessionLabelForm({
  title,
  value,
  onSave,
  onOpenChange,
}: {
  title: string
  value: string
  onSave: (value: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const inputId = useId()
  const [draft, setDraft] = useState(value)

  function save() {
    onSave(draft)
    onOpenChange(false)
  }

  function clear() {
    onSave('')
    onOpenChange(false)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Label this session</DialogTitle>
        <DialogDescription>
          Hermes does not rename sessions yet. Agent Deck stores this label in this browser only.
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor={inputId} className="ad-section-label">
            Local label
          </label>
          <Input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={title}
            autoComplete="off"
          />
          <p className="text-xs leading-relaxed text-foreground-tertiary">
            The original Hermes title stays unchanged.
          </p>
        </div>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={clear} disabled={!value}>
            Clear label
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save label</Button>
          </div>
        </div>
      </form>
    </>
  )
}

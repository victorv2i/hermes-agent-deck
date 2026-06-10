/**
 * NewSkillDialog — create a new skill from the minimal template. Asks for a name
 * (and an optional category), live-validates both against the SAME segment rule
 * the BFF path-guard enforces (`^[a-z0-9][a-z0-9_-]*$`), and on confirm POSTs to
 * the create route → the BFF writes `<category?>/<name>/SKILL.md` from a minimal
 * template → the list invalidates so the new row appears → the editor opens on it.
 *
 * Honest failure: a name the server rejects (or one already taken) surfaces the
 * BFF message inline; nothing is created and the dialog stays open.
 */
import { useId, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateSkill } from './useSkills'

/** A valid single skill/category segment (mirrors the BFF SEGMENT_RE). */
const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/

export function NewSkillDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the created skill's relative path (so the caller can open it). */
  onCreated?: (path: string, name: string) => void
}) {
  const create = useCreateSkill()
  const nameId = useId()
  const catId = useId()
  const errId = useId()

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')

  // Reset the form whenever the dialog (re)opens (adjust-state-during-render).
  const seedKey = open ? 'open' : 'closed'
  const [lastSeed, setLastSeed] = useState(seedKey)
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey)
    if (open) {
      setName('')
      setCategory('')
      create.reset()
    }
  }

  const nameValid = SEGMENT_RE.test(name)
  const catValid = category === '' || SEGMENT_RE.test(category)
  const canCreate = nameValid && catValid && !create.isPending
  const serverError = create.isError
    ? create.error instanceof Error
      ? create.error.message
      : 'Create failed'
    : null

  const handleCreate = async () => {
    if (!canCreate) return
    const { path } = await create.mutateAsync({
      name,
      category: category === '' ? null : category,
    })
    onOpenChange(false)
    if (path) onCreated?.(path, name)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-md" showClose={!create.isPending}>
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            Creates a starter <span className="font-mono">SKILL.md</span> you can edit right away.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-xs font-medium text-foreground">
              Name
            </label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              placeholder="my-skill"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={name !== '' && !nameValid}
              aria-describedby={name !== '' && !nameValid ? errId : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {name !== '' && !nameValid && (
              <p id={errId} className="text-xs text-destructive">
                Use lowercase letters, numbers, dashes or underscores (start with a letter or
                number).
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={catId} className="text-xs font-medium text-foreground">
              Category <span className="text-foreground-tertiary">(optional)</span>
            </label>
            <Input
              id={catId}
              value={category}
              placeholder="creative"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!catValid}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          {serverError && <p className="text-xs text-destructive">{serverError}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

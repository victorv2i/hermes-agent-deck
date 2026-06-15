/**
 * SkillEditorDialog — edit a skill's primary body (SKILL.md) in the SAME
 * CodeMirror markdown editor the SOUL/Memory surface uses (reused verbatim via
 * `features/files/CodeEditor`, lazily loaded). NOT a new editor.
 *
 * HONEST SCOPE (load-bearing): a skill may carry linked files (README, scripts/,
 * references/) and frontmatter pointing at them. This surface edits ONLY the
 * primary SKILL.md body; when extra files exist, a plain note says the rest is
 * out of scope here (no fake "edited everything" claim). The dashboard/CLI still
 * own enable/disable — this only rewrites the body the user owns on disk.
 *
 * On Save: PUT the body → invalidate that body's cache → close. Honest failure:
 * the BFF's message is surfaced inline, the dialog stays open, the file on disk
 * is unchanged.
 */
import { lazy, Suspense, useState } from 'react'
import { FileWarning, Loader2, Save, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSkillBody, useWriteSkillBody } from './useSkills'

const CodeEditor = lazy(() => import('@/features/files/CodeEditor'))

export function SkillEditorDialog({
  open,
  path,
  name,
  onOpenChange,
}: {
  open: boolean
  /** The skill's on-disk relative path (e.g. `creative/ascii-art`). */
  path: string
  /** The skill's display name (the dialog title). */
  name: string
  onOpenChange: (open: boolean) => void
}) {
  const body = useSkillBody(open ? path : null)
  const write = useWriteSkillBody(path)

  const [draft, setDraft] = useState('')
  // Seed the draft from the loaded content once per open (adjust-state-during-
  // render — no effect, no cascading render), keyed on open+path so re-opening a
  // different skill re-seeds but a live edit is never clobbered.
  const seedKey = `${open ? '1' : '0'} ${path} ${body.data?.content ?? '∅'}`
  const [lastSeedKey, setLastSeedKey] = useState('')
  if (open && body.data && seedKey !== lastSeedKey) {
    setLastSeedKey(seedKey)
    setDraft(body.data.content)
  }

  const dirty = body.data ? draft !== body.data.content : false
  const saveError = write.isError
    ? write.error instanceof Error
      ? write.error.message
      : 'Save failed'
    : null

  const handleSave = async () => {
    await write.mutateAsync(draft)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && write.isPending) return // never close mid-save
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-2xl" showClose={!write.isPending}>
        <DialogHeader>
          <DialogTitle className="font-mono">{name}</DialogTitle>
          <DialogDescription>
            Editing this skill's <span className="font-mono">SKILL.md</span>: the body the agent
            reads.
          </DialogDescription>
        </DialogHeader>

        {/* Honest scope note: only the primary body is edited here. */}
        {body.data?.hasExtraFiles && (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md bg-surface-1/40 px-3 py-2 text-xs leading-relaxed text-foreground-tertiary"
          >
            <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This skill also has linked files (scripts, references). This editor changes the main{' '}
              <span className="font-mono">SKILL.md</span> only. Edit the rest in Files.
            </span>
          </p>
        )}

        {saveError && (
          <p className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {saveError}
          </p>
        )}

        <div className="max-h-[52vh] min-h-[200px] overflow-auto rounded-md border border-border">
          {body.isLoading ? (
            <div className="flex items-center justify-center py-12 text-foreground-tertiary">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : body.isError ? (
            <p className="p-8 text-center text-sm text-foreground-tertiary">
              {body.error instanceof Error ? body.error.message : "Couldn't load this skill."}
            </p>
          ) : (
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12 text-foreground-tertiary">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              }
            >
              <CodeEditor value={draft} onChange={setDraft} filename="SKILL.md" />
            </Suspense>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={write.isPending}>
            <X />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!dirty || write.isPending || body.isLoading}>
            {write.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

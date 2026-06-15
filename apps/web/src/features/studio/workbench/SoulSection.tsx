import { lazy, Suspense, useEffect, useState } from 'react'
import { Check, Loader2, Pencil, Save, ServerCog, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/state'
import { CodeView } from '@/features/files/CodeView'
import type { SoulFile } from '../data/api'

const CodeEditor = lazy(() => import('@/features/files/CodeEditor'))

/**
 * SoulSection — the per-agent SOUL.md editor in the Studio workbench, backed by
 * `GET/PUT /api/profiles/{name}/soul` (NOT a hand-written profile file). Reads the
 * plain-text soul, edits it in CodeMirror (lazily loaded), and saves through the
 * scoped write.
 *
 * Presentational: soul/loading/error + the `onSave` write arrive as props (the
 * route runs the scoped query/mutation). `onDirtyChange` surfaces unsaved-edit
 * state so a parent can guard navigation away from a half-written soul. Reuses
 * the app's CodeEditor/CodeView so the soul reads as part of the app.
 */
export interface SoulSectionProps {
  soul: SoulFile | undefined
  isLoading: boolean
  error: string | null
  /** Save the soul content (the route runs the scoped PUT). */
  onSave: (content: string) => void | Promise<void>
  /** True while a save is in flight. */
  isSaving?: boolean
  /** Surface unsaved-edit state to a parent route-change guard. */
  onDirtyChange?: (dirty: boolean) => void
}

export function SoulSection({
  soul,
  isLoading,
  error,
  onSave,
  isSaving = false,
  onDirtyChange,
}: SoulSectionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const content = soul?.content ?? ''
  const dirty = editing && draft !== content

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load the soul"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }

  const beginEditing = () => {
    setDraft(content)
    setEditing(true)
  }

  const handleSave = async () => {
    await onSave(draft)
    setEditing(false)
    setJustSaved(true)
    window.setTimeout(() => setJustSaved(false), 1800)
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Header: filename pill + honest note + Edit/Save actions. */}
      <div className="flex items-center gap-2.5 border-b border-border px-1 py-3">
        <Badge variant="muted" className="shrink-0 font-mono lowercase">
          SOUL.md
        </Badge>
        <span className="min-w-0 truncate text-xs text-foreground-tertiary">
          The agent's personality and instructions. Your file, safe to edit.
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {justSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" aria-hidden /> Saved
            </span>
          )}
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={beginEditing} disabled={isLoading}>
              <Pencil aria-hidden />
              Edit
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={isSaving}>
                <X aria-hidden />
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || isSaving}>
                {isSaving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="max-h-[460px] min-h-[180px] flex-1 overflow-auto rounded-b-lg">
        {isLoading ? (
          <div className="space-y-2.5 px-1 py-5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted/50"
                style={{ width: `${90 - i * 8}%` }}
              />
            ))}
          </div>
        ) : !soul?.exists && !editing ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="max-w-sm text-sm text-foreground-tertiary">
              No soul yet for this agent. Click Edit to write one.
            </p>
          </div>
        ) : editing ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-10 text-foreground-tertiary">
                <Loader2 className="size-5 animate-spin" aria-hidden />
              </div>
            }
          >
            <CodeEditor value={draft} onChange={setDraft} filename="SOUL.md" />
          </Suspense>
        ) : (
          <CodeView code={content} lang="markdown" />
        )}
      </div>
    </div>
  )
}

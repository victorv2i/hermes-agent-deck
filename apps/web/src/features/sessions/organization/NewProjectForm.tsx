import { useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PROJECT_COLORS, DEFAULT_PROJECT_COLOR, projectColorVar } from './projectPalette'

/**
 * The "+ New project" form: a name input + a color picker drawn from the curated
 * categorical palette. Submits `{ name, color }` to the caller (which fires the
 * create mutation). Deliberately quiet — no amber chrome until the primary
 * "Create" action. The color swatches are a labelled radiogroup so the picker is
 * fully keyboard + screen-reader navigable.
 */
export function NewProjectForm({
  onCreate,
  onCancel,
  busy = false,
  error = null,
}: {
  onCreate: (input: { name: string; color: string }) => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_PROJECT_COLOR)
  const trimmed = name.trim()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (trimmed === '' || busy) return
    onCreate({ name: trimmed, color })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 p-1">
      <input
        type="text"
        aria-label="Folder name"
        placeholder="Folder name"
        value={name}
        autoFocus
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className={cn(
          'w-full rounded-[8px] border border-border bg-surface-2/50 px-2.5 py-1.5 text-[13px]',
          'text-foreground placeholder:text-foreground-tertiary',
          'focus-visible:border-ring focus-visible:ad-focus',
        )}
      />

      <div role="radiogroup" aria-label="Folder color" className="flex flex-wrap gap-2 px-0.5">
        {PROJECT_COLORS.map((c) => {
          const selected = c.id === color
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.label}
              title={c.label}
              onClick={() => setColor(c.id)}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-full transition-transform motion-reduce:transition-none',
                'focus-visible:ad-focus',
                'hover:scale-110 motion-reduce:hover:scale-100',
                // Selection ring is border-strong, never --ring (== --primary). (spine)
                selected && 'ring-2 ring-[var(--border-strong)] ring-offset-1 ring-offset-popover',
              )}
              style={{ backgroundColor: projectColorVar(c.id) }}
            >
              {selected && <Check className="size-4 text-background" aria-hidden />}
            </button>
          )
        })}
      </div>

      {error && <p className="px-0.5 text-[11px] text-destructive">{error}</p>}

      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={trimmed === '' || busy}>
          Create
        </Button>
      </div>
    </form>
  )
}

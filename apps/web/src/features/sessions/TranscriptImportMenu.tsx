import { useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { parseTranscript } from './import'
import type { SessionDetail, SessionMessage } from './types'

/**
 * The transcript import control (Lane D) — the symmetric inverse of the export
 * menu. A quiet icon trigger → popover with two ways in: choose a file, or paste
 * a transcript. On success it hands the parsed `{ session, messages }` to the
 * parent via `onImport`; on failure it shows a CALM inline error (role="alert")
 * and imports nothing.
 *
 * HONEST BOUNDARY: import is a LOCAL read-only mirror of export. It NEVER writes
 * to hermes session storage and calls no hermes endpoint — the parsed transcript
 * is shown as a local read-only view, labeled as such by the parent. The note in
 * the popover says so plainly.
 */
export function TranscriptImportMenu({
  onImport,
}: {
  /** Receives the parsed transcript for a local read-only render. */
  onImport: (session: SessionDetail | null, messages: SessionMessage[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    const result = parseTranscript(raw)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onImport(result.session, result.messages)
    toast.success('Transcript imported', {
      description: `${result.messages.length} message${result.messages.length === 1 ? '' : 's'} · read-only`,
    })
    // Reset and close on success.
    setText('')
    setError(null)
    setOpen(false)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const raw = await file.text()
      commit(raw)
    } catch {
      setError("Couldn't read that file. Try pasting the transcript instead.")
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Import transcript"
          title="Import transcript"
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 text-13 text-muted-foreground transition-colors',
            'hover:border-border-strong hover:text-foreground',
            'focus-visible:ad-focus',
          )}
        >
          <Upload className="size-3.5" aria-hidden />
          Import
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={8}
          className="ad-surface z-50 w-80 rounded-xl bg-popover p-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex flex-col gap-2.5">
            <div>
              <p className="text-13 font-medium text-foreground">Import a transcript</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-tertiary">
                Open an exported transcript (JSON or Markdown) as a local read-only view. Nothing is
                written to hermes.
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2 py-1.5 text-13 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:ad-focus"
              >
                <Upload className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
                Choose a file
              </button>
              <input
                ref={fileRef}
                data-testid="transcript-import-file"
                type="file"
                accept=".json,.md,.markdown,application/json,text/markdown,text/plain"
                className="sr-only"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0])
                  // Allow re-selecting the same file later.
                  e.target.value = ''
                }}
              />
            </div>

            <div className="flex items-center gap-2" aria-hidden>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-foreground-tertiary">
                or paste
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <textarea
              aria-label="Paste transcript"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (error) setError(null)
              }}
              rows={5}
              placeholder="Paste exported JSON or Markdown…"
              className="w-full resize-y rounded-lg border border-border bg-surface-2/40 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-foreground-tertiary focus-visible:ad-focus"
            />

            {error && (
              <p role="alert" className="text-[12px] leading-relaxed text-destructive">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => commit(text)}
              disabled={text.trim() === ''}
              className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-2 py-1.5 text-13 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ad-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open read-only
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

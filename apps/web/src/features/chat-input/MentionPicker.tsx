/**
 * @-mention file picker (PRESENTATIONAL) — type `@` in the composer to reference
 * a workspace file.
 *
 * Given a list of file results and a query, it renders a calm, keyboard-
 * navigable popdown (↑/↓ move, Enter selects, Esc closes). It takes the results
 * + `onSelect`/`onClose` as props; the composer (the Integration agent) owns the
 * textarea, the `@`-query extraction, and inserting the chosen workspace-relative
 * path into the text. The data hook lives in the sibling `useFileMentions.ts`.
 *
 * Selecting returns the workspace-relative path string so the composer inserts a
 * readable reference (e.g. `@src/index.ts`) that the agent resolves with its own
 * file tools.
 *
 * Token-driven, all themes; amber is reserved for the active row only. a11y: a
 * labelled listbox with roving `aria-selected`. LOCAL-ONLY.
 */
import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A single file result offered in the picker. */
export interface MentionFile {
  /** Display name (the basename). */
  name: string
  /** Root-relative POSIX path — the value inserted into the message. */
  path: string
}

export interface MentionPickerProps {
  /** The current `@`-query (the text after the `@`, lowercased by the caller or not). */
  query: string
  /** The file results to offer (already fetched, e.g. via `useFileMentions`). */
  results: MentionFile[]
  /** Commit a file: the composer inserts its workspace-relative `path`. */
  onSelect: (path: string) => void
  /** Dismiss the picker (Esc, or the caller's own logic). */
  onClose: () => void
  /** Whether results are still loading (shows a calm hint, not a spinner). */
  loading?: boolean
  className?: string
}

/**
 * The presentational `@`-file picker. Self-contained keyboard handling on a
 * focusable listbox so it works whether or not the composer forwards key events:
 * the composer can simply render this below the textarea while a mention is
 * active and let it own ↑/↓/Enter/Esc.
 */
export function MentionPicker({
  query,
  results,
  onSelect,
  onClose,
  loading = false,
  className,
}: MentionPickerProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset the active row whenever the result set changes (a new query), using
  // React's adjust-state-during-render pattern (no effect → no cascading render),
  // mirroring FileBrowser's listing-key reset.
  const [lastResults, setLastResults] = useState(results)
  if (results !== lastResults) {
    setLastResults(results)
    setActiveIndex(0)
  }

  // Keep the active row in view as it moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = results[activeIndex]
      if (chosen) onSelect(chosen.path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const empty = !loading && results.length === 0

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mention a workspace file"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        'ad-surface max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] focus:outline-none',
        className,
      )}
    >
      {loading && (
        <div className="px-2 py-1.5 text-[13px] text-muted-foreground" role="status">
          Searching files...
        </div>
      )}
      {empty && (
        <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
          {query ? `No files match "${query}"` : 'Type to search files'}
        </div>
      )}
      {results.map((file, i) => {
        const active = i === activeIndex
        return (
          <button
            key={file.path}
            type="button"
            role="option"
            aria-selected={active}
            data-active={active}
            // Pointer hover previews selection without committing.
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => onSelect(file.path)}
            className={cn(
              'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none sm:min-h-10',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <FileText className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
            <span className="shrink-0 truncate text-[11px] text-foreground-tertiary">
              {file.path}
            </span>
          </button>
        )
      })}
    </div>
  )
}

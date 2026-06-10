/**
 * BulkSessionBar — the floating action bar that appears in the session rail
 * when multi-select mode is active and at least one session is checked.
 *
 * Design spine:
 *  - Accent (--primary) only on the destructive bulk-delete button. Archive and
 *    Export use neutral/outline styles (selection is var(--border-strong), not accent).
 *  - SR: role="status" aria-live="polite" announces the count. All controls are
 *    real <button> elements — keyboard-reachable, no div-buttons.
 *  - Reduced-motion safe: no transition animation on the bar itself.
 */
import { Archive, Download, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BulkSessionBarProps {
  /** Number of currently-selected sessions. */
  selectedCount: number
  /** Total visible sessions (used to determine whether "select all" is meaningful). */
  totalCount: number
  /** Whether ALL visible sessions are already selected. */
  allVisibleSelected: boolean
  /** Select all visible sessions. */
  onSelectAll: () => void
  /** Clear the entire selection (and exit multi-select mode). */
  onClearSelection: () => void
  /** Archive all selected sessions. */
  onArchive: () => void
  /** Trigger bulk delete (caller owns the confirm dialog). */
  onDelete: () => void
  /** Export all selected sessions. */
  onExport: () => void
}

/**
 * The bulk-action bar. Mounts below the search box when at least one session
 * is selected (the rail drives visibility). Status copy is the sole SR cue:
 * "N selected" in a role=status/aria-live=polite region.
 */
export function BulkSessionBar({
  selectedCount,
  totalCount,
  allVisibleSelected,
  onSelectAll,
  onClearSelection,
  onArchive,
  onDelete,
  onExport,
}: BulkSessionBarProps) {
  return (
    <div
      className={cn(
        // flex-wrap is the final safety net: at any width the controls wrap onto a
        // second line rather than clipping / overflowing the rail.
        'flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border-strong bg-surface-2 px-2 py-1.5',
        'text-[12px]',
      )}
      role="group"
      aria-label="Bulk session actions"
    >
      {/* On a narrow rail/phone the action labels collapse to their icons (the
          aria-label + title keep each control named), so the bar never overflows
          horizontally; the labels return from sm: up. */}
      {/* SR-announced count (aria-live="polite" via role="status") */}
      <span
        role="status"
        aria-live="polite"
        className="shrink-0 font-medium text-foreground sm:min-w-[4rem]"
      >
        {selectedCount} selected
      </span>

      {/* Select-all / clear affordance */}
      {!allVisibleSelected && totalCount > selectedCount ? (
        <button
          type="button"
          onClick={onSelectAll}
          aria-label="Select all visible sessions"
          className={cn(
            // Same 44px-on-mobile treatment as the action buttons below.
            'flex min-h-11 shrink-0 touch-manipulation items-center rounded px-1.5 text-foreground-tertiary transition-colors sm:min-h-0 sm:py-0.5',
            'hover:bg-muted hover:text-foreground',
            'focus-visible:ad-focus',
          )}
        >
          Select all
        </button>
      ) : null}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Export */}
      <button
        type="button"
        onClick={onExport}
        aria-label="Export selected sessions"
        title="Export selected"
        className={cn(
          // 44px touch target on mobile (the labels are icon-only there); compact
          // on sm+ where the labels return.
          'flex min-h-11 min-w-11 touch-manipulation items-center justify-center gap-1 rounded text-foreground-tertiary transition-colors sm:min-h-0 sm:min-w-0 sm:px-1.5 sm:py-0.5',
          'hover:bg-muted hover:text-foreground',
          'focus-visible:ad-focus',
        )}
      >
        <Download className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Export selected</span>
      </button>

      {/* Archive */}
      <button
        type="button"
        onClick={onArchive}
        aria-label="Archive selected sessions"
        title="Archive selected"
        className={cn(
          'flex min-h-11 min-w-11 touch-manipulation items-center justify-center gap-1 rounded text-foreground-tertiary transition-colors sm:min-h-0 sm:min-w-0 sm:px-1.5 sm:py-0.5',
          'hover:bg-muted hover:text-foreground',
          'focus-visible:ad-focus',
        )}
      >
        <Archive className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Archive selected</span>
      </button>

      {/* Delete — uses primary/destructive accent (the one destructive action) */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete selected sessions"
        title="Delete selected"
        className={cn(
          'flex min-h-11 min-w-11 touch-manipulation items-center justify-center gap-1 rounded transition-colors sm:min-h-0 sm:min-w-0 sm:px-1.5 sm:py-0.5',
          'text-destructive hover:bg-destructive/10',
          'focus-visible:ad-focus',
        )}
      >
        <Trash2 className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Delete selected</span>
      </button>

      {/* Clear / exit multi-select */}
      <button
        type="button"
        onClick={onClearSelection}
        aria-label="Clear selection"
        title="Clear selection"
        className={cn(
          'ml-0.5 flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded text-foreground-tertiary transition-colors sm:size-5 sm:min-h-0 sm:min-w-0',
          'hover:bg-muted hover:text-foreground',
          'focus-visible:ad-focus',
        )}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/**
 * The per-row checkbox overlay shown in multi-select mode. Rendered outside the
 * row <button> (a checkbox inside a button is invalid HTML); it sits in the same
 * relative container as the row actions overlay.
 */
export function RowSelectCheckbox({
  sessionId,
  label,
  checked,
  onChange,
}: {
  sessionId: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={`sel-${sessionId}`}
      className="absolute left-1 top-1/2 z-10 flex -translate-y-1/2 touch-manipulation items-center"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        id={`sel-${sessionId}`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className={cn(
          'size-4 cursor-pointer rounded border-border-strong bg-surface-1 accent-primary',
          'focus-visible:ad-focus',
        )}
      />
    </label>
  )
}

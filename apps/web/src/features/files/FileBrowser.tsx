/**
 * FileBrowser — the left pane of the Files surface: a root selector, a
 * breadcrumb, and a single-level directory listing (the dashboard lists one
 * depth at a time). Clicking a folder navigates into it; clicking a file
 * selects it for the preview pane. Suppressed entries (secrets / unsupported)
 * render disabled with a quiet reason.
 *
 * Design-language: calm warm-void surface, hairline rows, amber active state,
 * generous hit targets, focus-visible rings. Folders sort before files (the BFF
 * already sorts; we keep its order).
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Popover } from 'radix-ui'
import {
  Check,
  ChevronsLeft,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderPlus,
  FolderX,
  HardDrive,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/state'
import { glyphFor } from './fileIcons'
import { fuzzyMatch } from './fuzzy'
import type { FileEntry, FileRoot } from './api'

export interface FileBrowserProps {
  roots: FileRoot[]
  activeRoot: FileRoot | null
  onSelectRoot: (rootId: string) => void
  /** Current directory (root-relative POSIX path, "" = root). */
  path: string
  onNavigate: (path: string) => void
  entries: FileEntry[]
  loading: boolean
  error?: string | null
  truncated?: boolean
  /** Currently-open file path (for active highlight), if any. */
  selectedPath: string | null
  onOpenFile: (entry: FileEntry) => void
  onNewFile: () => void
  onNewFolder: () => void
  onRefresh: () => void
  /** Begin renaming an entry (hover action). */
  onRename: (entry: FileEntry) => void
  /** Delete an entry (hover action; caller confirms). */
  onDelete: (entry: FileEntry) => void
  /**
   * §2(d) — collapse the Files tree (mirrors the sessions pane's ⌘B gesture).
   * When provided, a collapse toggle is rendered in the compact header; the
   * FilesRoute owns the collapsed state + the actual column width. Omitted ⇒ no
   * toggle (the tree is always shown).
   */
  onToggleCollapsed?: () => void
}

interface Crumb {
  label: string
  path: string
}

function buildCrumbs(path: string): Crumb[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  const crumbs: Crumb[] = []
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Estimated listing-row height (px) before measurement — one entry button. */
const FILE_ROW_ESTIMATE = 36

export function FileBrowser({
  roots,
  activeRoot,
  onSelectRoot,
  path,
  onNavigate,
  entries,
  loading,
  error,
  truncated,
  selectedPath,
  onOpenFile,
  onNewFile,
  onNewFolder,
  onRefresh,
  onRename,
  onDelete,
  onToggleCollapsed,
}: FileBrowserProps) {
  const crumbs = useMemo(() => buildCrumbs(path), [path])

  // I1 (read-only Files): v1 roots default to read-only. When the active root is
  // read-only we honestly disable every write affordance (New file/folder,
  // rename, delete) with a clear tooltip rather than letting the user attempt a
  // write the server will 403. No active root → also nothing to write to.
  const readOnly = !activeRoot || activeRoot.readOnly === true
  const writeBlockedTitle = !activeRoot ? 'Select a root first' : 'This root is read-only'

  // T2.6 — fuzzy "go to file" filter over the current directory's listing (a
  // conspicuous gap next to the rail's session search). Subsequence match, kept
  // client-side because the BFF already returns a single level at a time.
  const [filter, setFilter] = useState('')
  // §2(d) — the filter input is keystroke-revealed (not an always-present band):
  // a "Find file" toggle (or the `/` keystroke from the listing) reveals it,
  // keeping the header compact. Escape hides + clears it.
  const [filterOpen, setFilterOpen] = useState(false)
  const filterInputRef = useRef<HTMLInputElement | null>(null)
  // Focus the filter input the moment it mounts (so the Find-file toggle / `/`
  // keystroke land the cursor in it). A layout effect runs synchronously after
  // the input renders, so focus moves before the user's next keystroke.
  const wantsFilterFocus = useRef(false)
  const revealFilter = () => {
    wantsFilterFocus.current = true
    setFilterOpen(true)
  }
  const hideFilter = () => {
    setFilter('')
    setFilterOpen(false)
  }
  useLayoutEffect(() => {
    if (filterOpen && wantsFilterFocus.current) {
      wantsFilterFocus.current = false
      filterInputRef.current?.focus()
    }
  }, [filterOpen])

  // T2.7 — roving-tabindex keyboard model + focus restoration. Refs to each
  // enabled (non-suppressed) entry button let Arrow/Home/End move DOM focus and
  // let navigation restore focus into the new listing instead of dropping to
  // <body>. Suppressed rows are skipped (their buttons are disabled).
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  // The entry index that is currently in the tab order.
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset the filter + roving index whenever the directory or root changes, using
  // React's adjust-state-during-render pattern (no effect → no cascading render).
  // A stale filter from a different folder would otherwise silently hide
  // everything, and a stale active index could point past the new listing.
  const listingKey = `${activeRoot?.id ?? ''}:${path}`
  const [lastListingKey, setLastListingKey] = useState(listingKey)
  if (listingKey !== lastListingKey) {
    setLastListingKey(listingKey)
    setFilter('')
    setFilterOpen(false)
    setActiveIndex(0)
  }

  const visibleEntries = useMemo(
    () => entries.filter((e) => fuzzyMatch(e.name, filter)),
    [entries, filter],
  )
  const navigableIndexes = useMemo(
    () => visibleEntries.map((e, i) => (e.suppressed ? -1 : i)).filter((i) => i >= 0),
    [visibleEntries],
  )

  // The listing is VIRTUALIZED (large dirs are server-capped at 1000 entries, so
  // a deep folder would otherwise mount up to 1000 row buttons). The scroll
  // element is the listing container below; only the visible window (+ overscan)
  // mounts. The roving-tabindex keyboard model is preserved by SCROLLING a target
  // row into view before focusing it (focusRowAt), since an off-screen target's
  // button isn't mounted yet.
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => FILE_ROW_ESTIMATE,
    overscan: 6,
    getItemKey: (index) => visibleEntries[index]?.path ?? index,
  })

  // Focus a row by index, scrolling it into the window first so its button has
  // mounted. If it's already mounted we focus synchronously; otherwise we focus on
  // the next frame once the virtualizer has rendered the now-visible row.
  const focusRowAt = (index: number) => {
    setActiveIndex(index)
    const existing = rowRefs.current[index]
    if (existing) {
      existing.focus()
      return
    }
    rowVirtualizer.scrollToIndex(index, { align: 'auto' })
    requestAnimationFrame(() => rowRefs.current[index]?.focus())
  }

  // Navigation requests focus into the first row of the freshly-loaded listing;
  // a layout effect performs the imperative .focus() once that listing renders.
  // It only moves focus (no setState), so it never cascades renders. The flag is
  // set by navigateTo so a background refetch or initial mount never steals focus.
  // The first navigable row is always inside the initial (top) virtual window, so
  // its button is mounted by commit time and focuses synchronously; the rAF
  // fallback covers the (rare) case where it isn't yet measured.
  const wantsFocusRestore = useRef(false)
  useLayoutEffect(() => {
    if (!wantsFocusRestore.current) return
    wantsFocusRestore.current = false
    const first = navigableIndexes[0]
    if (first === undefined) return
    const btn = rowRefs.current[first]
    if (btn) btn.focus()
    else requestAnimationFrame(() => rowRefs.current[first]?.focus())
  }, [listingKey, navigableIndexes])

  const focusRow = (index: number) => {
    focusRowAt(index)
  }

  const moveFocus = (current: number, delta: number) => {
    if (navigableIndexes.length === 0) return
    const pos = navigableIndexes.indexOf(current)
    const nextPos =
      pos === -1 ? 0 : (pos + delta + navigableIndexes.length) % navigableIndexes.length
    const target = navigableIndexes[nextPos]
    if (target !== undefined) focusRow(target)
  }

  const onRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(index, 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(index, -1)
        break
      case 'Home':
        e.preventDefault()
        if (navigableIndexes[0] !== undefined) focusRow(navigableIndexes[0])
        break
      case 'End':
        e.preventDefault()
        if (navigableIndexes.length) focusRow(navigableIndexes[navigableIndexes.length - 1]!)
        break
      case '/':
        // §2(d) — `/` from the listing reveals the keystroke-hidden filter, like a
        // file picker's quick-find. (Only when there's a listing to filter.)
        if (entries.length > 0) {
          e.preventDefault()
          revealFilter()
        }
        break
    }
  }

  const navigateTo = (target: string) => {
    wantsFocusRestore.current = true
    onNavigate(target)
  }

  // The single row that carries tabindex=0. If the tracked activeIndex isn't a
  // navigable row (e.g. it pointed at a now-filtered-out or blocked entry), fall
  // back to the first navigable row so the listing always has one tab stop.
  const tabbableIndex = navigableIndexes.includes(activeIndex)
    ? activeIndex
    : (navigableIndexes[0] ?? -1)

  const listingId = useId()

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1" data-testid="file-browser">
      {/* T2.7 — skip link: the first focusable element jumps a keyboard user past
          the breadcrumb / root picker / write actions straight to the listing.
          Visually hidden until focused (focus-visible reveals it). */}
      <a
        href={`#${listingId}`}
        className="sr-only rounded-md bg-card px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border focus-visible:not-sr-only focus-visible:absolute focus-visible:left-3 focus-visible:top-3 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to files
      </a>
      {/* §2(d) — ONE compact header band: the active ROOT is crumb-zero (a picker
          when there are several roots, a plain root affordance when there's one),
          followed by the path crumbs, then the actions cluster. The old standalone
          "Roots" band is gone; the always-on filter band is gone (it's now
          keystroke-revealed below). */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 overflow-x-auto border-b border-border px-2.5 py-2"
      >
        <RootCrumb
          roots={roots}
          activeRoot={activeRoot}
          onSelectRoot={onSelectRoot}
          onGoToRoot={() => navigateTo('')}
        />
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={crumb.path} className="flex items-center">
              <ChevronRight className="size-3.5 shrink-0 text-foreground-tertiary/50" />
              <button
                type="button"
                onClick={() => navigateTo(crumb.path)}
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-xs transition-colors focus-visible:ad-focus',
                  isLast
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {crumb.label}
              </button>
            </span>
          )
        })}
        <div className="ml-auto flex items-center gap-0.5 pl-2">
          {/* §2(d) — keystroke-revealed filter: a compact "Find file" toggle (also
              reachable via `/` from the listing). Only when there's a listing. */}
          {!error && entries.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-11 md:size-6"
              onClick={() => (filterOpen ? hideFilter() : revealFilter())}
              aria-label="Find file"
              aria-expanded={filterOpen}
              title="Find file"
            >
              <Search />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-11 md:size-6"
            onClick={onNewFile}
            aria-label="New file"
            title={readOnly ? `New file: ${writeBlockedTitle}` : 'New file'}
            disabled={readOnly}
          >
            <FilePlus2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-11 md:size-6"
            onClick={onNewFolder}
            aria-label="New folder"
            title={readOnly ? `New folder: ${writeBlockedTitle}` : 'New folder'}
            disabled={readOnly}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-11 md:size-6"
            onClick={onRefresh}
            aria-label="Refresh"
            title="Refresh"
            disabled={!activeRoot}
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
          {/* §2(d) — collapse the Files tree (mirrors the sessions pane's ⌘B). */}
          {onToggleCollapsed && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-11 md:size-6"
              onClick={onToggleCollapsed}
              aria-label="Collapse files"
              title="Collapse files"
            >
              <ChevronsLeft />
            </Button>
          )}
        </div>
      </nav>

      {/* §2(d) — the keystroke-revealed fuzzy go-to-file filter. Mounts only when
          opened (via the Find-file toggle or `/`); Escape clears + hides it. */}
      {filterOpen && !error && entries.length > 0 && (
        <div className="border-b border-border px-2.5 py-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary"
            />
            <input
              ref={filterInputRef}
              type="search"
              role="searchbox"
              aria-label="Go to file"
              placeholder="Go to file…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  hideFilter()
                } else if (e.key === 'ArrowDown' && navigableIndexes[0] !== undefined) {
                  // Let ↓ jump from the filter into the first matching row.
                  e.preventDefault()
                  focusRow(navigableIndexes[0])
                }
              }}
              // §2(c) — the SAME search-box pattern as the sessions rail's search
              // (rounded-[9px], surface-2 fill, hover border, focus ring), so the
              // two surfaces share one search vocabulary.
              className={cn(
                'w-full rounded-[9px] border border-border bg-surface-2/50 py-2 pl-8 pr-2.5 text-[13px]',
                'text-foreground placeholder:text-foreground-tertiary',
                'transition-colors hover:border-border-strong',
                'focus-visible:border-ring focus-visible:ad-focus',
              )}
            />
          </div>
        </div>
      )}

      {/* Listing — a flat single-level listing, so role="list" (the broken
          role="tree" had no keyboard model); keyboard nav is a roving tabindex.
          This container is the virtualizer's scroll element (the rows below are
          windowed), so off-screen entries stay out of the DOM. */}
      <div
        id={listingId}
        ref={listScrollRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto py-1.5 focus-visible:outline-none"
      >
        {error ? (
          // The shared error vocabulary (state.tsx): a governed tile + an OUTLINE
          // retry (never amber), wired to the tree query refetch (onRefresh, which
          // refetches the listing + roots) so a transient failure is recoverable
          // in place rather than a dead red line.
          <ErrorState
            icon={FolderX}
            title="Couldn't load workspace"
            description={error}
            onRetry={onRefresh}
            className="m-3 border-0 bg-transparent shadow-none"
          />
        ) : loading && entries.length === 0 ? (
          <ul className="space-y-1 px-2 py-1" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-8 animate-pulse rounded-md bg-muted/40" />
            ))}
          </ul>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-foreground-tertiary">
            <p className="font-medium text-muted-foreground">This folder is empty</p>
            <p className="mt-1">
              {readOnly
                ? 'There are no files in this folder.'
                : 'Create a file or folder here to get started.'}
            </p>
            {!readOnly && (
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 md:min-h-7"
                  onClick={onNewFile}
                >
                  <FilePlus2 className="size-3.5" aria-hidden />
                  New file
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 md:min-h-7"
                  onClick={onNewFolder}
                >
                  <FolderPlus className="size-3.5" aria-hidden />
                  New folder
                </Button>
              </div>
            )}
          </div>
        ) : visibleEntries.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-foreground-tertiary">
            No files match &quot;{filter}&quot;.
          </p>
        ) : (
          <ul
            className="relative px-1.5"
            role="list"
            aria-label="Files"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const index = vItem.index
              const entry = visibleEntries[index]
              if (!entry) return null
              const isDir = entry.type === 'dir'
              const isSelected = !isDir && entry.path === selectedPath
              const blocked = entry.suppressed
              const { Icon, colorClass } = glyphFor({
                type: entry.type,
                name: entry.name,
                suppressed: blocked,
              })
              return (
                <li
                  key={entry.path}
                  data-index={index}
                  ref={rowVirtualizer.measureElement}
                  role="listitem"
                  className="group/row absolute left-0 w-full"
                  style={{ top: 0, transform: `translateY(${vItem.start}px)` }}
                >
                  <button
                    type="button"
                    disabled={blocked}
                    ref={(el) => {
                      rowRefs.current[index] = el
                    }}
                    // Roving tabindex: exactly one enabled row is in the tab order.
                    tabIndex={!blocked && index === tabbableIndex ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onKeyDown={(e) => onRowKeyDown(e, index)}
                    onClick={() => (isDir ? navigateTo(entry.path) : onOpenFile(entry))}
                    aria-current={isSelected ? true : undefined}
                    title={blocked ? `Hidden (${entry.reason ?? 'restricted'})` : entry.path}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-md py-2 pr-16 pl-3 text-left text-[13px] transition-colors focus-visible:ad-focus',
                      !blocked && !readOnly && 'pr-24 md:pr-16',
                      // Active row mirrors the rail's active-nav pattern: a 3px
                      // amber accent bar on the leading edge + a faint amber tint.
                      'before:pointer-events-none before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity',
                      blocked
                        ? 'cursor-not-allowed text-foreground-tertiary/70'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      // §2(c) — the SAME selection wash as the sessions rail rows
                      // (bg-primary/10 + the amber accent bar), so a selected file
                      // and a selected session read identically.
                      isSelected && 'bg-primary/10 font-medium text-foreground before:opacity-100',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        blocked ? 'text-foreground-tertiary/70' : colorClass,
                        isSelected && 'text-primary',
                      )}
                    />
                    <span className="truncate">{entry.name}</span>
                    {!isDir && !blocked && (
                      // Decorative metadata — keep it out of the button's
                      // accessible name (SR users hear the filename, not "… 1.2 KB").
                      // `pr-3` keeps a breathing gap between the size and the right
                      // edge where the hover actions sit, so they never collide.
                      <span
                        aria-hidden
                        className="ml-auto shrink-0 pr-3 pl-2 font-mono text-[11px] whitespace-nowrap text-foreground-tertiary tabular-nums transition-opacity group-hover/row:opacity-0"
                      >
                        {formatSize(entry.size)}
                      </span>
                    )}
                    {blocked && (
                      // The HIDDEN/secret badge aligns to the right edge with the
                      // same trailing gap as the size column so the row reads cleanly.
                      <span className="ml-auto mr-1 inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none font-medium tracking-wide text-foreground-tertiary uppercase">
                        {entry.reason ?? 'hidden'}
                      </span>
                    )}
                  </button>
                  {/* Rename/Delete are write actions — hidden entirely on a
                      read-only root (the New buttons above carry the honest
                      "read-only" tooltip, so the state is still discoverable). */}
                  {!blocked && !readOnly && (
                    <div className="pointer-events-auto absolute inset-y-0 right-1 flex items-center gap-1 opacity-100 transition-opacity md:pointer-events-none md:right-2 md:gap-0.5 md:opacity-0 md:group-focus-within/row:pointer-events-auto md:group-focus-within/row:opacity-100 md:group-hover/row:pointer-events-auto md:group-hover/row:opacity-100">
                      <button
                        type="button"
                        onClick={() => onRename(entry)}
                        aria-label={`Rename ${entry.name}`}
                        title="Rename"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 text-foreground-tertiary transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:ad-focus md:min-h-0 md:min-w-0 md:p-1.5"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(entry)}
                        aria-label={`Delete ${entry.name}`}
                        title="Delete"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 text-foreground-tertiary transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ad-focus md:min-h-0 md:min-w-0 md:p-1.5"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {truncated && (
          <p className="mt-1 border-t border-border/60 px-4 py-2.5 text-center text-[11px] text-foreground-tertiary">
            Listing truncated: too many entries.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * §2(d) — the active ROOT folded into the breadcrumb as crumb-zero (replacing the
 * old standalone "Roots" band). With a SINGLE root it's a plain affordance: a
 * drive glyph + the root label that jumps to the root directory. With SEVERAL
 * roots it's a quiet picker (a popover of the roots) so switching workspace stays
 * one click without a whole header band. Selecting a root is the active state — a
 * faint amber tint — but the persistent selection ring stays neutral
 * `border-strong` per the spine (amber rings are focus-visible only).
 */
function RootCrumb({
  roots,
  activeRoot,
  onSelectRoot,
  onGoToRoot,
}: {
  roots: FileRoot[]
  activeRoot: FileRoot | null
  onSelectRoot: (rootId: string) => void
  onGoToRoot: () => void
}) {
  const [open, setOpen] = useState(false)
  const label = activeRoot?.label ?? 'Workspace'

  // One root: a plain crumb-zero that jumps to the root directory.
  if (roots.length <= 1) {
    return (
      <button
        type="button"
        onClick={onGoToRoot}
        aria-label={`Root: ${label}`}
        title={activeRoot?.description ?? label}
        // min-h-11 keeps a 44px touch target on mobile (matching the header's
        // size-11 md:size-6 action buttons), relaxed to the compact crumb on md+.
        className="inline-flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus md:min-h-0"
      >
        <HardDrive className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  // Several roots: crumb-zero is a picker.
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Switch root (${label})`}
          title="Switch root"
          // Same 44px-on-mobile treatment as the single-root crumb above.
          className="inline-flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus md:min-h-0"
        >
          <HardDrive className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-foreground-tertiary" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 w-56 rounded-xl bg-popover p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="group" aria-label="Roots" className="flex flex-col gap-0.5">
            {roots.map((root) => {
              const isActive = activeRoot?.id === root.id
              return (
                <button
                  key={root.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onSelectRoot(root.id)
                  }}
                  title={root.description}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:ad-focus',
                    isActive
                      ? 'bg-primary/[0.08] font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <HardDrive
                    className={cn(
                      'size-4 shrink-0',
                      isActive ? 'text-primary' : 'text-foreground-tertiary',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{root.label}</span>
                  {isActive && <Check className="size-3.5 shrink-0 text-foreground" aria-hidden />}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

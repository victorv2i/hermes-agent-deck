import * as React from 'react'
import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog'

/**
 * A self-contained, cmdk-style Command primitive (shadcn-shaped API) built on
 * the project's radix-ui foundation rather than pulling in the `cmdk` package —
 * keeping the dependency surface unchanged and matching the repo's
 * "primitives on radix-ui" pattern.
 *
 * Vocabulary: <Command> (combobox shell + filter context) · <CommandInput>
 * (the search box) · <CommandList> (the scrollable listbox) · <CommandEmpty>
 * (shown only when no item matches) · <CommandGroup> (labelled section, hides
 * itself when all its items are filtered out) · <CommandItem> (an option) ·
 * <CommandShortcut> (a trailing key hint). <CommandDialog> wraps it in the
 * themed Dialog for the ⌘K palette.
 *
 * Filtering is a case-insensitive substring match over each item's `value` (or,
 * if richer matching is needed later, an optional `keywords` list). Keyboard:
 * ↑/↓ move the active option, Home/End jump, Enter selects, and typing in the
 * input narrows the list while keeping the active option inside the filtered set.
 */

interface CommandRegItem {
  id: string
  value: string
  keywords: string
  groupId: string | null
  onSelect?: () => void
  disabled?: boolean
}

interface CommandContextValue {
  query: string
  register: (item: CommandRegItem) => () => void
  /** Visible (filtered) item ids, in DOM order. */
  visibleIds: string[]
  /** Whether any visible item belongs to the given group (drives group hiding). */
  groupHasVisible: (groupId: string) => boolean
  activeId: string | null
  setActiveId: (id: string) => void
  select: (id: string) => void
  matches: (value: string, keywords: string) => boolean
  inputId: string
  listId: string
}

const CommandContext = React.createContext<CommandContextValue | null>(null)
/** The id of the enclosing <CommandGroup>, so items can register their group. */
const GroupContext = React.createContext<string | null>(null)

function useCommand(): CommandContextValue {
  const ctx = React.useContext(CommandContext)
  if (!ctx) throw new Error('Command subcomponents must be used within <Command>')
  return ctx
}

export function Command({
  className,
  children,
  label = 'Command menu',
  ...props
}: React.ComponentProps<'div'> & { label?: string }) {
  const [query, setQuery] = React.useState('')
  const [activeId, setActiveId] = React.useState<string | null>(null)
  // Registered items, in DOM/registration order, held in STATE (not a ref) so
  // render derives the visible set from state — no ref reads during render.
  const [items, setItems] = React.useState<CommandRegItem[]>([])
  const reactId = React.useId()
  const inputId = `${reactId}-input`
  const listId = `${reactId}-list`

  const register = React.useCallback((item: CommandRegItem) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== item.id)
      next.push(item)
      return next
    })
    return () => setItems((prev) => prev.filter((i) => i.id !== item.id))
  }, [])

  const matches = React.useCallback(
    (value: string, keywords: string) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return (value + ' ' + keywords).toLowerCase().includes(q)
    },
    [query],
  )

  const visibleItems = React.useMemo(
    () => items.filter((it) => matches(it.value, it.keywords)),
    [items, matches],
  )
  const visibleIds = React.useMemo(() => visibleItems.map((it) => it.id), [visibleItems])
  const selectableIds = React.useMemo(
    () => visibleItems.filter((it) => !it.disabled).map((it) => it.id),
    [visibleItems],
  )
  const groupHasVisible = React.useCallback(
    (groupId: string) => visibleItems.some((it) => it.groupId === groupId),
    [visibleItems],
  )

  // Keep the active option inside the filtered set (default: first). Derived
  // during render via React's "adjust state while rendering" pattern, so no
  // effect + cascading setState is needed.
  const desiredActive =
    activeId !== null && selectableIds.includes(activeId)
      ? activeId
      : (selectableIds[0] ?? null)
  if (desiredActive !== activeId) {
    setActiveId(desiredActive)
  }

  const select = React.useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id)
      if (!item || item.disabled) return
      item.onSelect?.()
    },
    [items],
  )

  const move = (delta: number) => {
    if (selectableIds.length === 0) return
    const i = desiredActive ? selectableIds.indexOf(desiredActive) : -1
    const next = (i + delta + selectableIds.length) % selectableIds.length
    setActiveId(selectableIds[next]!)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (selectableIds.length) setActiveId(selectableIds[0]!)
    } else if (e.key === 'End') {
      e.preventDefault()
      if (selectableIds.length) setActiveId(selectableIds[selectableIds.length - 1]!)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (desiredActive) select(desiredActive)
    }
  }

  const ctx = React.useMemo<CommandContextValue>(
    () => ({
      query,
      register,
      visibleIds,
      groupHasVisible,
      activeId: desiredActive,
      setActiveId,
      select,
      matches,
      inputId,
      listId,
    }),
    [query, register, visibleIds, groupHasVisible, desiredActive, select, matches, inputId, listId],
  )

  // The query setter lives on the context indirectly via CommandInput; expose it
  // through a nested provider value extension to keep CommandInput simple.
  return (
    <CommandContext.Provider value={ctx}>
      <QuerySetterContext.Provider value={setQuery}>
        <LabelContext.Provider value={label}>
          <div
            data-slot="command"
            onKeyDown={onKeyDown}
            className={cn('flex h-full w-full flex-col overflow-hidden', className)}
            {...props}
          >
            {children}
          </div>
        </LabelContext.Provider>
      </QuerySetterContext.Provider>
    </CommandContext.Provider>
  )
}

/** The accessible name for the combobox input, threaded from <Command>. */
const LabelContext = React.createContext<string>('Command menu')

const QuerySetterContext = React.createContext<((v: string) => void) | null>(null)

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  const { query, inputId, listId, activeId } = useCommand()
  const setQuery = React.useContext(QuerySetterContext)
  const label = React.useContext(LabelContext)
  return (
    <div className="flex min-w-0 items-center gap-2.5 border-b border-border px-4">
      <Search className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
      <input
        id={inputId}
        data-slot="command-input"
        // ARIA combobox text field: owns the role + controls the listbox and
        // tracks the active option via aria-activedescendant.
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery?.(e.target.value)}
        className={cn(
          'h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-tertiary',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function CommandList({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const { listId } = useCommand()
  return (
    <div
      id={listId}
      data-slot="command-list"
      role="listbox"
      aria-label="Results"
      className={cn('max-h-[min(60vh,24rem)] overflow-y-auto overflow-x-hidden p-1.5', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function CommandEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const { visibleIds } = useCommand()
  if (visibleIds.length > 0) return null
  return (
    <div
      data-slot="command-empty"
      role="status"
      aria-live="polite"
      className={cn('py-8 text-center text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function CommandGroup({
  className,
  heading,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & { heading?: React.ReactNode }) {
  // A stable per-instance id lets items register their group, so we can hide the
  // whole group (and its heading) — derived during render — when none of its
  // items survive the current filter.
  const groupId = React.useId()
  const headingId = `${groupId}-heading`
  const { groupHasVisible } = useCommand()
  const hasVisible = groupHasVisible(groupId)

  return (
    <GroupContext.Provider value={groupId}>
      <div
        data-slot="command-group"
        role="group"
        aria-labelledby={heading != null ? headingId : undefined}
        className={cn('py-1', !hasVisible && 'hidden', className)}
        {...props}
      >
        {heading != null && (
          <div
            id={headingId}
            className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-foreground-tertiary"
          >
            {heading}
          </div>
        )}
        <div className="flex flex-col gap-0.5">{children}</div>
      </div>
    </GroupContext.Provider>
  )
}

export function CommandItem({
  className,
  value,
  keywords,
  onSelect,
  disabled = false,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  value: string
  keywords?: string[]
  onSelect?: () => void
  disabled?: boolean
}) {
  const { register, matches, activeId, setActiveId, select } = useCommand()
  const groupId = React.useContext(GroupContext)
  const id = React.useId()
  const keywordStr = keywords?.join(' ') ?? ''

  // Register/unregister with the parent so it can build the visible-id order and
  // drive keyboard navigation. Re-register when the selection handler changes.
  React.useEffect(() => {
    return register({ id, value, keywords: keywordStr, groupId, onSelect, disabled })
  }, [register, id, value, keywordStr, groupId, onSelect, disabled])

  if (!matches(value, keywordStr)) return null

  const active = !disabled && activeId === id
  return (
    <div
      id={id}
      data-slot="command-item"
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-active={active ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      onMouseMove={() => {
        if (!active && !disabled) setActiveId(id)
      }}
      onClick={() => {
        if (!disabled) select(id)
      }}
      className={cn(
        'flex min-h-11 min-w-0 touch-manipulation cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/90',
        // The ACTIVE (keyboard-/pointer-highlighted) option is a sanctioned accent
        // use: a faint sky-blue-tinted bg + sky-blue row icon.
        'data-[active=true]:bg-primary/10 data-[active=true]:text-foreground',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-foreground-tertiary data-[active=true]:[&_svg]:text-primary',
        'data-[disabled=true]:cursor-default data-[disabled=true]:text-muted-foreground data-[disabled=true]:opacity-75',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto shrink-0 text-[11px] font-medium tracking-wide text-foreground-tertiary tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export function CommandDialog({
  open,
  onOpenChange,
  label = 'Command menu',
  description = 'Search for a command, surface, session, agent, or theme.',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label?: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className="top-[clamp(3rem,12vh,7rem)] max-w-xl gap-0 overflow-hidden p-0"
      >
        {/* Title/description are required by Radix Dialog for a11y; we visually
            hide them since the input placeholder communicates intent. */}
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command label={label}>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

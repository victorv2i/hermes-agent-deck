import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, CornerLeftUp, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { DirListResponse, RootsResponse } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/apiFetch'
import { CliBrandMark } from './cliBrandIcons'
import type { CliId, DetectedCli } from './useTerminalClis'

/**
 * The per-pane PICKERS for the workspace surface: a {@link CliPicker} (which CLI
 * a pane runs) and a {@link CwdPicker} (which directory it launches in). Both are
 * small radix Popover menus that reuse {@link apiFetch} for REST and the existing
 * server endpoints:
 *   - CLI list: handed down (the route fetches `GET /terminal/clis` once),
 *   - cwd roots/dirs: `GET /roots` + `GET /dirs?path=` (security-hardened
 *     server-side: realpath + allowlist containment; the picker only walks what
 *     the server returns and never sends an arbitrary path it didn't list).
 *
 * The cwd a user picks is recorded as pane intent; it is re-validated server-side
 * on PATCH + before any launch. Clearing the cwd falls the pane back to the
 * server's default workspace directory.
 */

/* -- CLI picker ------------------------------------------------------------ */

/** Stable preset order (matches the launcher): Hermes -> Claude -> Codex -> shell. */
const PRESET_ORDER: readonly CliId[] = ['hermes', 'claude', 'codex', 'shell']
/** Fallback labels if the detected-CLI list hasn't loaded yet. */
const PRESET_LABEL: Record<CliId, string> = {
  hermes: 'Hermes CLI',
  claude: 'Claude Code',
  codex: 'Codex',
  shell: 'Raw shell',
}

/** The CLI's BRAND mark (own color) or the neutral shell/codex glyph. */
function CliMark({ cli }: { cli: CliId }) {
  const tint = cli === 'shell' || cli === 'codex' ? ' text-foreground' : ''
  return <CliBrandMark cli={cli} className={`size-4 shrink-0${tint}`} />
}

export interface CliPickerProps {
  /** The pane's current CLI (undefined when it attaches a foreign session). */
  value: CliId | undefined
  /** The detected CLIs, so only installed presets are actionable. */
  clis: DetectedCli[] | undefined
  /** Choose a CLI for the pane. */
  onChange: (cli: CliId) => void
}

/**
 * A compact CLI chooser for one pane. HONEST: only installed CLIs are actionable
 * (the raw shell is always available); the trigger shows the current preset.
 */
export function CliPicker({ value, clis, onChange }: CliPickerProps) {
  const [open, setOpen] = useState(false)
  const byId = clis ? new Map(clis.map((c) => [c.id, c])) : null
  const isAvailable = (id: CliId): boolean => {
    if (id === 'shell') return true
    if (!byId) return false
    return byId.get(id)?.available ?? false
  }
  const labelFor = (id: CliId): string => byId?.get(id)?.label ?? PRESET_LABEL[id]
  const current: CliId = value ?? 'shell'
  const choose = (id: CliId) => {
    setOpen(false)
    onChange(id)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 justify-start gap-2 md:min-h-8"
          aria-label="Choose CLI"
        >
          <CliMark cli={current} />
          <span className="min-w-0 truncate">{labelFor(current)}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 w-52 rounded-lg bg-popover p-1 shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="Pane CLI" className="flex flex-col gap-0.5">
            {PRESET_ORDER.map((id) => {
              const available = isAvailable(id)
              const selected = id === current
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={!available}
                  onClick={() => choose(id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors duration-100 focus-visible:ad-focus md:py-1.5 ${
                    available
                      ? 'text-foreground hover:bg-muted'
                      : 'cursor-not-allowed text-muted-foreground'
                  }`}
                >
                  <CliMark cli={id} />
                  <span className="min-w-0 flex-1 truncate">{labelFor(id)}</span>
                  {selected ? (
                    <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                  ) : !available ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Not installed</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/* -- cwd picker ------------------------------------------------------------ */

type DirState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: DirListResponse }
  | { phase: 'failed'; error: string }

/** The short, friendly tail of an absolute path (the leaf folder name). */
function leafName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

export interface CwdPickerProps {
  /** The pane's current working directory (absolute path), or undefined. */
  value: string | undefined
  /** Inject fetch (tests); defaults to the shared apiFetch. */
  fetchImpl?: typeof fetch
  /** Set the pane's cwd to an absolute path, or null to clear it (use default). */
  onChange: (cwd: string | null) => void
}

/**
 * A directory browser for one pane's cwd. On open it lists the allowlisted roots
 * (`GET /roots`) and lets the user walk into subdirectories (`GET /dirs?path=`),
 * "up one level" (when the server offers a `parent`), pick the directory it is
 * currently showing, or clear back to the default. It only ever requests paths
 * the server already returned, so it can never reach outside the allowlist.
 */
export function CwdPicker({ value, fetchImpl, onChange }: CwdPickerProps) {
  const [open, setOpen] = useState(false)
  const [roots, setRoots] = useState<RootsResponse['roots'] | null>(null)
  const [rootsError, setRootsError] = useState<string | null>(null)
  // The path currently being browsed (null = the roots list).
  const [path, setPath] = useState<string | null>(null)
  const [dir, setDir] = useState<DirState | null>(null)

  const getJson = useCallback(
    <T,>(url: string): Promise<T> =>
      fetchImpl
        ? (fetchImpl(`/api/agent-deck${url}`).then((r) => {
            if (!r.ok) throw new Error(`request failed (${r.status})`)
            return r.json() as Promise<T>
          }) as Promise<T>)
        : apiFetch<T>(url),
    [fetchImpl],
  )

  // Load the roots the first time the picker opens.
  useEffect(() => {
    if (!open || roots !== null || rootsError !== null) return
    let cancelled = false
    void getJson<RootsResponse>('/terminal/roots')
      .then((res) => {
        if (cancelled) return
        setRoots(res.roots)
        // Open straight into the pane's current cwd when set + offered, else the
        // first root, so the picker lands somewhere useful immediately.
        const start = value ?? res.roots[0]?.path ?? null
        setPath(start)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setRootsError(err instanceof Error ? err.message : 'Could not load folders.')
      })
    return () => {
      cancelled = true
    }
  }, [open, roots, rootsError, value, getJson])

  // Show LOADING the instant the browsed path changes, via React's
  // adjust-state-during-render pattern (no effect -> no cascading render); the
  // fetch effect below then only writes state inside its async callbacks.
  const [lastPath, setLastPath] = useState<string | null>(path)
  if (path !== lastPath) {
    setLastPath(path)
    setDir(path === null ? null : { phase: 'loading' })
  }

  // Load (or reload) the directory listing whenever the browsed path changes.
  useEffect(() => {
    if (!open || path === null) return
    let cancelled = false
    void getJson<DirListResponse>(`/terminal/dirs?path=${encodeURIComponent(path)}`)
      .then((res) => {
        if (!cancelled) setDir({ phase: 'ready', data: res })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDir({ phase: 'failed', error: err instanceof Error ? err.message : 'Unreadable.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, path, getJson])

  const chooseCurrent = () => {
    if (dir?.phase === 'ready') {
      onChange(dir.data.path)
      setOpen(false)
    }
  }
  const clear = () => {
    onChange(null)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 max-w-[18rem] justify-start gap-2 md:min-h-8"
          aria-label="Choose working directory"
          title={value ?? 'Default workspace directory'}
        >
          <Folder className="size-4 shrink-0 text-foreground-tertiary" />
          <span className="min-w-0 truncate">{value ? leafName(value) : 'Default folder'}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 flex max-h-[min(60vh,22rem)] w-[min(20rem,calc(100vw-2rem))] flex-col rounded-lg bg-popover p-1.5 shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Current location, or a roots picker when nothing is being browsed. */}
          {path !== null ? (
            <p className="truncate px-2 pt-1 pb-1.5 text-xs text-foreground-tertiary" title={path}>
              {dir?.phase === 'ready' ? dir.data.path : path}
            </p>
          ) : (
            <p className="px-2 pt-1 pb-1.5 text-xs text-foreground-tertiary">
              Choose a starting folder
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" role="menu" aria-label="Folders">
            {rootsError ? (
              <p className="px-2 py-3 text-sm text-destructive">{rootsError}</p>
            ) : roots === null ? (
              <Centered>
                <Loader2 className="size-4 animate-spin" /> Loading folders...
              </Centered>
            ) : path === null ? (
              // The roots list (the picker's home).
              <RootList roots={roots} onOpen={setPath} />
            ) : dir === null || dir.phase === 'loading' ? (
              <Centered>
                <Loader2 className="size-4 animate-spin" /> Loading...
              </Centered>
            ) : dir.phase === 'failed' ? (
              <p className="px-2 py-3 text-sm text-destructive">{dir.error}</p>
            ) : (
              <DirEntries data={dir.data} onOpen={setPath} />
            )}
          </div>

          {/* Actions: clear back to the default, and pick the shown folder. */}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-1 pt-1.5">
            <Button type="button" variant="ghost" size="sm" className="min-h-9" onClick={clear}>
              Default
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={dir?.phase !== 'ready'}
              onClick={chooseCurrent}
            >
              <Check className="size-3.5" />
              Use this folder
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function RootList({
  roots,
  onOpen,
}: {
  roots: RootsResponse['roots']
  onOpen: (path: string) => void
}) {
  if (roots.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">No folders are configured.</p>
  }
  return (
    <div className="flex flex-col gap-0.5">
      {roots.map((root) => (
        <button
          key={root.path}
          type="button"
          role="menuitem"
          onClick={() => onOpen(root.path)}
          title={root.path}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors duration-100 hover:bg-muted focus-visible:ad-focus md:py-1.5"
        >
          <FolderOpen className="size-4 shrink-0 text-foreground-tertiary" />
          <span className="min-w-0 flex-1 truncate">{root.name}</span>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
        </button>
      ))}
    </div>
  )
}

function DirEntries({ data, onOpen }: { data: DirListResponse; onOpen: (path: string) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      {data.parent !== undefined ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => onOpen(data.parent!)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground-tertiary transition-colors duration-100 hover:bg-muted focus-visible:ad-focus md:py-1.5"
        >
          <CornerLeftUp className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Up one level</span>
        </button>
      ) : null}
      {data.entries.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">No subfolders here.</p>
      ) : (
        data.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            role="menuitem"
            onClick={() => onOpen(entry.path)}
            title={entry.path}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors duration-100 hover:bg-muted focus-visible:ad-focus md:py-1.5"
          >
            <Folder className="size-4 shrink-0 text-foreground-tertiary" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
          </button>
        ))
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

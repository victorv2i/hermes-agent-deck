import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, Loader2, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import type {
  CreateWorkspaceRequest,
  ListWorkspacesResponse,
  WorkspaceDefinition,
  WorkspaceSummary,
} from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { apiDelete, apiFetch, apiPost } from '@/lib/apiFetch'
import {
  WORKSPACE_LAYOUT_PRESETS,
  addPane,
  emptyWorkspace,
  readWorkspacesCache,
  toPaneDefinitions,
  writeWorkspacesCache,
} from './terminalWorkspaces'

/**
 * The WORKSPACES picker, mounted at `/workspaces`. It lists the server-persisted
 * workspaces as cards (name, pane count, last modified), lets you CREATE one
 * (name + a count of initial shell panes) and DELETE one (confirm-gated, the
 * house pattern), and opens one -> `/workspaces/:id`.
 *
 * The server is authoritative for the list; the localStorage SUMMARY cache paints
 * instantly on load, then the fetch revalidates it. `fetchImpl` is injectable so
 * the route is testable in jsdom without a live BFF.
 */

type ListState =
  | { phase: 'loading' }
  | { phase: 'ready'; workspaces: WorkspaceSummary[] }
  | { phase: 'failed'; error: string }

export interface WorkspacesRouteProps {
  /** Inject fetch (tests). */
  fetchImpl?: typeof fetch
}

export function WorkspacesRoute({ fetchImpl }: WorkspacesRouteProps = {}) {
  const navigate = useNavigate()
  // Paint from the cache immediately (revalidated by the fetch below).
  const [state, setState] = useState<ListState>(() => {
    const cached = readWorkspacesCache()
    return cached ? { phase: 'ready', workspaces: cached } : { phase: 'loading' }
  })
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<WorkspaceSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const getJson = useCallback(
    <T,>(path: string): Promise<T> =>
      fetchImpl
        ? (fetchImpl(`/api/agent-deck${path}`).then((r) => {
            if (!r.ok) throw new Error(`request failed (${r.status})`)
            return r.json() as Promise<T>
          }) as Promise<T>)
        : apiFetch<T>(path),
    [fetchImpl],
  )

  const refresh = useCallback(() => {
    let cancelled = false
    void getJson<ListWorkspacesResponse>('/terminal/workspaces')
      .then((res) => {
        if (cancelled) return
        setState({ phase: 'ready', workspaces: res.workspaces })
        writeWorkspacesCache(res.workspaces)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Keep any cached list visible; only show the error tile on a cold load.
        setState((prev) =>
          prev.phase === 'ready'
            ? prev
            : { phase: 'failed', error: err instanceof Error ? err.message : 'Could not load.' },
        )
      })
    return () => {
      cancelled = true
    }
  }, [getJson])

  useEffect(() => refresh(), [refresh])

  const create = useCallback(
    async (req: CreateWorkspaceRequest): Promise<WorkspaceDefinition> => {
      const path = '/terminal/workspaces'
      if (fetchImpl) {
        const res = await fetchImpl(`/api/agent-deck${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        })
        if (!res.ok) throw new Error(`create failed (${res.status})`)
        return (await res.json()) as WorkspaceDefinition
      }
      return apiPost<WorkspaceDefinition>(path, req)
    },
    [fetchImpl],
  )

  const onCreated = (def: WorkspaceDefinition) => {
    setCreating(false)
    refresh()
    // Open the new workspace straight away.
    navigate(`/workspaces/${def.id}`)
  }

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleteBusy(true)
    const path = `/terminal/workspaces/${encodeURIComponent(pendingDelete.id)}`
    try {
      if (fetchImpl) {
        const res = await fetchImpl(`/api/agent-deck${path}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(`delete failed (${res.status})`)
      } else {
        await apiDelete(path)
      }
      // Optimistically drop it, then revalidate.
      setState((prev) =>
        prev.phase === 'ready'
          ? { phase: 'ready', workspaces: prev.workspaces.filter((w) => w.id !== pendingDelete.id) }
          : prev,
      )
      setPendingDelete(null)
      refresh()
    } catch {
      // Leave the dialog open so the user can retry; the list is unchanged.
    } finally {
      setDeleteBusy(false)
    }
  }, [pendingDelete, fetchImpl, refresh])

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 py-8">
      <PageHeader
        icon={LayoutGrid}
        title="Workspaces"
        subtitle="Named, server-saved grids of terminal panes. Reattach the same shells from any device."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New workspace
          </Button>
        }
      />

      {state.phase === 'loading' && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading workspaces…
        </div>
      )}

      {state.phase === 'failed' && (
        <ErrorState
          icon={LayoutGrid}
          title="Couldn't load workspaces"
          description={state.error}
          onRetry={refresh}
        />
      )}

      {state.phase === 'ready' &&
        (state.workspaces.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title="No workspaces yet"
            description="Create a workspace to keep a named grid of terminal panes that follows you across devices."
            action={
              <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                <Plus />
                New workspace
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state.workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                onOpen={() => navigate(`/workspaces/${ws.id}`)}
                onDelete={() => setPendingDelete(ws)}
              />
            ))}
          </div>
        ))}

      <CreateWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={create}
        onCreated={onCreated}
      />

      <DeleteWorkspaceDialog
        workspace={pendingDelete}
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

/** Format an ISO-8601 timestamp as a short, locale-aware "last modified". */
function formatModified(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function WorkspaceCard({
  workspace,
  onOpen,
  onDelete,
}: {
  workspace: WorkspaceSummary
  onOpen: () => void
  onDelete: () => void
}) {
  const modified = formatModified(workspace.lastModifiedAt)
  return (
    <Card size="sm" className="group/ws relative gap-3">
      <CardHeader>
        <CardTitle className="truncate" title={workspace.name}>
          {workspace.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {workspace.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{workspace.description}</p>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-foreground-tertiary">
          <SquareTerminal className="size-3.5 shrink-0" aria-hidden />
          {workspace.paneCount} {workspace.paneCount === 1 ? 'pane' : 'panes'}
          {modified ? <span className="text-foreground-tertiary/70">· {modified}</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onOpen}>
            Open
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${workspace.name}`}
            title="Delete workspace"
            onClick={onDelete}
            className="text-foreground-tertiary hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* -- Create dialog --------------------------------------------------------- */

/**
 * Build the initial pane definitions for a new workspace: `count` neutral `shell`
 * panes, reusing the canonical id + label generation in {@link addPane} (which
 * also honors the {@link MAX_TERMINALS} cap), so a created workspace's panes are
 * indistinguishable from ones added later.
 */
function initialPanes(count: number) {
  let ws = emptyWorkspace('new', 'new')
  for (let i = 0; i < count; i += 1) ws = addPane(ws, 'shell')
  return toPaneDefinitions(ws)
}

function CreateWorkspaceDialog({
  open,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreate: (req: CreateWorkspaceRequest) => Promise<WorkspaceDefinition>
  onCreated: (def: WorkspaceDefinition) => void
}) {
  const [name, setName] = useState('')
  const [paneCount, setPaneCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()

  // Reset the form on the closed -> open edge, via React's
  // adjust-state-during-render pattern (no effect needed), so a re-open starts
  // clean without a cascading render.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setPaneCount(1)
      setBusy(false)
      setError(null)
    }
  }

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 80 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const def = await onCreate({ name: trimmed, panes: initialPanes(paneCount) })
      onCreated(def)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Give it a name and choose how many panes to start with. You can add, rename, or remove
            panes any time.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium text-foreground">
              Name
            </label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. Client project"
              // 16px on mobile (md:text-sm restores the desktop size) stops iOS
              // zooming in on focus.
              className="text-base md:text-sm"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error != null || undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Initial panes</span>
            <div role="group" aria-label="Initial pane count" className="flex flex-wrap gap-1.5">
              {WORKSPACE_LAYOUT_PRESETS.map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={paneCount === count}
                  onClick={() => setPaneCount(count)}
                  className={`flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
                    paneCount === count
                      ? 'border-transparent bg-primary/10 text-primary'
                      : 'border-border text-foreground-tertiary hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy && <Loader2 className="animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -- Delete confirm -------------------------------------------------------- */

/** Confirm-gated delete (the destructive action is never one click): the house
 * pattern shared with the rest of the app. */
function DeleteWorkspaceDialog({
  workspace,
  busy,
  onCancel,
  onConfirm,
}: {
  workspace: WorkspaceSummary | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={workspace !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete workspace?</DialogTitle>
          <DialogDescription>
            {workspace ? (
              <>
                &ldquo;{workspace.name}&rdquo; will be removed. Its pane layout is deleted; any
                running shells are not killed here and can still be reattached from the Terminal.
              </>
            ) : (
              <>This workspace will be removed.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

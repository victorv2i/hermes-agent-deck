/**
 * FilesRoute — the Files surface (mounted at `/files`).
 *
 * A two-pane workspace browser: a navigable directory tree/breadcrumb on the
 * left (FileBrowser) and a preview/editor on the right (FilePreview). Reads ride
 * the dashboard's read-only workspace API through the BFF; edits/creates/renames
 * /deletes hit the BFF's path-guarded filesystem routes.
 *
 * State lives here (active root, current dir, open file). Data fetching/caching
 * is TanStack Query (hooks.ts) against the single app-wide QueryClient mounted
 * at the root (main.tsx) — the converged retry policy (skip permanent 4xx) lives
 * there now, so this surface no longer carries its own client.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronsRight, FolderTree, Lock } from 'lucide-react'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileBrowser } from './FileBrowser'
import { FilePreview } from './FilePreview'
import { PromptBar } from './PromptBar'
import {
  parentOf,
  useCreateEntry,
  useDeleteEntry,
  useFileContent,
  useListing,
  useRenameEntry,
  useRoots,
  useWriteFile,
} from './hooks'
import { FilesApiError, type FileEntry } from './api'
import { ConfirmBar } from './ConfirmBar'

function errorText(err: unknown): string {
  if (err instanceof FilesApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export function FilesRoute() {
  const rootsQuery = useRoots()
  const roots = useMemo(() => rootsQuery.data ?? [], [rootsQuery.data])

  // Files state is URL-backed (`?root=&dir=&file=`) so a browser refresh restores
  // where you were browsing AND the open file (and a path is deep-linkable),
  // instead of resetting to the root with nothing open. Seeded once from the URL;
  // every navigation writes it back (replace). previewHint isn't persisted (it
  // re-derives from the listing / the file content still loads).
  const [searchParams, setSearchParams] = useSearchParams()
  const patchUrl = (updates: Record<string, string | null>) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(updates)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  // The user's explicit root choice; null means "fall back to the first root".
  // Deriving the effective id at render (rather than seeding state in an effect)
  // avoids a cascading render and keeps the default reactive to roots loading.
  const [selectedRootId, setSelectedRootId] = useState<string | null>(() =>
    searchParams.get('root'),
  )
  const [dir, setDir] = useState(() => searchParams.get('dir') ?? '')
  const [openFile, setOpenFile] = useState<{ path: string; previewHint: string | null } | null>(
    () => {
      const f = searchParams.get('file')
      return f ? { path: f, previewHint: null } : null
    },
  )
  // §2(d) — collapse the Files tree column (mirrors the sessions pane's ⌘B
  // collapse gesture), giving the preview/editor the full width when you're
  // focused on a file.
  const [treeCollapsed, setTreeCollapsed] = useState(false)

  const activeRootId = selectedRootId ?? roots[0]?.id ?? null
  const activeRoot = roots.find((r) => r.id === activeRootId) ?? null

  const listing = useListing(activeRootId, dir)
  const fileContent = useFileContent(activeRootId, openFile?.path ?? null)
  const writeMutation = useWriteFile(activeRootId ?? '')
  const createMutation = useCreateEntry(activeRootId ?? '')
  const renameMutation = useRenameEntry(activeRootId ?? '')
  const deleteMutation = useDeleteEntry(activeRootId ?? '')

  const selectRoot = (id: string) => {
    setSelectedRootId(id)
    setDir('')
    setOpenFile(null)
    patchUrl({ root: id, dir: null, file: null })
  }

  const navigate = (path: string) => {
    setDir(path)
    patchUrl({ dir: path })
  }

  // The preview reports unsaved edits up here, so a switch / tab close can ask
  // before discarding them (FilePreview resets its editing state on a path
  // change, which would otherwise lose the draft silently).
  const [previewDirty, setPreviewDirty] = useState(false)
  const [pendingEntry, setPendingEntry] = useState<FileEntry | null>(null)

  const openEntry = (entry: FileEntry) => {
    if (previewDirty && entry.path !== openFile?.path) {
      setPendingEntry(entry)
      return
    }
    setOpenFile({ path: entry.path, previewHint: entry.preview })
    patchUrl({ file: entry.path })
  }
  const confirmSwitch = () => {
    if (!pendingEntry) return
    setOpenFile({ path: pendingEntry.path, previewHint: pendingEntry.preview })
    patchUrl({ file: pendingEntry.path })
    setPendingEntry(null)
  }

  // A dirty draft also warns on a tab close / refresh (the browser's native
  // prompt), cleared the moment the edits are saved or discarded.
  useEffect(() => {
    if (!previewDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [previewDirty])

  const handleSave = async (next: string) => {
    if (!activeRootId || !openFile) return
    await writeMutation.mutateAsync({ path: openFile.path, content: next })
  }

  // New file / new folder via a small prompt bar (no modal libs needed).
  // The create prompt, the rename bar, and the delete bar are three separate
  // bits of state rendered as stacked siblings. They MUST be mutually exclusive:
  // two open at once would stack two PromptBars (duplicate input ids) and steal
  // focus from each other. Each open-trigger below closes the other two first.
  const [prompt, setPrompt] = useState<{ kind: 'file' | 'dir' } | null>(null)
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [deleting, setDeleting] = useState<FileEntry | null>(null)

  const openNewEntry = (kind: 'file' | 'dir') => {
    setRenaming(null)
    setDeleting(null)
    setPrompt({ kind })
  }
  const openRename = (entry: FileEntry) => {
    setPrompt(null)
    setDeleting(null)
    setRenaming(entry)
  }
  const openDelete = (entry: FileEntry) => {
    setPrompt(null)
    setRenaming(null)
    setDeleting(entry)
  }

  const submitCreate = async (name: string) => {
    if (!activeRootId || !prompt || !name.trim()) {
      setPrompt(null)
      return
    }
    const path = joinPath(dir, name.trim())
    await createMutation.mutateAsync({ path, kind: prompt.kind })
    setPrompt(null)
    if (prompt.kind === 'file') {
      setOpenFile({ path, previewHint: 'full' })
      patchUrl({ file: path })
    }
  }

  // Rename via a prefilled prompt bar; delete via a confirm strip.
  const submitRename = async (name: string) => {
    if (!activeRootId || !renaming || !name.trim()) {
      setRenaming(null)
      return
    }
    const to = joinPath(parentOf(renaming.path), name.trim())
    await renameMutation.mutateAsync({ from: renaming.path, to })
    if (openFile?.path === renaming.path) {
      setOpenFile({ path: to, previewHint: openFile.previewHint })
      patchUrl({ file: to })
    }
    setRenaming(null)
  }

  const confirmDelete = async () => {
    if (!activeRootId || !deleting) return
    await deleteMutation.mutateAsync({ path: deleting.path })
    if (openFile?.path === deleting.path) {
      setOpenFile(null)
      patchUrl({ file: null })
    }
    setDeleting(null)
  }

  return (
    // Files is a full-bleed two-pane workspace: cancel the AppShell main's shared
    // `px-4` (-mx-4) so the bg-surface-1 browser pane sits FLUSH against the nav
    // rail's right border with no spurious left-edge gap. The SurfaceHeader and the
    // panes carry their own internal padding, so content stays correctly inset.
    <div className="-mx-4 flex h-full min-h-0 flex-col">
      <SurfaceHeader
        icon={FolderTree}
        title="Files"
        // Show WHERE you're browsing (the active root path — the live, useful
        // signal) once a root is resolved; fall back to a plain purpose line for
        // a newcomer before any root loads.
        subtitle={activeRoot?.path ?? "Browse and edit your agent's workspace files"}
        // T1.9 — surface the root's read-only state prominently (a plain badge),
        // not in a buried native tooltip. v1 roots are read-only; this is the one
        // honest, always-visible signal for the whole surface.
        actions={
          activeRoot?.readOnly ? (
            <Badge variant="muted" data-slot="read-only-badge">
              <Lock className="size-3" aria-hidden />
              Read-only
            </Badge>
          ) : undefined
        }
      />

      {prompt && (
        <PromptBar
          label={prompt.kind === 'dir' ? 'New folder name' : 'New file name'}
          placeholder={prompt.kind === 'dir' ? 'components' : 'notes.md'}
          busy={createMutation.isPending}
          error={createMutation.isError ? errorText(createMutation.error) : null}
          onSubmit={submitCreate}
          onCancel={() => setPrompt(null)}
        />
      )}

      {renaming && (
        <PromptBar
          label={`Rename ${renaming.name}`}
          initialValue={renaming.name}
          submitLabel="Rename"
          busy={renameMutation.isPending}
          error={renameMutation.isError ? errorText(renameMutation.error) : null}
          onSubmit={submitRename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <ConfirmBar
          message={`Delete ${deleting.type === 'dir' ? 'folder' : 'file'} "${deleting.name}"${deleting.type === 'dir' ? ' and its contents' : ''}? This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleteMutation.isPending}
          error={deleteMutation.isError ? errorText(deleteMutation.error) : null}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {pendingEntry && (
        <ConfirmBar
          message={`Discard unsaved changes in "${openFile?.path.split('/').pop() ?? 'this file'}"? Your edits have not been saved.`}
          confirmLabel="Discard"
          onConfirm={confirmSwitch}
          onCancel={() => setPendingEntry(null)}
        />
      )}

      <div
        data-testid="files-panes"
        className={
          treeCollapsed
            ? 'grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-1'
            : 'grid min-h-0 flex-1 grid-cols-1 grid-rows-[clamp(14rem,38dvh,22rem)_minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] md:grid-rows-1'
        }
      >
        {treeCollapsed ? (
          // §2(d) — collapsed: a thin rail-chrome strip with a single "Show files"
          // affordance, mirroring how the sessions pane collapses to a sliver.
          <div
            className="flex shrink-0 items-start justify-center overflow-hidden border-b border-border bg-sidebar p-1.5 md:border-r md:border-b-0"
            data-testid="files-collapsed-pane"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTreeCollapsed(false)}
              aria-label="Show files"
              title="Show files"
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        ) : (
          <div
            className="min-h-0 overflow-hidden border-b border-border md:border-r md:border-b-0"
            data-testid="files-browser-pane"
          >
            <FileBrowser
              roots={roots}
              activeRoot={activeRoot}
              onSelectRoot={selectRoot}
              path={dir}
              onNavigate={navigate}
              entries={listing.data?.entries ?? []}
              loading={listing.isLoading || rootsQuery.isLoading}
              error={
                rootsQuery.isError
                  ? errorText(rootsQuery.error)
                  : listing.isError
                    ? errorText(listing.error)
                    : null
              }
              truncated={listing.data?.truncated}
              selectedPath={openFile?.path ?? null}
              onOpenFile={openEntry}
              onNewFile={() => openNewEntry('file')}
              onNewFolder={() => openNewEntry('dir')}
              onRefresh={() => {
                listing.refetch()
                rootsQuery.refetch()
              }}
              onRename={(entry) => openRename(entry)}
              onDelete={(entry) => openDelete(entry)}
              onToggleCollapsed={() => setTreeCollapsed(true)}
            />
          </div>
        )}
        <div className="min-h-0 overflow-hidden" data-testid="files-preview-pane">
          <FilePreview
            root={activeRootId ?? ''}
            path={openFile?.path ?? null}
            content={fileContent.data ?? null}
            loading={fileContent.isLoading}
            error={fileContent.isError ? errorText(fileContent.error) : null}
            previewHint={openFile?.previewHint ?? null}
            saving={writeMutation.isPending}
            saveError={writeMutation.isError ? errorText(writeMutation.error) : null}
            // I1: v1 roots default read-only — gate Save/Edit when the active
            // root forbids writes (a missing root is also treated read-only).
            readOnly={activeRoot?.readOnly ?? true}
            onSave={handleSave}
            onDirtyChange={setPreviewDirty}
          />
        </div>
      </div>
    </div>
  )
}

export default FilesRoute

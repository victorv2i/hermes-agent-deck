import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { DropdownMenu } from 'radix-ui'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Globe,
  ListChecks,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { Organization, Project } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { groupSessions, formatRelative, splitRecent } from './grouping'
import {
  useSessionsPaginated,
  useDeckSessions,
  useSessionSearch,
  useDeleteSession,
  useRenameSession,
  useArchiveSession,
  useRailUrlState,
  useShowExternalSources,
  setShowExternalSources,
} from './hooks'
import { usePinnedSessions, togglePin } from './pinStore'
import { setSessionLabel, useSessionLabels, type SessionLabelMap } from './sessionLabels'
import { SessionLabelDialog } from './SessionLabelDialog'
import { parseHighlight, humanizeSnippet } from './searchSnippet'
import { sanitizeSessionPreview } from './sessionPreview'
import { sessionStateIndicator } from './sessionStatus'
import { sessionSourceMeta, splitBySource } from './sessionSource'
import { useOrganization, useCreateProject, useSetSessionOrganization } from './organization/hooks'
import {
  applyOrganizationFilter,
  projectCounts,
  sessionTags,
  sessionProjectId,
  allTags,
  isFilterActive,
  EMPTY_ORGANIZATION,
  NO_FILTER,
  type OrganizationFilter,
} from './organization/organizationFilter'
import { ProjectsSection, SESSION_DRAG_TYPE } from './organization/ProjectsSection'
import { ActiveFilterRow } from './organization/ActiveFilterRow'
import { TagChip } from './organization/TagChip'
import { SessionOrganizeMenu } from './organization/SessionOrganizeMenu'
import type { SessionSummary, SessionSearchResult } from './types'
import { BulkSessionBar, RowSelectCheckbox } from './BulkSessionBar'
import { exportSession } from './api'
import { triggerDownload } from './export'
import { toast } from '@/lib/toast'

/**
 * The session rail. Two views:
 *  - `SessionList` (connected): wires TanStack Query (useSessions /
 *    useSessionSearch), the local pin store, and the delete mutation to the
 *    presentational view. Use this in the AppShell rail.
 *  - `SessionListView` (presentational, exported for tests): grouped Pinned /
 *    Today / Yesterday / Earlier rows, a search box, selection state, and the
 *    per-row pin + delete affordances.
 *
 * Two mutations: PIN is client-side only (a local "float to the top" affordance —
 * the dashboard has no favorite field) and DELETE is real (proxies the
 * dashboard's `DELETE /api/sessions/{id}`, behind a destructive confirm).
 * Rename is not exposed by stock Hermes. Agentdeck offers an honest local
 * label overlay instead: browser-local, visibly marked as local, never written
 * back to Hermes.
 *
 * Calm + quiet per the design language: hairline rows, a SANCTIONED faint
 * sky-blue-tinted selection wash + the sky-blue accent bar (selection is an accent use),
 * skeletons (never spinners), generous spacing.
 */

/**
 * Bulk-operation callbacks for the multi-select workspace mode. When provided,
 * the rail exposes a "Select" toggle that reveals row checkboxes and an action
 * bar (archive / delete / export). The caller owns the mutation logic and any
 * required confirm dialogs.
 */
export interface BulkSessionOps {
  /** Archive all given session ids (PATCH { archived: true } per id). */
  onBulkArchive: (ids: string[]) => void
  /** Delete all given session ids (DELETE per id). Caller confirms before calling. */
  onBulkDelete: (ids: string[]) => void
  /** Export all given session ids. */
  onBulkExport: (ids: string[]) => void
}

export interface SessionListProps {
  /** The currently-open session (highlighted in the rail). */
  selectedId: string | null
  /** Navigate to / open a session's history. */
  onSelect: (id: string) => void
  /**
   * §1 — open a session's READ-ONLY transcript page (`/sessions/:id`). This is
   * the SECONDARY path now that the primary row click RESUMES in place; when
   * provided, each row gets a "View transcript (read-only)" entry in its overflow
   * menu. Omitted on rails that don't offer it (e.g. the mobile slide-over).
   */
  onViewTranscript?: (id: string) => void
  /** Called after the currently-open session is deleted, so the caller can
   * navigate away from the now-gone view. Optional — when omitted, the connected
   * rail can't know the caller's routing, so it does nothing (the rail itself
   * already drops the row). */
  onSessionDeleted?: (id: string) => void
  /**
   * When > 0, float the most-recently-active N sessions into a "Recent" group
   * above the date groups. Off (0) by default so the labeled rail keeps its
   * plain date grouping; the split-rail sessions pane opts in.
   */
  recentLimit?: number
  /**
   * Opt into bulk session management. When true, the connected rail shows the
   * multi-select "Select" toggle and SELF-WIRES the bar's archive/delete/export
   * actions to its own mutations (the rail already owns delete + archive). The
   * History surface opts in; the compact left rail does not.
   */
  enableBulkOps?: boolean
  /**
   * Dense / clean rail mode (default false). When true, the rail renders a
   * competitor-style list and SUPPRESSES the power-user management UI: multi-select
   * + bulk bar, the Projects/folders + drag-to-organize + active-filter row +
   * per-row tag chips, the external-source "Other sessions" reveal, the "Load more"
   * pagination footer, and the duplicate "Label session (local)" rename path. It
   * KEEPS search, date grouping, active highlight, relative timestamps, and the
   * per-row overflow with Rename + Delete (+ Pin). It also floats a non-interactive
   * ACTIVE "New chat" indicator row at the top whenever `selectedId` is null (a
   * fresh, unsent conversation), so a new chat is visibly present in the rail
   * (ChatGPT/Claude-style; you START one via the sidebar's "New chat" button). The chat
   * rail + mobile embed pass this; the History surface does NOT (full-featured view).
   */
  dense?: boolean
}

/**
 * Connected session rail — wires TanStack Query (sessions + full-text search),
 * the local pin store, and the delete mutation to {@link SessionListView}. Place
 * this in the AppShell left rail. Search is debounced so each
 * keystroke doesn't hit the FTS index.
 */
export function SessionList({
  selectedId,
  onSelect,
  onViewTranscript,
  onSessionDeleted,
  recentLimit = 0,
  enableBulkOps = false,
  dense = false,
}: SessionListProps) {
  // Refresh-durable rail state. Search + the project/tag filter live in the URL
  // (deep-linkable + survive a reload); the sticky external-source toggle lives in
  // localStorage. See hooks.ts for why these are router-independent stores.
  const [railUrl, setRailUrl] = useRailUrlState()
  const search = railUrl.search
  const setSearch = (value: string) => setRailUrl({ search: value })
  const debounced = useDebounced(search, 200)
  // The id awaiting destructive confirmation (null = no dialog open).
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  // The active project/tag filter (the Projects section + tag chips drive this),
  // mirrored from the URL so it restores on refresh.
  const filter: OrganizationFilter = useMemo(
    () => ({ projectId: railUrl.projectId, tag: railUrl.tag }),
    [railUrl.projectId, railUrl.tag],
  )
  const setFilter = (
    update: OrganizationFilter | ((prev: OrganizationFilter) => OrganizationFilter),
  ) => {
    const next = typeof update === 'function' ? update(filter) : update
    setRailUrl({ projectId: next.projectId, tag: next.tag })
  }
  // §3 — whether external (cli/telegram/discord/cron) sources are revealed. The
  // pane + History default to web/agent-deck-originated sessions; external ones
  // are an opt-in reveal, never a default dump. Sticky across refresh.
  const showExternalSources = useShowExternalSources()

  const list = useSessionsPaginated()
  // The deck's OWN (dashboard-sourced) sessions, fetched by source so they show
  // even when older than the recency-paginated first page. Only the dense chat
  // rail merges these in (below); History keeps pure recency pagination.
  const deckSessions = useDeckSessions(dense)
  const searchQuery = useSessionSearch(debounced)
  const deleteMutation = useDeleteSession()
  const renameMutation = useRenameSession()
  const archiveMutation = useArchiveSession()
  const pinnedIds = usePinnedSessions()
  const localLabels = useSessionLabels()
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(null)
  // The id of the session pending archive confirmation (null = no dialog open).
  const [pendingArchive, setPendingArchive] = useState<string | null>(null)
  // Inline rename state: which session is being renamed + the draft value.
  const [inlineRenaming, setInlineRenaming] = useState<{ id: string; value: string } | null>(null)
  const searching = debounced.trim().length > 0

  // Agentdeck's own project/tag store. Backs the Projects section, tag chips,
  // the active-filter row, and the per-session assignment menu — all one query.
  const orgQuery = useOrganization()
  const org = orgQuery.data ?? EMPTY_ORGANIZATION
  const createProject = useCreateProject()
  const setSessionOrg = useSetSessionOrganization()

  // The dense chat rail UNIONS the deck's own (dashboard) sessions with the
  // recency page so the web-first fold has the deck's chats to scope to even when
  // they're older than the loaded page. Deck sessions lead (they're the default
  // view); dedupe by id so a deck chat that IS recent appears once. History (not
  // dense) shows the recency page as-is.
  const sessions = useMemo(() => {
    if (!dense || deckSessions.length === 0) return list.sessions
    const seen = new Set(list.sessions.map((s) => s.id))
    const olderDeck = deckSessions.filter((s) => !seen.has(s.id))
    return olderDeck.length === 0 ? list.sessions : [...olderDeck, ...list.sessions]
  }, [dense, deckSessions, list.sessions])
  // A title lookup so search results can LEAD with the real session title (the
  // search wire shape carries no title) when the matched session is loaded.
  const titleById = sessionTitleMap(sessions, localLabels)

  // Filtering composes BEFORE the existing pinned/recent/date grouping (and is a
  // no-op while a text search is active, where the rail shows ranked hits).
  const filtered = applyOrganizationFilter(sessions, org, filter)

  // §3 — compose the SOURCE default at the same seam: split the org-filtered list
  // into web-originated vs external, then scope the rendered list to web-only
  // until the user reveals external sources. One fetch; the toggle only widens
  // the source scope (it never refetches with ?source=). The count of hidden
  // external rows names the "Other sessions (N)" reveal.
  const { web: webFiltered, external: externalFiltered } = splitBySource(filtered)
  // On a real Hermes install most/all sessions are external (cli/telegram/cron);
  // if there are NO web-originated sessions, show everything by default instead of
  // a scary "No sessions yet — start a chat" over hundreds of real conversations.
  // The web-first default still applies whenever any web chat exists.
  const noWebSessions = webFiltered.length === 0 && externalFiltered.length > 0
  // §3 — scope the rail to web-originated (agent-deck) sessions by default; the
  // external (cli/telegram/discord/cron/api) sessions fold under the collapsed
  // "Other sessions (N)" toggle until the user reveals them. This web-first
  // default applies in BOTH the dense chat rail AND the full History rail (the
  // dense rail wires the same reveal toggle, below). The only escape hatch is
  // `noWebSessions` — when there is no web-only view to fall back to, show all.
  const sourceScoped = showExternalSources || noWebSessions ? filtered : webFiltered

  const pendingSession = pendingDelete
    ? (sessions.find((s) => s.id === pendingDelete) ?? null)
    : null

  const confirmDelete = () => {
    if (!pendingDelete) return
    const id = pendingDelete
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setPendingDelete(null)
        // If the open session was the one deleted, let the caller route away.
        if (id === selectedId) onSessionDeleted?.(id)
      },
    })
  }

  const confirmArchive = () => {
    if (!pendingArchive) return
    const id = pendingArchive
    archiveMutation.mutate({ id, archived: true }, { onSuccess: () => setPendingArchive(null) })
  }

  const submitInlineRename = () => {
    if (!inlineRenaming) return
    const { id, value } = inlineRenaming
    const trimmed = value.trim()
    if (!trimmed) {
      setInlineRenaming(null)
      return
    }
    renameMutation.mutate(
      { id, patch: { title: trimmed } },
      { onSuccess: () => setInlineRenaming(null) },
    )
  }

  // Toggle a tag filter from a row chip (clicking the active tag clears it).
  const onFilterTag = (tag: string) => setFilter((f) => ({ ...f, tag: f.tag === tag ? null : tag }))

  // Set a session's full organization (project + tags) via the assignment menu.
  const onSetSessionOrganization = (
    id: string,
    input: { projectId: string | null; tags: string[] },
  ) => setSessionOrg.mutate({ id, input })

  const tagSuggestions = allTags(org)

  const pendingArchiveSession = pendingArchive
    ? (sessions.find((s) => s.id === pendingArchive) ?? null)
    : null

  // Bulk-ops handlers — self-wired to the rail's own mutations when the caller
  // opts in (enableBulkOps). Archive + delete reuse the single-row mutations (one
  // call per id); the bar's confirm dialog gates delete. Export fetches each
  // selected session's authoritative Hermes dump and downloads them as a single
  // combined JSON (one file, so the browser's multi-download block never fires).
  const bulkOps = useMemo<BulkSessionOps | undefined>(() => {
    if (!enableBulkOps) return undefined
    return {
      onBulkArchive: (ids) => {
        for (const id of ids) archiveMutation.mutate({ id, archived: true })
      },
      onBulkDelete: (ids) => {
        for (const id of ids) deleteMutation.mutate(id)
        if (selectedId && ids.includes(selectedId)) onSessionDeleted?.(selectedId)
      },
      onBulkExport: (ids) => {
        void (async () => {
          try {
            const payloads = await Promise.all(ids.map((id) => exportSession(id)))
            const json = JSON.stringify(payloads, null, 2)
            const filename = `agent-deck-sessions-${ids.length}.json`
            triggerDownload(filename, json, 'application/json')
            toast.success(`Exported ${ids.length} session${ids.length === 1 ? '' : 's'}`, {
              description: filename,
            })
          } catch {
            toast.error('Export failed', {
              description: "Couldn't fetch one or more sessions from Hermes.",
            })
          }
        })()
      },
    }
  }, [enableBulkOps, archiveMutation, deleteMutation, selectedId, onSessionDeleted])

  return (
    <>
      <SessionListView
        sessions={sourceScoped}
        // P2 — the "All sessions" badge shows the SERVER total, not the loaded
        // (≤ pageSize) length, so the count is honest before paging in more.
        unfilteredCount={list.total}
        loadedCount={list.loaded}
        hasMore={list.hasMore}
        isFetchingMore={list.isFetchingNextPage}
        // "Load more" is wired in BOTH the dense rail and History so older chats
        // are always reachable by paging back (the dense rail used to suppress it).
        onLoadMore={list.fetchNextPage}
        isLoading={list.isLoading}
        error={list.isError ? 'error' : null}
        onRetry={list.refetch}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        onSelect={onSelect}
        onViewTranscript={onViewTranscript}
        titleById={titleById}
        localLabels={localLabels}
        // The duplicate "Label session (local)" rename path is a power-user
        // affordance — suppressed in the clean dense rail (the real Hermes Rename
        // stays). Withholding the callback removes the menu item.
        onRequestLocalRename={
          dense
            ? undefined
            : (id) => {
                const session = sessions.find((s) => s.id === id)
                if (session) setRenamingSession(session)
              }
        }
        searchResults={searching ? (searchQuery.data?.results ?? []) : undefined}
        isSearching={searching && searchQuery.isLoading}
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
        onRequestDelete={(id) => setPendingDelete(id)}
        onRequestArchive={(id) => setPendingArchive(id)}
        inlineRenaming={inlineRenaming}
        onStartInlineRename={(id) => {
          const session = sessions.find((s) => s.id === id)
          const current = session ? localLabels[id]?.trim() || session.title?.trim() || '' : ''
          setInlineRenaming({ id, value: current })
        }}
        onInlineRenameChange={(value) => setInlineRenaming((r) => (r ? { ...r, value } : null))}
        onInlineRenameSubmit={submitInlineRename}
        onInlineRenameCancel={() => setInlineRenaming(null)}
        isRenaming={renameMutation.isPending}
        renameError={renameMutation.isError ? "Couldn't rename. Try again." : null}
        recentLimit={recentLimit}
        // The organization layer (Projects/folders + drag-to-organize +
        // active-filter row + per-row tag chips) is power-user management UI —
        // suppressed in the clean dense rail by withholding its wiring, so
        // SessionListView's prop-absence gating doesn't mount it.
        organization={dense ? undefined : org}
        projects={dense ? undefined : org.projects}
        filter={dense ? undefined : filter}
        onSelectProject={dense ? undefined : (projectId) => setFilter((f) => ({ ...f, projectId }))}
        onFilterTag={dense ? undefined : onFilterTag}
        onClearFilter={dense ? undefined : () => setFilter(NO_FILTER)}
        projectCounts={dense ? undefined : projectCounts(org, sessions)}
        tagSuggestions={dense ? undefined : tagSuggestions}
        onSetSessionOrganization={dense ? undefined : onSetSessionOrganization}
        onCreateProject={dense ? undefined : (input) => createProject.mutateAsync(input)}
        // §3 — external-source reveal. BOTH the dense chat rail and History wire
        // the collapsed "Other sessions (N)" toggle so external sessions fold away
        // by default and the user can expand them. When all sessions are external
        // (no web-only view to toggle back to), suppress the reveal — they're
        // already shown (count 0 hides the toggle).
        externalSourceCount={noWebSessions ? 0 : externalFiltered.length}
        showExternalSources={showExternalSources || noWebSessions}
        onToggleExternalSources={() => setShowExternalSources(!showExternalSources)}
        // Multi-select + bulk bar is power-user management UI — only ever wired
        // when the caller opts into bulk ops (History); dense rails never do.
        onBulkOps={dense ? undefined : bulkOps}
        // §2 — when wired (the chat rail + mobile embed), float an ACTIVE "New chat"
        // row at the top while selectedId is null, so a new chat is visibly present.
        dense={dense}
      />
      <DeleteSessionDialog
        open={pendingDelete !== null}
        sessionLabel={
          pendingSession
            ? localLabels[pendingSession.id]?.trim() || originalRowLabel(pendingSession)
            : null
        }
        busy={deleteMutation.isPending}
        error={deleteMutation.isError ? "Couldn't delete this session. Try again." : null}
        onConfirm={confirmDelete}
        onCancel={() => {
          setPendingDelete(null)
          deleteMutation.reset()
        }}
      />
      <ArchiveSessionDialog
        open={pendingArchive !== null}
        sessionLabel={
          pendingArchiveSession
            ? localLabels[pendingArchiveSession.id]?.trim() ||
              originalRowLabel(pendingArchiveSession)
            : null
        }
        busy={archiveMutation.isPending}
        error={archiveMutation.isError ? "Couldn't archive this session. Try again." : null}
        onConfirm={confirmArchive}
        onCancel={() => {
          setPendingArchive(null)
          archiveMutation.reset()
        }}
      />
      <SessionLabelDialog
        open={renamingSession !== null}
        title={renamingSession ? originalRowLabel(renamingSession) : 'Untitled session'}
        value={renamingSession ? (localLabels[renamingSession.id] ?? '') : ''}
        onSave={(label) => {
          if (renamingSession) setSessionLabel(renamingSession.id, label)
        }}
        onOpenChange={(open) => {
          if (!open) setRenamingSession(null)
        }}
      />
    </>
  )
}

/** Build an `id → display title` map from the loaded rail sessions. */
function sessionTitleMap(
  sessions: SessionSummary[],
  localLabels: SessionLabelMap = {},
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const s of sessions) {
    const title =
      localLabels[s.id]?.trim() ||
      sanitizeSessionPreview(s.title) ||
      sanitizeSessionPreview(s.preview)
    if (title) map[s.id] = title
  }
  return map
}

/** Debounce a changing value (used to throttle the search-as-you-type query). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export interface SessionListViewProps {
  /** The sessions to render — already organization-FILTERED by the connected list. */
  sessions: SessionSummary[]
  /**
   * The count of sessions BEFORE the organization filter (the "All sessions"
   * count + the basis for the "no matches for this filter" empty state). Falls
   * back to `sessions.length` when omitted (the unconnected/labeled rail). The
   * connected rail passes the SERVER total (P2), so this can exceed the loaded
   * length while older history is still un-paged.
   */
  unfilteredCount?: number
  /**
   * P1 — pagination footer. `loadedCount` of `unfilteredCount` are shown in a
   * "Load more" footer; clicking it calls {@link onLoadMore} to page in older
   * sessions. All optional so the unconnected/labeled rail (which passes none)
   * renders exactly as before with no footer.
   */
  /** How many sessions are currently loaded (the rail's paged-in count). */
  loadedCount?: number
  /** Whether more sessions exist on the server than are loaded (shows the footer). */
  hasMore?: boolean
  /** Whether the next page is in flight (the footer reads "Loading…", disabled). */
  isFetchingMore?: boolean
  /** Page in the next batch of older sessions. Omitted ⇒ no footer is rendered. */
  onLoadMore?: () => void
  isLoading: boolean
  selectedId: string | null
  search: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  /** §1 — open a session's read-only transcript (the row overflow's secondary
   * "View transcript" action). Omitted ⇒ no such entry. */
  onViewTranscript?: (id: string) => void
  /** `id → display title` so search results lead with the real session title. */
  titleById?: Record<string, string>
  /** Browser-local labels keyed by session id (honest rename overlay). */
  localLabels?: SessionLabelMap
  /** Open the browser-local label editor for a session. */
  onRequestLocalRename?: (id: string) => void
  /** When searching, the grouped list is replaced by these ranked hits. */
  searchResults?: SessionSearchResult[]
  isSearching?: boolean
  error?: string | null
  /** Retry the sessions query (wired to the rail's refetch). Powers the inline
   * "Try again" affordance shown when the rail can't load (dashboard down). */
  onRetry?: () => void
  /** The set of pinned session ids (floated to a "Pinned" group at the top). */
  pinnedIds?: ReadonlySet<string>
  /** Toggle a session's pinned state. */
  onTogglePin?: (id: string) => void
  /** Request deletion of a session (opens the destructive confirm). */
  onRequestDelete?: (id: string) => void
  /** Request archiving of a session (opens a confirm). */
  onRequestArchive?: (id: string) => void
  /** Inline rename state: which session is being renamed + the draft title. */
  inlineRenaming?: { id: string; value: string } | null
  /** Start an inline rename for the given session id. */
  onStartInlineRename?: (id: string) => void
  /** Update the inline rename draft value. */
  onInlineRenameChange?: (value: string) => void
  /** Commit the inline rename (send to Hermes). */
  onInlineRenameSubmit?: () => void
  /** Cancel an in-progress inline rename. */
  onInlineRenameCancel?: () => void
  /** Whether a rename is in flight. */
  isRenaming?: boolean
  /** Error from the last rename attempt. */
  renameError?: string | null
  /**
   * When > 0, float the most-recently-active N (unpinned) sessions into a
   * "Recent" group above the date groups. 0 (default) keeps the plain date
   * grouping the labeled rail uses.
   */
  recentLimit?: number
  now?: number

  // --- Organization (projects + tags). All optional so the labeled rail (which
  // passes none) renders exactly as before; the split-rail sessions pane opts in.
  /** The full organization store (for per-row tags + the assignment menu). */
  organization?: Organization
  /** Every project (the Projects section rows + the "Move to project" menu). */
  projects?: Project[]
  /** The active project/tag filter. */
  filter?: OrganizationFilter
  /** Select a project to filter by (null = "All sessions"). */
  onSelectProject?: (projectId: string | null) => void
  /** Toggle a tag filter (from a row chip or the active-filter row). */
  onFilterTag?: (tag: string) => void
  /** Clear the whole organization filter. */
  onClearFilter?: () => void
  /** Per-project loaded-session counts (the Projects section). */
  projectCounts?: ReadonlyMap<string, number>
  /** The tag universe (suggestions in the per-session Tags editor). */
  tagSuggestions?: string[]
  /** Set a session's full organization (project + tags). */
  onSetSessionOrganization?: (
    id: string,
    input: { projectId: string | null; tags: string[] },
  ) => void
  /** Create a project; resolves to the created project (assign-on-create). */
  onCreateProject?: (input: { name: string; color: string }) => Promise<Project>

  // --- §3 external-source reveal. The connected rail computes the external
  // count + owns the toggle state; the unconnected/labeled rail passes none, so
  // the "Other sessions (N)" toggle never appears there.
  /** How many of the loaded sessions are from EXTERNAL (non-web) channels — the
   * count named by the reveal toggle. 0 (default) hides the toggle. */
  externalSourceCount?: number
  /** Whether external sources are currently revealed (the toggle's on-state). */
  showExternalSources?: boolean
  /** Toggle the external-source reveal. Omitted ⇒ no toggle is rendered. */
  onToggleExternalSources?: () => void

  // --- Bulk-ops (multi-select workspace mode). All optional; the labeled rail
  // passes none, so it renders exactly as before.
  /**
   * Bulk-ops callbacks. When provided, a "Select" toggle appears above the rail;
   * toggling it reveals per-row checkboxes and, once at least one is checked, the
   * bulk action bar. The connected rail wires these to its mutations; the
   * presentational view just calls them with the selection.
   */
  onBulkOps?: BulkSessionOps

  // --- §2/§3 Dense (clean) chat-rail mode. When true: suppresses the power-user
  // management UI (bulk, projects/tags, external reveal, pagination, local-rename),
  // AND floats a non-interactive ACTIVE "New chat" indicator row at the very top
  // whenever `selectedId` is null (a fresh, unsent conversation) so the new chat is
  // visibly present in the rail. Once the first message creates a session the URL
  // gains a `:id`, `selectedId` becomes non-null, and this indicator yields to the
  // real (now-active) session row. The History surface omits dense (full view).
  dense?: boolean
}

export function SessionListView({
  sessions,
  unfilteredCount,
  loadedCount,
  hasMore = false,
  isFetchingMore = false,
  onLoadMore,
  isLoading,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onViewTranscript,
  titleById,
  localLabels,
  onRequestLocalRename,
  searchResults,
  isSearching = false,
  error = null,
  onRetry,
  pinnedIds,
  onTogglePin,
  onRequestDelete,
  onRequestArchive,
  inlineRenaming,
  onStartInlineRename,
  onInlineRenameChange,
  onInlineRenameSubmit,
  onInlineRenameCancel,
  isRenaming = false,
  renameError,
  recentLimit = 0,
  organization,
  projects,
  filter,
  onSelectProject,
  onFilterTag,
  onClearFilter,
  projectCounts: projectCountMap,
  tagSuggestions,
  onSetSessionOrganization,
  onCreateProject,
  externalSourceCount = 0,
  showExternalSources = false,
  onToggleExternalSources,
  onBulkOps,
  dense = false,
  // Render-time clock for relative-age grouping ("Today"/"Yesterday"). Tests
  // inject a fixed `now`; in the app this read-only timestamp is intentionally
  // evaluated during render, so the react-hooks purity heuristic is opted out.
  // eslint-disable-next-line react-hooks/purity
  now = Date.now(),
}: SessionListViewProps) {
  const searching = search.trim().length > 0
  // §2 — the optimistic "New chat" indicator row. A fresh, unsent conversation
  // (selectedId null) isn't a Hermes session yet, so it never appears in the list
  // below; this synthetic NON-INTERACTIVE active row makes it visibly present at the
  // top of the rail. Only in the dense chat rail (NOT History) and not while
  // searching. When the first message creates a session the URL gains a `:id`,
  // selectedId becomes non-null, and this row yields to the real row — so the two
  // never both show (no duplicate/double-active row). It is NOT a button (you start
  // a new chat via the sidebar's "New chat" button), so it never competes with it.
  const showNewChatRow = dense && selectedId == null && !searching
  // The Projects section + tag chips + assignment menu only mount when the
  // connected rail provides the organization wiring (the labeled rail passes
  // none, so it renders exactly as before).
  const orgEnabled = Boolean(organization && onSelectProject && filter)
  const activeFilter: OrganizationFilter = filter ?? NO_FILTER
  const filtering = orgEnabled && isFilterActive(activeFilter)

  // Phase 2 — drag-to-organize. Available only when the organization layer is
  // wired (it reuses the existing assignment mutation, so no new endpoint). The
  // drag seeds a session id; dropping on a Folder row assigns it there, PRESERVING
  // the session's existing tags (assignment is the full {projectId, tags} PUT).
  // Removing from a folder = dropping on "All sessions" (projectId = null).
  const dragOrganizeEnabled = orgEnabled && Boolean(onSetSessionOrganization && organization)
  const onDragStartSession = dragOrganizeEnabled
    ? (id: string, e: React.DragEvent) => {
        e.dataTransfer.setData(SESSION_DRAG_TYPE, id)
        e.dataTransfer.effectAllowed = 'move'
      }
    : undefined
  const onDropSessionToProject = dragOrganizeEnabled
    ? (projectId: string | null, sessionId: string) => {
        // No-op if the session is already in that folder (avoids a redundant PUT).
        if (sessionProjectId(organization!, sessionId) === projectId) return
        onSetSessionOrganization!(sessionId, {
          projectId,
          tags: sessionTags(organization!, sessionId),
        })
      }
    : undefined

  // --- Multi-select state (bulk ops). Only active when the caller wired onBulkOps.
  // selectMode: whether the Select toggle is ON; selectedIds: the current checked set.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(EMPTY_SELECTION)

  const toggleSelectMode = () => {
    setSelectMode((v) => !v)
    setSelectedIds(EMPTY_SELECTION)
  }
  const toggleRowSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => {
    setSelectedIds(new Set(sessions.map((s) => s.id)))
  }
  const clearSelection = () => {
    setSelectedIds(EMPTY_SELECTION)
    setSelectMode(false)
  }
  const allVisibleSelected = sessions.length > 0 && selectedIds.size === sessions.length

  // Bulk-delete confirm: when user hits "Delete selected" we set a count here.
  const [bulkPendingDelete, setBulkPendingDelete] = useState<string[] | null>(null)

  // The "All sessions" count is the pre-filter total; fall back to the rendered
  // length for the unconnected rail.
  const allCount = unfilteredCount ?? sessions.length
  // Pinned sessions float to a dedicated group at the very top; the rest keep
  // their date grouping. A pinned session appears ONLY in the Pinned group.
  const pinned = pinnedIds ?? EMPTY_PINS
  const pinnedSessions = pinned.size > 0 ? sessions.filter((s) => pinned.has(s.id)) : []
  const unpinnedSessions = pinned.size > 0 ? sessions.filter((s) => !pinned.has(s.id)) : sessions
  // A "Recent" group (opt-in via recentLimit) floats the latest few sessions
  // above the date groups; the remainder still date-groups so nothing is shown
  // twice. Pinned sessions are already excluded above.
  const { recent, rest } = splitRecent(unpinnedSessions, recentLimit)
  const groups = groupSessions(rest, now)

  // Flatten the Pinned / Recent / date groups into ONE ordered stream of items
  // (a header item per section, a row item per session) so a single virtualizer
  // can window the whole rail while PRESERVING the grouping, the section labels,
  // and their order. Only the date-grouped rows can grow large (50+), but
  // flattening pinned + recent in too keeps one scroll model + one tab sequence.
  const flatItems = useMemo<SessionListItem[]>(() => {
    const items: SessionListItem[] = []
    if (pinnedSessions.length > 0) {
      items.push({ kind: 'header', key: '__pinned', label: 'Pinned' })
      for (const s of pinnedSessions) items.push({ kind: 'row', session: s })
    }
    if (recent.length > 0) {
      items.push({ kind: 'header', key: '__recent', label: 'Recent' })
      for (const s of recent) items.push({ kind: 'row', session: s })
    }
    for (const group of groups) {
      items.push({ kind: 'header', key: group.label, label: group.label })
      for (const s of group.sessions) items.push({ kind: 'row', session: s })
    }
    return items
  }, [pinnedSessions, recent, groups])

  const renderRow = (session: SessionSummary) => (
    <SessionRow
      key={session.id}
      session={session}
      selected={session.id === selectedId}
      pinned={pinned.has(session.id)}
      onSelect={onSelect}
      selectMode={selectMode}
      rowSelected={selectedIds.has(session.id)}
      onToggleRowSelect={toggleRowSelect}
      onViewTranscript={onViewTranscript}
      onTogglePin={onTogglePin}
      onRequestDelete={onRequestDelete}
      onRequestArchive={onRequestArchive}
      localLabel={localLabels?.[session.id]}
      onRequestLocalRename={onRequestLocalRename}
      inlineRenaming={inlineRenaming?.id === session.id ? inlineRenaming.value : null}
      onStartInlineRename={onStartInlineRename}
      onInlineRenameChange={onInlineRenameChange}
      onInlineRenameSubmit={onInlineRenameSubmit}
      onInlineRenameCancel={onInlineRenameCancel}
      isRenaming={isRenaming && inlineRenaming?.id === session.id}
      renameError={inlineRenaming?.id === session.id ? renameError : null}
      now={now}
      organization={orgEnabled ? organization : undefined}
      projects={projects}
      filterTag={activeFilter.tag}
      onFilterTag={onFilterTag}
      tagSuggestions={tagSuggestions}
      onSetSessionOrganization={onSetSessionOrganization}
      onCreateProject={onCreateProject}
      onDragStartSession={onDragStartSession}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SearchBox value={search} onChange={onSearchChange} />

      {/* §2 — the optimistic "New chat" row. A fresh, unsent conversation isn't a
          Hermes session yet, so it never shows in the list below; this synthetic
          ACTIVE row sits at the very top of the rail so the new chat is visibly
          present (ChatGPT/Claude-style). It yields to the real session row the
          moment the first message creates a session (selectedId becomes non-null).
          Suppressed during search (the list belongs to the query then). */}
      {showNewChatRow && <NewChatRow />}

      {/* Multi-select workspace: the "Select sessions" toggle (only when
          bulk-ops are wired). A compact labeled ghost control (glyph + label) so
          it reads as a deliberate tool, not a stray word; it sits just above the
          Projects section so it composes naturally with the filter band, and is
          suppressed during active text search. min-h-11 keeps a 44px touch
          target on mobile, relaxed to the compact density on sm+. */}
      {onBulkOps && !searching && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
            className={cn(
              'flex min-h-11 touch-manipulation items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors sm:min-h-0',
              'text-foreground-tertiary hover:bg-muted hover:text-foreground',
              'focus-visible:ad-focus',
              selectMode && 'bg-muted text-foreground',
            )}
          >
            <ListChecks className="size-3.5 shrink-0" aria-hidden />
            Select sessions
          </button>
          {selectMode && (
            <label className="flex min-h-11 touch-manipulation items-center gap-1.5 text-[12px] text-foreground-tertiary sm:min-h-0">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={allVisibleSelected ? clearSelection : selectAll}
                aria-label="Select all visible sessions"
                className="size-4 cursor-pointer rounded border-border-strong bg-surface-1 accent-primary focus-visible:ad-focus"
              />
              <span className="text-[11px]">All</span>
            </label>
          )}
        </div>
      )}

      {/* Bulk-action bar — visible only when select mode is on AND at least one row
          is checked. The bar itself owns the Select-all affordance from this point. */}
      {onBulkOps && selectMode && selectedIds.size > 0 && (
        <>
          <BulkSessionBar
            selectedCount={selectedIds.size}
            totalCount={sessions.length}
            allVisibleSelected={allVisibleSelected}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onArchive={() => onBulkOps.onBulkArchive([...selectedIds])}
            onExport={() => onBulkOps.onBulkExport([...selectedIds])}
            onDelete={() => setBulkPendingDelete([...selectedIds])}
          />
          {/* Bulk-delete confirm dialog (mounted inline here; rendered via portal). */}
          <BulkDeleteConfirmDialog
            open={bulkPendingDelete !== null}
            count={bulkPendingDelete?.length ?? 0}
            onConfirm={() => {
              if (bulkPendingDelete) {
                onBulkOps.onBulkDelete(bulkPendingDelete)
                setBulkPendingDelete(null)
                clearSelection()
              }
            }}
            onCancel={() => setBulkPendingDelete(null)}
          />
        </>
      )}

      {/* The Projects section + active-filter row only show outside text search
          (search owns the whole list while active) and only when wired. */}
      {orgEnabled && !searching && (
        <>
          <ProjectsSection
            projects={projects ?? []}
            selectedProjectId={activeFilter.projectId}
            onSelectProject={onSelectProject!}
            counts={projectCountMap ?? EMPTY_COUNTS}
            totalCount={allCount}
            onCreateProject={async (input) => {
              await onCreateProject?.(input)
            }}
            onDropSession={onDropSessionToProject}
          />
          <ActiveFilterRow
            filter={activeFilter}
            projects={projects ?? []}
            onClearProject={() => onSelectProject!(null)}
            onClearTag={() => onFilterTag?.(activeFilter.tag ?? '')}
            onClearAll={() => onClearFilter?.()}
          />
        </>
      )}

      {/* The grouped rail is VIRTUALIZED (it mounts only the visible window of
          header+row items, so a 50-session rail keeps a handful of nodes in the
          DOM). The non-list branches (error / search / loading / empty) keep a
          plain scroll container — they're small and have their own scroll model. */}
      {!error && !searching && !isLoading && sessions.length > 0 ? (
        <VirtualSessionList
          items={flatItems}
          renderRow={renderRow}
          ariaBusy={isLoading || isSearching}
        />
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto pr-0.5"
          role="list"
          aria-label="Sessions"
          aria-busy={isLoading || isSearching ? 'true' : undefined}
        >
          {error && !searching ? (
            <RailError onRetry={onRetry} />
          ) : searching ? (
            <SearchResults
              results={searchResults ?? []}
              isSearching={isSearching}
              selectedId={selectedId}
              onSelect={onSelect}
              titleById={titleById}
              now={now}
            />
          ) : isLoading ? (
            <Skeletons />
          ) : // A filter that matches nothing reads differently than an empty rail.
          filtering ? (
            <FilteredEmptyState onClear={() => onClearFilter?.()} />
          ) : (
            <EmptyState />
          )}
        </div>
      )}

      {/* P1 — pagination footer. Only in the normal (non-search) list with the
          paginated rail wired and sessions present: names how much history is
          paged in vs the server total, and offers "Load more" while older
          sessions remain. The old rail was hard-capped at the first 50. */}
      {onLoadMore && !error && !searching && !isLoading && sessions.length > 0 && (
        <LoadMoreFooter
          loaded={loadedCount ?? sessions.length}
          total={unfilteredCount ?? sessions.length}
          hasMore={hasMore}
          isFetching={isFetchingMore}
          onLoadMore={onLoadMore}
        />
      )}

      {/* §3 — the opt-in reveal for external (cli/telegram/discord/cron/api)
          sessions, FOLDED at the very bottom of the rail so they're never a
          default dump above the web chats. Quiet, count-named, and only shown
          outside search when there's at least one external session to reveal;
          toggling composes with folder/tag/search above (it just widens the
          source scope — still one fetch). The connected rail owns the count +
          state; the unconnected rail passes none. */}
      {!searching && externalSourceCount > 0 && onToggleExternalSources && (
        <SourceRevealToggle
          count={externalSourceCount}
          on={showExternalSources}
          onToggle={onToggleExternalSources}
        />
      )}
    </div>
  )
}

/**
 * The rail's pagination footer — an honest "loaded of total" line plus a "Load
 * more" affordance while older sessions remain on the server. Calm, quiet, and
 * hairline-bordered to match the rail; the button reads "Loading…" + disables
 * while the next page is in flight. When everything is loaded it shows just the
 * count (no dead button), so the control is never a no-op.
 */
function LoadMoreFooter({
  loaded,
  total,
  hasMore,
  isFetching,
  onLoadMore,
}: {
  loaded: number
  total: number
  hasMore: boolean
  isFetching: boolean
  onLoadMore: () => void
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 border-t border-border pt-2">
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isFetching}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            'focus-visible:ad-focus disabled:cursor-default disabled:opacity-60',
          )}
        >
          {isFetching ? (
            <>
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-foreground-tertiary"
                aria-hidden
              />
              <span>Loading…</span>
            </>
          ) : (
            <span>Load more</span>
          )}
        </button>
      ) : null}
      <span className="text-[11px] text-foreground-tertiary" aria-live="polite">
        Loaded {loaded} of {total}
      </span>
    </div>
  )
}

/** One item in the flattened, virtualized session stream: a section header or a
 * session row. Headers carry the grouping labels (Pinned / Recent / date); rows
 * carry the session to render. */
type SessionListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'row'; session: SessionSummary }

/** Estimated row height (px) before measurement — a compact single-line title
 *  row + meta line (py-1). Rows are MEASURED after mount, so this only seeds the
 *  initial window; it tracks the tightened row so the first paint is close. */
const SESSION_ROW_ESTIMATE = 40
/** Estimated header height (px) — the small section label + its padding. */
const SESSION_HEADER_ESTIMATE = 30

/**
 * The windowed grouped rail. Mirrors the proven VirtualMessageList pattern
 * (`@tanstack/react-virtual`, overscan 6, MEASURED rows) over the flattened
 * header+row stream, so the Pinned / Recent / date grouping, the section labels,
 * keyboard tab order, and per-row actions all behave exactly as the static list
 * did — only off-screen rows are no longer in the DOM.
 *
 * The scroll container keeps `role="list"` + `aria-label="Sessions"` (the rows
 * carry `role="listitem"`); headers sit between groups exactly as before.
 */
function VirtualSessionList({
  items,
  renderRow,
  ariaBusy,
}: {
  items: SessionListItem[]
  renderRow: (session: SessionSummary) => ReactNode
  ariaBusy: boolean
}) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      items[index]?.kind === 'header' ? SESSION_HEADER_ESTIMATE : SESSION_ROW_ESTIMATE,
    overscan: 6,
    getItemKey: (index) => {
      const item = items[index]
      if (!item) return index
      return item.kind === 'header' ? `h:${item.key}` : `r:${item.session.id}`
    },
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto pr-0.5"
      role="list"
      aria-label="Sessions"
      aria-busy={ariaBusy ? 'true' : undefined}
    >
      <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
        {virtualItems.map((vItem) => {
          const item = items[vItem.index]
          if (!item) return null
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {item.kind === 'header' ? (
                <h3 className="ad-section-label px-2 pb-1.5 pt-2">{item.label}</h3>
              ) : (
                // pb-0.5 restores the former inter-row gap-0.5 spacing; padding is
                // measured (margin would collapse outside the row's bounding box).
                <div className="pb-0.5">{renderRow(item.session)}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Stable empty count map so the default never allocates per render. */
const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map()

/** Stable empty pin set so the default never allocates per render. */
const EMPTY_PINS: ReadonlySet<string> = new Set()

/** Stable empty selection set (mutable type) — the initial/reset value for the
 *  bulk-select state. Separate from EMPTY_PINS so the Set<string> state type is
 *  satisfied while still avoiding a per-render allocation. */
const EMPTY_SELECTION: Set<string> = new Set()

/**
 * §2 — the optimistic "New chat" row. A new/unsent conversation lives only in
 * browser state until its first message creates a Hermes session, so it never
 * appears in the Hermes-backed list below; this synthetic row makes it visibly
 * present at the very top of the rail (ChatGPT/Claude-style). It carries the
 * canonical ACTIVE row treatment (the sanctioned faint sky-blue wash + the left sky-blue
 * accent bar) — the same treatment a selected SessionRow gets — because it IS the
 * active conversation while selectedId is null. Clicking it navigates to the new
 * chat. It yields to the real session row the moment the first message creates a
 * session.
 */
function NewChatRow() {
  // NON-INTERACTIVE active indicator: it marks the current new/unsent conversation
  // as present + active in the rail. Deliberately NOT a button — you START a new
  // chat via the sidebar's "New chat" button (components/layout/Sidebar.tsx), so
  // this never competes with it (no duplicate "New chat" control for pointer or
  // screen-reader users).
  return (
    <div
      role="listitem"
      data-testid="rail-new-chat-row"
      aria-current="true"
      className={cn(
        // Mirror the canonical SELECTED rail-row treatment: the faint sky-blue-tinted
        // wash + the left sky-blue accent bar (inset ::before, 3px). Matches the
        // compact SessionRow rhythm (py-1.5) so it sits flush with real rows.
        'relative flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left',
        'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:opacity-100',
        'bg-primary/10',
      )}
    >
      <PencilLine className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate text-13 leading-snug font-medium text-foreground">New chat</span>
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary"
        aria-hidden
      />
      <input
        type="search"
        role="searchbox"
        aria-label="Search sessions"
        placeholder="Search sessions…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-md border border-border bg-surface-2/50 py-2 pl-8 pr-7 text-13',
          'text-foreground placeholder:text-foreground-tertiary',
          'transition-colors hover:border-border-strong',
          'focus-visible:border-ring focus-visible:ad-focus',
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * §3 — the quiet opt-in reveal for external (non-web) sessions opened OUTSIDE the
 * web UI (cli / telegram / cron / discord / api). A calm, full-row toggle pinned
 * at the BOTTOM of the rail that names the count of folded-away external sessions
 * ("Other sessions (N)") rather than dumping them inline with web chats. It's a
 * STATE toggle, not the one action accent, so it stays neutral (never the accent): a
 * muted globe glyph + a chevron that rotates when expanded. `aria-pressed`
 * carries the on/off state for assistive tech.
 */
function SourceRevealToggle({
  count,
  on,
  onToggle,
}: {
  count: number
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors',
        'text-muted-foreground hover:bg-muted hover:text-foreground',
        'focus-visible:ad-focus',
      )}
    >
      <Globe className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
      <span className="flex-1 truncate">Other sessions ({count})</span>
      <ChevronDown
        className={cn(
          'size-3.5 shrink-0 text-foreground-tertiary transition-transform',
          on && 'rotate-180',
        )}
        aria-hidden
      />
    </button>
  )
}

/** The display label for a session row (title → preview → fallback). Shared so
 * the row and the delete dialog name the session identically. */
function originalRowLabel(session: SessionSummary): string {
  return (
    sanitizeSessionPreview(session.title) ||
    sanitizeSessionPreview(session.preview) ||
    'Untitled session'
  )
}

function SessionRow({
  session,
  selected,
  pinned,
  onSelect,
  onViewTranscript,
  onTogglePin,
  onRequestDelete,
  onRequestArchive,
  localLabel,
  onRequestLocalRename,
  inlineRenaming,
  onStartInlineRename,
  onInlineRenameChange,
  onInlineRenameSubmit,
  onInlineRenameCancel,
  isRenaming = false,
  renameError,
  now,
  organization,
  projects,
  filterTag,
  onFilterTag,
  tagSuggestions,
  onSetSessionOrganization,
  onCreateProject,
  selectMode = false,
  rowSelected = false,
  onToggleRowSelect,
  onDragStartSession,
}: {
  session: SessionSummary
  selected: boolean
  pinned: boolean
  onSelect: (id: string) => void
  onViewTranscript?: (id: string) => void
  onTogglePin?: (id: string) => void
  onRequestDelete?: (id: string) => void
  onRequestArchive?: (id: string) => void
  localLabel?: string
  onRequestLocalRename?: (id: string) => void
  /** When non-null, this row is in inline-rename mode; value is the draft. */
  inlineRenaming?: string | null
  onStartInlineRename?: (id: string) => void
  onInlineRenameChange?: (value: string) => void
  onInlineRenameSubmit?: () => void
  onInlineRenameCancel?: () => void
  isRenaming?: boolean
  renameError?: string | null
  now: number
  organization?: Organization
  projects?: Project[]
  filterTag?: string | null
  onFilterTag?: (tag: string) => void
  tagSuggestions?: string[]
  onSetSessionOrganization?: (
    id: string,
    input: { projectId: string | null; tags: string[] },
  ) => void
  onCreateProject?: (input: { name: string; color: string }) => Promise<Project>
  /** Whether the list is in multi-select mode (checkboxes visible). */
  selectMode?: boolean
  /** Whether this row is currently checked in multi-select mode. */
  rowSelected?: boolean
  /** Toggle this row's selected state (multi-select mode). */
  onToggleRowSelect?: (id: string) => void
  /**
   * Phase 2 — make the row a native drag SOURCE for drag-to-organize. When
   * provided, the row is `draggable` and seeds the drag with this session's id;
   * dropping it on a Folder row assigns it. Omitted ⇒ the row isn't draggable.
   */
  onDragStartSession?: (id: string, e: React.DragEvent) => void
}) {
  const originalLabel = originalRowLabel(session)
  const label = localLabel?.trim() || originalLabel
  const meta = metaLine(session, now)
  const tags = organization ? sessionTags(organization, session.id) : []
  // The organize (project + tags) menu is available when the connected rail
  // wired the store; the labeled rail leaves it off.
  const canOrganize = Boolean(organization && onSetSessionOrganization && onCreateProject)
  // The row overflow (⋯) menu mounts when EITHER the organize wiring is present
  // OR a "View transcript" secondary action is offered (§1) — so a row can host
  // the read-only-transcript path even on a rail without the organization layer.
  const hasOverflow =
    canOrganize ||
    Boolean(onViewTranscript || onRequestLocalRename || onStartInlineRename || onRequestArchive)
  // Row actions appear on hover/focus-within (and stay visible for a pinned row,
  // so its pinned state is always legible). They live in a sibling overlay — not
  // nested in the row <button> — so they are real, independently-focusable
  // controls (no button-in-button).
  const hasActions = Boolean(onTogglePin || onRequestDelete || hasOverflow)
  // When in inline-rename mode, show the input in place of the normal row button.
  if (inlineRenaming !== null && inlineRenaming !== undefined) {
    return (
      <InlineRenameRow
        sessionId={session.id}
        value={inlineRenaming}
        onChange={onInlineRenameChange ?? (() => {})}
        onSubmit={onInlineRenameSubmit ?? (() => {})}
        onCancel={onInlineRenameCancel ?? (() => {})}
        busy={isRenaming}
        error={renameError ?? null}
      />
    )
  }

  // Phase 2 — the row is a native drag source for drag-to-organize, but ONLY
  // outside multi-select mode (where dragging would fight the checkbox flow). The
  // keyboard/SR path stays the overflow "Move to folder" menu; drag is a
  // pointer-only accelerator. The drag is seeded by the row's session id.
  const draggable = Boolean(onDragStartSession) && !selectMode
  return (
    <div
      role="listitem"
      className="group/row relative"
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStartSession!(session.id, e) : undefined}
    >
      {/* In select mode, the checkbox sits at the left edge of the row container —
          outside the row <button> so it is a real, independently-focusable control
          (a checkbox nested in a button is invalid HTML). The row button itself
          becomes a toggle for the checkbox. */}
      {selectMode && onToggleRowSelect && (
        <RowSelectCheckbox
          sessionId={session.id}
          label={label}
          checked={rowSelected}
          onChange={() => onToggleRowSelect(session.id)}
        />
      )}
      <button
        type="button"
        onClick={() => {
          if (selectMode && onToggleRowSelect) {
            onToggleRowSelect(session.id)
          } else {
            onSelect(session.id)
          }
        }}
        aria-current={selected ? 'true' : undefined}
        aria-checked={selectMode ? rowSelected : undefined}
        className={cn(
          // Canonical rail-row treatment: SELECTED is a sanctioned accent use — a
          // FAINT sky-blue-tinted wash (`bg-primary/10`) + the left sky-blue accent BAR
          // (::before, 3px inset); hover stays a quiet neutral wash (hover is not
          // selection). The bar is an inset pseudo so it never shifts content.
          // Compact rhythm: a single-line title + a compact meta line, so each row
          // is a tight ~40px (px-2.5 py-1.5, no inter-line gap) for a decluttered
          // rail. The compact density layer trims the vertical padding one notch
          // further (the default read); comfortable keeps this airier baseline.
          'relative flex w-full flex-col items-start gap-0 rounded-lg px-2.5 py-1.5 text-left transition-colors',
          'hover:bg-muted focus-visible:ad-focus',
          'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:opacity-0 before:transition-opacity',
          selected && 'bg-primary/10 before:opacity-100',
          // In select mode: checked rows use border-strong ring (identity/selection,
          // never accent per design spine). Make room for the checkbox on the left.
          selectMode && rowSelected && 'ring-1 ring-border-strong',
          selectMode && 'pl-8',
          // Reserve room on the right so the title never slides under the actions.
          hasActions && 'pr-12',
        )}
      >
        <span className="flex w-full items-center gap-1.5">
          {session.is_active && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-success"
              aria-label="Active"
              title="Active"
            />
          )}
          {/* Single-line title (truncate) for a dense, decluttered rail. The full
              label is always available on hover via the title attribute, and the
              meta line below keeps the row scannable. */}
          <span
            className={cn(
              'truncate min-w-0 flex-1 text-[12px] leading-tight',
              selected ? 'font-medium text-foreground' : 'text-foreground/90',
              localLabel && 'italic',
            )}
            title={localLabel ? `Local label for "${originalLabel}"` : label}
          >
            {label}
          </span>
          <SessionStateIcon session={session} />
        </span>
        <span className="flex w-full items-center gap-1.5 truncate text-[11px] text-foreground-tertiary">
          <SourceDot session={session} />
          {localLabel && (
            <>
              <span className="shrink-0">Local label</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">{meta}</span>
        </span>
      </button>

      {/* Tag chips live OUTSIDE the row button (real buttons can't nest in a
          button) so clicking one filters without opening the session. */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
          {tags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              active={filterTag === tag}
              onClick={onFilterTag ? () => onFilterTag(tag) : undefined}
            />
          ))}
        </div>
      )}

      {hasActions && (
        <div
          className={cn(
            'absolute right-1.5 top-1.5 flex items-center gap-0.5',
            // Quiet by default; revealed on row hover / when any action is focused.
            // A pinned row always shows its (active) pin control.
            'opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100',
            pinned && 'opacity-100',
          )}
        >
          {hasOverflow && (
            <RowOverflowMenu
              sessionId={session.id}
              label={label}
              onViewTranscript={onViewTranscript}
              onRename={onRequestLocalRename}
              onStartInlineRename={onStartInlineRename}
              onArchive={onRequestArchive}
              organize={
                canOrganize
                  ? {
                      projectId: sessionProjectId(organization!, session.id),
                      tags,
                      projects: projects ?? [],
                      tagSuggestions: tagSuggestions ?? [],
                      onSetSessionOrganization: onSetSessionOrganization!,
                      onCreateProject: onCreateProject!,
                    }
                  : undefined
              }
            />
          )}
          {onTogglePin && (
            <RowAction
              label={pinned ? `Unpin ${label}` : `Pin ${label}`}
              onClick={() => onTogglePin(session.id)}
              active={pinned}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </RowAction>
          )}
          {onRequestDelete && (
            <RowAction
              label={`Delete ${label}`}
              onClick={() => onRequestDelete(session.id)}
              destructive
            >
              <Trash2 className="size-3.5" />
            </RowAction>
          )}
        </div>
      )}
    </div>
  )
}

/** The organization-layer wiring for a row's overflow menu (present only when
 * the connected rail provides the project/tag store). */
interface RowOrganizeConfig {
  projectId: string | null
  tags: string[]
  projects: Project[]
  tagSuggestions: string[]
  onSetSessionOrganization: (
    id: string,
    input: { projectId: string | null; tags: string[] },
  ) => void
  onCreateProject: (input: { name: string; color: string }) => Promise<Project>
}

/**
 * The per-row overflow (`⋯`) control. It hosts:
 *  - Rename (real Hermes PATCH, inline): renames the session title on Hermes.
 *  - Archive: soft-hides the session from the default list.
 *  - §1: a "View transcript (read-only)" entry.
 *  - Local label: browser-local label overlay (fallback / complement to rename).
 *  - the organize (project + tags) controls, when the connected rail wired them.
 */
function RowOverflowMenu({
  sessionId,
  label,
  onViewTranscript,
  onRename,
  onStartInlineRename,
  onArchive,
  organize,
}: {
  sessionId: string
  label: string
  onViewTranscript?: (id: string) => void
  /** Local label editor (browser-only, no Hermes write). */
  onRename?: (id: string) => void
  /** Real Hermes rename (PATCH, inline). */
  onStartInlineRename?: (id: string) => void
  /** Archive this session (PATCH { archived: true }). */
  onArchive?: (id: string) => void
  organize?: RowOrganizeConfig
}) {
  const [open, setOpen] = useState(false)
  const organized = Boolean(organize && (organize.tags.length > 0 || organize.projectId !== null))
  const triggerLabel =
    organize && !onViewTranscript && !onStartInlineRename
      ? `Organize ${label}`
      : `More actions for ${label}`
  const hasPrimaryMenuItems = Boolean(
    onViewTranscript || onRename || onStartInlineRename || onArchive,
  )
  return (
    // Non-modal (like the Popover it replaces): a row-action menu must not
    // aria-hide / scroll-lock the rest of the rail. Modal=true would mark the
    // row (and its tag chips) aria-hidden while open, hiding them from AT and
    // from queries.
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <RowAction label={triggerLabel} className="relative">
          <MoreHorizontal className="size-3.5" />
          {organized && (
            <span
              aria-hidden
              data-testid="organize-indicator"
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-foreground-tertiary ring-2 ring-surface-1"
            />
          )}
        </RowAction>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/* A real menu (role="menu") so the trigger advertises aria-haspopup="menu"
            and the items get roving arrow-key focus + typeahead for free (WCAG
            4.1.2 / 2.1.1). The row click that opened it must not bubble to the row
            selection. */}
        <DropdownMenu.Content
          align="end"
          side="bottom"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          className="ad-surface z-50 w-56 rounded-xl bg-popover p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {onStartInlineRename && (
            <DropdownMenu.Item
              onSelect={() => onStartInlineRename(sessionId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 text-muted-foreground transition-colors outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground focus-visible:ad-focus"
            >
              <PencilLine className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
              <span className="flex-1">Rename</span>
            </DropdownMenu.Item>
          )}
          {onArchive && (
            <DropdownMenu.Item
              onSelect={() => onArchive(sessionId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 text-muted-foreground transition-colors outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground focus-visible:ad-focus"
            >
              <Archive className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
              <span className="flex-1">Archive</span>
            </DropdownMenu.Item>
          )}
          {onRename && (
            <DropdownMenu.Item
              onSelect={() => onRename(sessionId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 text-muted-foreground transition-colors outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground focus-visible:ad-focus"
            >
              <PencilLine className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
              <span className="flex-1">Label session</span>
              <span className="text-[11px] text-foreground-tertiary">local</span>
            </DropdownMenu.Item>
          )}
          {onViewTranscript && (
            <DropdownMenu.Item
              onSelect={() => onViewTranscript(sessionId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 text-muted-foreground transition-colors outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground focus-visible:ad-focus"
            >
              <ScrollText className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
              <span className="flex-1">View transcript</span>
              <span className="text-[11px] text-foreground-tertiary">read-only</span>
              <ChevronRight className="size-3.5 text-foreground-tertiary" aria-hidden />
            </DropdownMenu.Item>
          )}
          {organize && hasPrimaryMenuItems && (
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
          )}
          {organize && (
            // The organize flow is a stateful sub-view stack with a text input
            // (Tags). It is rendered INLINE in the same menu surface (preserving
            // the original one-surface behavior) rather than as flat menu items:
            // its own buttons carry role="menuitem", now VALID because they sit
            // inside this real role="menu". They are NOT DropdownMenu.Items, so
            // Radix's roving focus never tracked them (they were Tab-only before
            // too). We stop keydown from bubbling to the menu so the menu's own
            // key model (typeahead / Enter-to-select / arrow nav) can't hijack
            // the tag input's Enter-to-add or steal its keystrokes.
            <div onKeyDown={(e) => e.stopPropagation()}>
              <SessionOrganizeMenu
                sessionId={sessionId}
                projectId={organize.projectId}
                tags={organize.tags}
                projects={organize.projects}
                tagSuggestions={organize.tagSuggestions}
                onSetOrganization={(input) => organize.onSetSessionOrganization(sessionId, input)}
                onCreateProject={organize.onCreateProject}
                onClose={() => setOpen(false)}
              />
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * A small, keyboard-accessible row-overlay action (pin / delete / organize).
 * Forwards ref + extra props so it can serve as a Radix Popover trigger
 * (`asChild`) — the organize menu uses it directly as the `⋯` trigger.
 */
const RowAction = forwardRef<
  HTMLButtonElement,
  {
    label: string
    onClick?: () => void
    active?: boolean
    destructive?: boolean
    children: ReactNode
  } & React.ComponentPropsWithoutRef<'button'>
>(function RowAction(
  { label, onClick, active = false, destructive = false, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        // 44px touch target on mobile (min-h-11 min-w-11); compact on sm+ but the
        // desktop target still clears the 24px AA floor (min-h-6 min-w-6 = 24px).
        'flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-md text-foreground-tertiary transition-colors',
        'sm:min-h-6 sm:min-w-6 sm:p-1',
        'hover:bg-surface-2 hover:text-foreground',
        'focus-visible:ad-focus',
        active && 'text-primary hover:text-primary',
        destructive && 'hover:bg-destructive/10 hover:text-destructive',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

/**
 * The destructive delete confirm. A modal dialog (radix focus-trap + Escape +
 * ARIA): the title names the action, the body names the session, the primary
 * button is destructive, and Cancel is the DEFAULT focus (cancel-default) so an
 * accidental Enter never deletes. Closing via overlay/Escape/Cancel is a
 * no-op; only the explicit Delete button mutates.
 */
function DeleteSessionDialog({
  open,
  sessionLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  sessionLabel: string | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Any close path (overlay / Escape / X) cancels — never deletes — and is
        // ignored while a delete is in flight.
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
          <DialogDescription>
            {sessionLabel ? (
              <>"{sessionLabel}" will be permanently deleted. This can't be undone.</>
            ) : (
              <>This session will be permanently deleted. This can't be undone.</>
            )}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {/* Cancel is the default-focused, default action (cancel-default). */}
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * An inline, keyboard-accessible title input that replaces the row button while
 * a rename is in flight. Enter commits, Escape cancels. A small error line
 * appears below on failure (e.g. title too long). Focus is set on mount via
 * autoFocus. The spinner shows while the PATCH is in flight. The `"local"` badge
 * is NOT shown here — this is a real Hermes rename, not a local label.
 */
function InlineRenameRow({
  sessionId,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  sessionId: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
  error: string | null
}) {
  return (
    <div role="listitem" className="px-2.5 py-1.5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        className="flex items-center gap-1.5"
      >
        <input
          type="text"
          aria-label={`Rename session ${sessionId}`}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          disabled={busy}
          maxLength={120}
          className={cn(
            'min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-13 text-foreground',
            'focus-visible:border-ring focus-visible:ad-focus',
            'disabled:opacity-60',
            error && 'border-destructive/50',
          )}
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Save rename"
          className="flex size-6 shrink-0 items-center justify-center rounded text-foreground-tertiary hover:text-foreground focus-visible:ad-focus disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <span className="text-[11px] font-medium text-primary">Save</span>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel rename"
          className="flex size-6 shrink-0 items-center justify-center rounded text-foreground-tertiary hover:text-foreground focus-visible:ad-focus disabled:opacity-40"
        >
          <X className="size-3.5" />
        </button>
      </form>
      {error && <p className="mt-0.5 pl-0.5 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

/**
 * The archive confirm dialog. Soft-archive hides the session from the default
 * list without deleting it. Cancel-default: Cancel is auto-focused so an
 * accidental Enter never archives.
 */
function ArchiveSessionDialog({
  open,
  sessionLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  sessionLabel: string | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Archive session?</DialogTitle>
          <DialogDescription>
            {sessionLabel ? (
              <>
                "{sessionLabel}" will be hidden from the default list. You can still access archived
                sessions from your Hermes dashboard.
              </>
            ) : (
              <>
                This session will be hidden from the default list. Archived sessions remain in
                Hermes.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="outline" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
            Archive
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The subtle, accessible per-session state marker. Renders NOTHING for the
 * common case (running/completed/normal) so calm rows stay calm; only a
 * failed/errored session (a destructive warning triangle) or a handed-off
 * session (a neutral branch glyph) earns a marker. State is conveyed by
 * SHAPE/ICON + an aria-label/title — governed semantic color, never the action accent, and
 * never color alone (colorblind-safe). Sized to sit quietly inside a dense rail
 * row beside the title.
 */
function SessionStateIcon({ session }: { session: SessionSummary }) {
  const indicator = sessionStateIndicator(session)
  if (!indicator) return null
  if (indicator.kind === 'failed') {
    return (
      <TriangleAlert
        className="size-3.5 shrink-0 text-destructive"
        role="img"
        aria-label={indicator.label}
      >
        <title>{indicator.label}</title>
      </TriangleAlert>
    )
  }
  return (
    <GitBranch
      className="size-3.5 shrink-0 text-foreground-tertiary"
      role="img"
      aria-label={indicator.label}
    >
      <title>{indicator.label}</title>
    </GitBranch>
  )
}

/** Maps a governed source tone to its semantic dot color (never the action accent). */
const SOURCE_DOT_TONE: Record<ReturnType<typeof sessionSourceMeta>['tone'], string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-foreground-tertiary',
}

/**
 * A small per-row dot signalling where the session opened (CLI / Web / API /
 * scheduled / …). The channel is conveyed by a governed semantic color PLUS an
 * accessible label/title (never color alone), so it's colorblind-safe and can
 * never be confused with the sky-blue active marker.
 */
function SourceDot({ session }: { session: SessionSummary }) {
  const meta = sessionSourceMeta(session)
  return (
    <span
      className={cn('size-1.5 shrink-0 rounded-full', SOURCE_DOT_TONE[meta.tone])}
      role="img"
      aria-label={meta.label}
      title={meta.label}
    />
  )
}

function SearchResults({
  results,
  isSearching,
  selectedId,
  onSelect,
  titleById,
  now,
}: {
  results: SessionSearchResult[]
  isSearching: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  titleById?: Record<string, string>
  now: number
}) {
  if (isSearching) return <Skeletons />
  if (results.length === 0) {
    return (
      <p role="status" className="px-2 py-3 text-xs leading-relaxed text-foreground-tertiary">
        No matching sessions.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {results.map((r) => (
        <SearchResultRow
          key={r.id}
          result={r}
          selected={r.id === selectedId}
          onSelect={onSelect}
          title={titleById?.[r.id]}
          now={now}
        />
      ))}
    </div>
  )
}

function SearchResultRow({
  result: r,
  selected,
  onSelect,
  title,
  now,
}: {
  result: SessionSearchResult
  selected: boolean
  onSelect: (id: string) => void
  /** The matched session's real title (when it's loaded in the rail). */
  title?: string
  now: number
}) {
  // T1.7: LEAD with the session title (or an honest humanized fallback), then a
  // human snippet that keeps the backend's match markers — STYLED, not deleted.
  const heading = title?.trim() || resultFallbackTitle(r)
  const snippet = humanizeSnippet(r.snippet)
  const meta = [r.source, r.model, r.started_at ? formatRelative(r.started_at, now) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={() => onSelect(r.id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors',
        'hover:bg-muted focus-visible:ad-focus',
        'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:opacity-0 before:transition-opacity',
        selected && 'bg-primary/10 before:opacity-100',
      )}
    >
      <span
        className={cn(
          'line-clamp-1 w-full text-13 leading-snug',
          selected ? 'font-medium text-foreground' : 'font-medium text-foreground/90',
        )}
      >
        {heading}
      </span>
      {snippet && (
        <span className="line-clamp-2 text-[12px] leading-snug text-foreground-tertiary">
          <HighlightedSnippet snippet={snippet} />
        </span>
      )}
      {meta && <span className="text-[11px] text-foreground-tertiary/80">{meta}</span>}
    </button>
  )
}

/**
 * Render a search snippet with the backend's match markers STYLED (governed
 * sky-blue + medium weight) rather than stripped — the one affordance that tells
 * you *why* a session matched. `parseHighlight` recognizes both the live
 * dashboard's `>>>…<<<` form and the legacy `<b>…</b>` form. Rendered as safe
 * React nodes (never dangerouslySetInnerHTML on untrusted content).
 */
function HighlightedSnippet({ snippet }: { snippet: string }) {
  const segments = parseHighlight(snippet)
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-[2px] bg-primary/15 px-0.5 font-medium text-primary">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

/** When the matched session isn't loaded in the rail (so we have no title), lead
 * with an honest humanized label rather than a blank or raw-JSON line. */
function resultFallbackTitle(r: SessionSearchResult): string {
  const where = r.role ? `${capitalize(r.role)} message` : 'Session match'
  return r.source ? `${where} · ${r.source}` : where
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2 px-2 pt-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} data-testid="session-skeleton" className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-13 text-foreground-tertiary">No sessions yet.</p>
      <p className="mt-1 text-[11px] leading-relaxed text-foreground-tertiary">
        Start a chat to see it here.
      </p>
    </div>
  )
}

/**
 * The dashboard-down rail error. Matches the app's carded "couldn't load"
 * vocabulary but at RAIL scale: a small, calm, destructive-tinted card with a
 * hairline (never a bare red line), a one-line honest reason, and a tiny
 * "Try again" affordance wired to the sessions query refetch. Fits the narrow
 * rail — full width, generous wrapping, no fixed min-width.
 */
function RailError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="mx-2 mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2"
    >
      <div className="flex items-start gap-1.5">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
        <p className="text-[12px] leading-relaxed text-foreground/80">
          Couldn't load sessions. The hermes dashboard may be offline.
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 ml-5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
        >
          <RefreshCw className="size-3" aria-hidden />
          Try again
        </button>
      )}
    </div>
  )
}

/** Shown when an active project/tag filter matches no sessions (vs an empty rail). */
function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div role="status" className="px-2 py-6 text-center">
      <p className="text-13 text-foreground-tertiary">No sessions match this filter.</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1.5 rounded px-1 py-0.5 text-[11px] text-foreground-tertiary underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ad-focus"
      >
        Clear filter
      </button>
    </div>
  )
}

/**
 * Bulk-delete confirm dialog. Names the count so the user can judge scope.
 * Cancel is auto-focused (cancel-default); only the explicit Delete button
 * triggers the mutation.
 */
function BulkDeleteConfirmDialog({
  open,
  count,
  onConfirm,
  onCancel,
}: {
  open: boolean
  count: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Delete {count} session{count === 1 ? '' : 's'}?
          </DialogTitle>
          <DialogDescription>
            {count === 1
              ? 'This session will be permanently deleted. This cannot be undone.'
              : `These ${count} sessions will be permanently deleted. This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete {count === 1 ? 'session' : `${count} sessions`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A quiet one-line summary: relative age · model · message count. */
function metaLine(session: SessionSummary, now: number): string {
  const parts: string[] = [formatRelative(session.last_active, now)]
  if (session.model) parts.push(shortModel(session.model))
  if (session.message_count > 0) parts.push(`${session.message_count} msg`)
  return parts.join(' · ')
}

/** `anthropic/claude-sonnet-4` → `claude-sonnet-4`. */
function shortModel(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}

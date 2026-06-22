import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  fetchSessions,
  fetchSession,
  fetchSessionMessages,
  searchSessions,
  deleteSession,
  fetchSessionStats,
  patchSession,
  exportSession,
  pruneSessions,
  type ListSessionsParams,
} from './api'
import { unpinSession } from './pinStore'
import type {
  SessionSummary,
  SessionListResponse,
  SessionDetail,
  SessionMessagesResponse,
  SessionSearchResponse,
  SessionStats,
  SessionPatchRequest,
  SessionPatchResponse,
  SessionPruneRequest,
  SessionPruneResponse,
  SessionExportPayload,
} from './types'

/**
 * TanStack Query hooks for the Sessions surface. This is where react-query
 * earns its keep: the rail stays fresh while opening a session caches its
 * detail + transcript, and search is debounced + cached by query string.
 *
 * Query keys are namespaced under `['sessions', …]` so the integrator can
 * invalidate the rail after a continued run lands a new session/turn.
 */

export const sessionKeys = {
  all: ['sessions'] as const,
  list: (params: ListSessionsParams) => ['sessions', 'list', params] as const,
  /** Offset-paginated rail (useInfiniteQuery). Keyed by page SIZE only — the
   * offset is the per-page cursor, so all pages share one key and a rail mutation
   * (delete/rename/archive) that invalidates `['sessions', …]` refetches them. */
  paginated: (pageSize: number) => ['sessions', 'paginated', pageSize] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
  messages: (id: string) => ['sessions', 'messages', id] as const,
  search: (q: string) => ['sessions', 'search', q] as const,
  stats: () => ['sessions', 'stats'] as const,
  export: (id: string) => ['sessions', 'export', id] as const,
}

export function useSessions(params: ListSessionsParams = {}): UseQueryResult<SessionListResponse> {
  return useQuery({
    queryKey: sessionKeys.list(params),
    queryFn: ({ signal }) => fetchSessions(params, signal),
    // The rail should feel live; refetch quietly when the tab refocuses.
    staleTime: 10_000,
  })
}

/** Default rail page size (one BFF list page). */
export const RAIL_PAGE_SIZE = 50

/** The flattened shape a rail consumer needs from the paginated rail. */
export interface PaginatedSessions {
  /** Every session loaded so far (all fetched pages, in server order). */
  sessions: SessionSummary[]
  /** The server's total session count (NOT the loaded length). */
  total: number
  /** How many sessions are loaded so far. */
  loaded: number
  /** Whether there are more sessions on the server than are loaded. */
  hasMore: boolean
  /** Fetch the next page (older sessions). No-op when already fetching / done. */
  fetchNextPage: () => void
  /** Whether the next page is being fetched (drives the "Loading…" footer). */
  isFetchingNextPage: boolean
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

/**
 * Offset-paginated session rail — the ONLY consumer is {@link SessionList}, so
 * the plain `useSessions({ limit })` shape stays intact for App/Home/
 * CommandPalette. Each page is a BFF list call at the next offset; `total` (from
 * the first page) names how many sessions exist server-side, so the rail can show
 * a real "Load more" footer + an honest "loaded of total" count instead of the
 * old hard-capped 50.
 */
export function useSessionsPaginated(pageSize: number = RAIL_PAGE_SIZE): PaginatedSessions {
  const query: UseInfiniteQueryResult<InfiniteData<SessionListResponse>> = useInfiniteQuery({
    queryKey: sessionKeys.paginated(pageSize),
    // order=recent (by latest activity) so the FIRST page always holds the
    // most-recently-active sessions — the rail's Recent grouping sorts what is
    // LOADED, so created-order pagination could leave a recently-active old
    // session stranded on an unfetched page.
    queryFn: ({ pageParam, signal }) =>
      fetchSessions({ limit: pageSize, offset: pageParam, order: 'recent' }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // Tolerate a page that omits sessions/total (a degraded/empty BFF response):
      // the old useSessions path defaulted these, so the rail must never crash on it.
      const loaded = allPages.reduce((n, page) => n + (page.sessions?.length ?? 0), 0)
      // Stop when we've loaded everything the server reports (or a short page
      // signalled the tail), so the footer disappears at the real end.
      return loaded < (lastPage.total ?? 0) && (lastPage.sessions?.length ?? 0) > 0
        ? loaded
        : undefined
    },
    staleTime: 10_000,
    // Re-sort the rail by activity LIVE while the page is open (no manual refresh):
    // poll on an interval and refetch on tab focus, so a session that just got
    // activity (a new message here, or a cli/telegram/cron run elsewhere) moves to
    // the top of its date group on its own within the interval.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const pages = query.data?.pages
  const sessions = useMemo(() => (pages ?? []).flatMap((p) => p.sessions ?? []), [pages])
  // The freshest total wins (a refetch of page 0 updates it after deletes).
  const total = pages && pages.length > 0 ? (pages[pages.length - 1]?.total ?? sessions.length) : 0
  // react-query's fetchNextPage / refetch are stable references; wrap them so the
  // returned callbacks discard the promise without leaking it to the caller.
  const { fetchNextPage: rqFetchNext, refetch: rqRefetch } = query
  const fetchNextPage = useCallback(() => {
    void rqFetchNext()
  }, [rqFetchNext])
  const refetch = useCallback(() => {
    void rqRefetch()
  }, [rqRefetch])

  return {
    sessions,
    total,
    loaded: sessions.length,
    hasMore: query.hasNextPage,
    fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch,
  }
}

/**
 * The Hermes `source` tags for a chat opened through THIS deck. The deck drives
 * the gateway, which stamps the session by its ingress:
 *  - `api_server`: the current tag, since the deck moved to the gateway's
 *    `/v1/runs` transport on 2026-05-29 (the gateway owns the tag; the deck
 *    cannot relabel it, see the gateway-v1-runs contract).
 *  - `dashboard`: the pre-switch tag (the deck drove the dashboard's chat).
 * The rail surfaces BOTH so no chat is lost across that cutover. Every other
 * channel (cli / telegram / cron / handoff / …) stays external.
 */
export const DECK_SESSION_SOURCES = ['dashboard', 'api_server'] as const

/** Stable empty array so the hook returns a referentially-stable default. */
const NO_DECK_SESSIONS: SessionSummary[] = []

/** One source-scoped deck fetch; returns the raw session array (or undefined
 * while loading) so the caller can merge across sources. */
function useDeckSourceSessions(source: string, enabled: boolean): SessionSummary[] | undefined {
  const params: ListSessionsParams = { source, limit: 100, order: 'recent' }
  const query = useQuery({
    queryKey: sessionKeys.list(params),
    queryFn: ({ signal }) => fetchSessions(params, signal),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })
  return query.data?.sessions
}

/**
 * The deck's OWN sessions, fetched BY SOURCE so they surface regardless of age.
 *
 * The recency-paginated rail ({@link useSessionsPaginated}) loads only the first
 * page of the most-recently-active sessions. On a busy install hundreds of
 * recent cli/telegram/cron sessions push the deck's sparse, often-older chats
 * far past that page, so a pure client-side split finds NO web-originated
 * sessions and trips the rail's "nothing web here, show everything" fallback —
 * defeating the web-first fold. These small, capped, source-filtered fetches
 * give the fold a stable non-empty default to scope to (the deck's own chats,
 * across BOTH the legacy `dashboard` and current `api_server` source), so the
 * automated/other-channel sessions can fold under "Other sessions (N)".
 *
 * `enabled` gates it to the dense chat rail; the full History surface keeps its
 * pure recency pagination.
 */
export function useDeckSessions(enabled: boolean): SessionSummary[] {
  // A fixed number of source fetches (Rules of Hooks): one per deck source.
  const legacy = useDeckSourceSessions('dashboard', enabled)
  const current = useDeckSourceSessions('api_server', enabled)
  return useMemo(() => {
    const merged: SessionSummary[] = []
    const seen = new Set<string>()
    for (const session of [...(legacy ?? []), ...(current ?? [])]) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      merged.push(session)
    }
    if (merged.length === 0) return NO_DECK_SESSIONS
    // Most-recently-active first: a stable order across the two source queries
    // for the consumer's union + date grouping.
    merged.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
    return merged
  }, [legacy, current])
}

export function useSession(id: string | null): UseQueryResult<SessionDetail> {
  return useQuery({
    queryKey: sessionKeys.detail(id ?? ''),
    queryFn: ({ signal }) => fetchSession(id as string, signal),
    enabled: id !== null && id !== '',
  })
}

export function useSessionMessages(id: string | null): UseQueryResult<SessionMessagesResponse> {
  return useQuery({
    queryKey: sessionKeys.messages(id ?? ''),
    queryFn: ({ signal }) => fetchSessionMessages(id as string, signal),
    enabled: id !== null && id !== '',
  })
}

export function useSessionSearch(q: string): UseQueryResult<SessionSearchResponse> {
  const trimmed = q.trim()
  return useQuery({
    queryKey: sessionKeys.search(trimmed),
    queryFn: ({ signal }) => searchSessions(trimmed, signal),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Destructive: delete a session. On success it invalidates the rail (so the
 * deleted row disappears) and drops any local pin for that id, so the pin set
 * never accumulates ghosts of deleted sessions.
 */
export function useDeleteSession(): UseMutationResult<{ deleted: true }, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: (_res, id) => {
      unpinSession(id)
      qc.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}

/** Session store stats — total/archived/message counts by source. */
export function useSessionStats(): UseQueryResult<SessionStats> {
  return useQuery({
    queryKey: sessionKeys.stats(),
    queryFn: ({ signal }) => fetchSessionStats(signal),
    staleTime: 30_000,
  })
}

/**
 * Rename and/or archive a session (PATCH /api/sessions/{id}).
 * On success, invalidates the rail + the detail cache so the updated title
 * appears immediately. Throws on 400 (bad title) or 404 (session gone).
 */
export function useRenameSession(): UseMutationResult<
  SessionPatchResponse,
  Error,
  { id: string; patch: SessionPatchRequest }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }) => patchSession(id, patch),
    onSuccess: () => {
      // sessionKeys.all (['sessions']) is a prefix of every session key, including
      // the paginated rail (['sessions','paginated',n]) and detail, so it actually
      // refreshes the rail. list({}) is NOT a prefix of the rail key, so the rename
      // stayed invisible there until the next poll.
      qc.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}

/**
 * Archive or unarchive a session (PATCH /api/sessions/{id} with { archived }).
 * On success, invalidates the rail so the row disappears/reappears correctly.
 */
export function useArchiveSession(): UseMutationResult<
  SessionPatchResponse,
  Error,
  { id: string; archived: boolean }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }) => patchSession(id, { archived }),
    onSuccess: () => {
      // Invalidate all session queries (incl. the paginated rail key) so the row
      // disappears/reappears at once; see useRenameSession for why list({}) missed it.
      qc.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}

/**
 * Fetch the full session export payload (metadata + messages). Used by the
 * export-from-hermes action to download the server-side JSON (vs the
 * client-side transcript export in export.ts which only has loaded messages).
 */
export function useSessionExport(id: string | null): UseQueryResult<SessionExportPayload> {
  return useQuery({
    queryKey: sessionKeys.export(id ?? ''),
    queryFn: ({ signal }) => exportSession(id as string, signal),
    enabled: id !== null && id !== '',
    staleTime: 60_000,
  })
}

/**
 * Prune ended sessions older than N days. Returns the count of removed sessions.
 * On success, invalidates the rail and stats cache so counts update immediately.
 */
export function usePruneSessions(): UseMutationResult<
  SessionPruneResponse,
  Error,
  SessionPruneRequest
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req) => pruneSessions(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}

/**
 * Refresh-durable rail filter state. SessionList holds search + the project/tag
 * organization filter in the URL (deep-linkable + survives a reload) and the
 * sticky external-source toggle in localStorage. These two router-INDEPENDENT
 * stores back that (read below for why we don't lean on react-router's
 * `useSearchParams`).
 *
 * Why not `useSearchParams`? The connected SessionList is rendered bare (no
 * Router) by several hermetic tests AND lives as a persistent rail across routes.
 * A `useSyncExternalStore` over `window.location` + `history.replaceState` keeps
 * the URL in sync for refresh-durability without coupling the rail to a router
 * context (so the org/bulk/delete connected tests keep rendering it bare), and
 * `replaceState` (not pushState) avoids polluting the back stack as you type.
 */

/** The URL search-param keys the rail persists (namespaced to avoid clashes). */
export const RAIL_SEARCH_PARAM = 'q'
export const RAIL_PROJECT_PARAM = 'project'
export const RAIL_TAG_PARAM = 'tag'

export interface RailUrlState {
  search: string
  projectId: string | null
  tag: string | null
}

function readRailUrlState(): RailUrlState {
  if (typeof window === 'undefined') return { search: '', projectId: null, tag: null }
  const sp = new URLSearchParams(window.location.search)
  return {
    search: sp.get(RAIL_SEARCH_PARAM) ?? '',
    projectId: sp.get(RAIL_PROJECT_PARAM),
    tag: sp.get(RAIL_TAG_PARAM),
  }
}

// Cache a snapshot so useSyncExternalStore gets a stable reference until a real
// URL change (it compares by identity; minting a new object every read loops).
let railUrlSnapshot: RailUrlState = readRailUrlState()
const railUrlListeners = new Set<() => void>()

function railUrlStateChanged(a: RailUrlState, b: RailUrlState): boolean {
  return a.search !== b.search || a.projectId !== b.projectId || a.tag !== b.tag
}

function refreshRailUrlSnapshot(): void {
  const next = readRailUrlState()
  if (railUrlStateChanged(railUrlSnapshot, next)) {
    railUrlSnapshot = next
    for (const l of railUrlListeners) l()
  }
}

/**
 * The snapshot for useSyncExternalStore. We RE-READ the URL here (not just the
 * cached value) so a mount after an external URL change — a real page refresh, or
 * a react-router navigation that swapped the URL out from under us — reflects the
 * live params. Re-reads only mint a NEW object on a real change, so the identity
 * stays stable between equal reads (required to avoid an infinite render loop).
 */
function getRailUrlSnapshot(): RailUrlState {
  const next = readRailUrlState()
  if (railUrlStateChanged(railUrlSnapshot, next)) railUrlSnapshot = next
  return railUrlSnapshot
}

function subscribeRailUrl(listener: () => void): () => void {
  railUrlListeners.add(listener)
  // Browser back/forward changes the URL out from under us; resync on popstate.
  const onPop = () => refreshRailUrlSnapshot()
  if (typeof window !== 'undefined') window.addEventListener('popstate', onPop)
  return () => {
    railUrlListeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('popstate', onPop)
  }
}

function writeRailUrlState(patch: Partial<RailUrlState>): void {
  if (typeof window === 'undefined') return
  const sp = new URLSearchParams(window.location.search)
  const apply = (key: string, value: string | null) => {
    if (value) sp.set(key, value)
    else sp.delete(key)
  }
  if ('search' in patch) apply(RAIL_SEARCH_PARAM, patch.search ? patch.search : null)
  if ('projectId' in patch) apply(RAIL_PROJECT_PARAM, patch.projectId ?? null)
  if ('tag' in patch) apply(RAIL_TAG_PARAM, patch.tag ?? null)
  const qs = sp.toString()
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  // replaceState (not push) so each keystroke doesn't add a history entry.
  window.history.replaceState(window.history.state, '', url)
  refreshRailUrlSnapshot()
}

/**
 * Refresh-durable rail filter (search + project + tag) backed by the URL. Returns
 * the current state plus a stable setter. A browser refresh re-reads the URL, so
 * the rail restores exactly where the user left it.
 */
export function useRailUrlState(): readonly [RailUrlState, (patch: Partial<RailUrlState>) => void] {
  const state = useSyncExternalStore(subscribeRailUrl, getRailUrlSnapshot, getRailUrlSnapshot)
  return [state, writeRailUrlState] as const
}

/** localStorage key for the sticky "show external sources" rail toggle. */
export const SHOW_EXTERNAL_SOURCES_STORAGE_KEY = 'agent-deck-show-external-sources'

function readShowExternalSources(): boolean {
  // Default FALSE (deck-primary): the rail leads with the deck's OWN chats and
  // folds every other channel under the collapsed "Other sessions (N)" reveal, so
  // the sparse, often-older deck chats are never buried by hundreds of recent
  // cli/telegram/cron sessions. The fold is one click (count-labeled), so nothing
  // is hidden; revealing it sticks as '1'. The deck-primary default never hides a
  // user's only sessions: when there are no deck chats to lead with, the rail's
  // noWebSessions escape hatch shows everything instead (see SessionList).
  if (typeof localStorage === 'undefined') return false
  try {
    const v = localStorage.getItem(SHOW_EXTERNAL_SOURCES_STORAGE_KEY)
    return v === null ? false : v === '1'
  } catch {
    return false
  }
}

let showExternalSnapshot = readShowExternalSources()
const showExternalListeners = new Set<() => void>()

function getShowExternalSnapshot(): boolean {
  return showExternalSnapshot
}

function subscribeShowExternal(listener: () => void): () => void {
  showExternalListeners.add(listener)
  return () => showExternalListeners.delete(listener)
}

/** Persist + broadcast a new external-source toggle value. */
export function setShowExternalSources(value: boolean): void {
  if (showExternalSnapshot === value) return
  showExternalSnapshot = value
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SHOW_EXTERNAL_SOURCES_STORAGE_KEY, value ? '1' : '0')
    } catch {
      // private mode / quota — the in-memory value still applies this session.
    }
  }
  for (const l of showExternalListeners) l()
}

/**
 * Refresh-durable "show external sources" toggle backed by localStorage. Default
 * FALSE (deck-primary): the rail leads with the deck's own chats and folds every
 * other channel under the collapsed "Other sessions (N)" reveal, so the deck chats
 * are never buried among hundreds of recent external sessions. A reload restores
 * the user's sticky reveal choice.
 */
export function useShowExternalSources(): boolean {
  return useSyncExternalStore(
    subscribeShowExternal,
    getShowExternalSnapshot,
    getShowExternalSnapshot,
  )
}

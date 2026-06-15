import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Outlet, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Terminal as TerminalIcon } from 'lucide-react'
import { AppShell, type RailVariant } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SessionList } from '@/features/sessions/SessionList'
import { SurfaceFallback } from '@/components/layout/SurfaceFallback'
import { Toaster } from '@/components/ui/toaster'
import { RunNotifications } from '@/components/notifications'
import { CommandPalette } from '@/components/command/CommandPalette'
import { ShortcutsOverlay } from '@/components/command/ShortcutsOverlay'
import { useGlobalShortcuts } from '@/components/command/useGlobalShortcuts'
import { useChatRun, toDotStatus } from '@/state/useChatRun'
import { PreviewPanel } from '@/features/preview/PreviewPanel'
import { usePreviewStore } from '@/features/preview/previewStore'
import { WorkPanel } from '@/features/work-panel/WorkPanel'
import { useWorkPanelStore } from '@/features/work-panel/workPanelStore'
import { TerminalPanel } from '@/features/terminal/TerminalPanel'
import { useTerminalPanelStore } from '@/features/terminal/terminalPanelStore'
import { LiveBurnRate } from '@/features/usage/LiveBurnRate'
import { useBudgetAlerts } from '@/features/budget/useBudgetAlerts'
import { useBindPosture } from '@/lib/useBindPosture'
import { fetchSession, fetchSessionMessages } from '@/features/sessions/api'
import { transcriptToTurns } from '@/features/sessions/transcript'
import { useSessions } from '@/features/sessions/hooks'
import { isWebOriginated } from '@/features/sessions/sessionSource'
import { nextSessionId } from '@/components/command/sessionNav'
import type { SessionNavDirection } from '@/components/command/useGlobalShortcuts'
import { CHAT_PATH, type ChatOutletContext } from '@/app/navigation'
import type { RunAttachment } from '@agent-deck/protocol'
import { useOnboarded } from '@/lib/useOnboarded'
import { OnboardingGate } from '@/features/onboarding/OnboardingGate'
import { AuthGate } from '@/lib/AuthGate'
import { SessionExpiredScreen } from '@/lib/SessionExpiredScreen'
import { isSessionExpired, subscribeSessionExpired } from '@/lib/sessionExpired'

/**
 * §1 — the single resume target. Both the pane click and the j/k quick-switch
 * route here so keyboard + click agree: the URL-addressable chat `/chat/<id>`,
 * which the seed effect rehydrates (loads the transcript, seeds the chat store,
 * forwards `session_id` on the next send) AND which a browser refresh restores.
 * Keeping this in one place means the resume contract has a single source of truth.
 */
function resumeTarget(sessionId: string): string {
  return `${CHAT_PATH}/${encodeURIComponent(sessionId)}`
}

/**
 * The app's first-run gate. Mounted AHEAD of the shell: it consults the REAL
 * setup-status probe and, for a not-yet-onboarded user whose Hermes isn't set up,
 * renders the full-screen "Wake your agent" wizard INSTEAD of the shell — so the
 * shell (and its live `/chat-run` socket) never mounts behind the wizard, keeping
 * exactly one socket alive at a time. It FAILS OPEN: an unreachable/loading probe
 * renders the shell, so a returning user is never trapped. The `useOnboarded` bit
 * is only the "don't show again" suppressor (see OnboardingGate).
 */
export default function App() {
  // ERR-01: a 401 from ANY /api call (token expired mid-session) drives the
  // unified "session expired" screen instead of per-surface blank/error states.
  // The screen lets the user re-enter their token; on success clearSessionExpired()
  // is called and we fall back to the normal AuthGate → shell flow.
  const sessionExpired = useSyncExternalStore(
    subscribeSessionExpired,
    isSessionExpired,
    isSessionExpired,
  )

  if (sessionExpired) {
    return <SessionExpiredScreen />
  }

  return (
    <AuthGate>
      <OnboardingGate>
        <AppShellLayout />
      </OnboardingGate>
    </AuthGate>
  )
}

/**
 * App layout route — owns the chrome (rail · header) and the single
 * live `/chat-run` socket, and renders the active surface in the content Outlet.
 * The chat actions are handed to the Chat surface via the Outlet context so one
 * socket backs both the surface and the header connection dot.
 *
 * Resume-across-sessions: the Sessions History "Continue" navigates here with
 * `?continue=<id>`. We consume that param once — load the session's transcript,
 * seed it into the chat store, and remember the session id so the next send
 * forwards `session_id` and the new turn lands in the SAME hermes session.
 */
function AppShellLayout() {
  const {
    connection,
    send,
    stop,
    respondApproval,
    retry,
    editTurn,
    newChat,
    continueSession,
    activeSessionId,
    resumingInFlightRun,
  } = useChatRun()
  // Honest remote-mode signal: read the server's actual bind posture (not the URL).
  // `terminalEnabled` honestly gates the terminal dock toggle: on a remote
  // (AGENT_DECK_REMOTE) bind / when node-pty is unavailable the server reports it
  // off, so we HIDE the toggle rather than show a dead button.
  const { remote, terminalEnabled } = useBindPosture()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // Back-compat: an old `?continue=<id>` deep-link funnels into the path route.
  const continueId = searchParams.get('continue')
  // Guard so a given continue id is consumed exactly once (Strict-Mode-safe).
  const consumedRef = useRef<string | null>(null)
  // One-shot: on a reload that landed MID-STREAM, the very first /chat/:id is
  // owned by the in-flight run replay (not history rehydration). See the seed effect.
  const reloadResumeHandledRef = useRef(false)
  // The seed effect's ACTION, held in a ref so the effect can call the latest
  // version without listing it as a dependency. continueSession gets a new identity
  // on every activeSessionId change (useChatRun re-memoizes to expose the new value);
  // depending on it would re-fire the seed effect on session changes (e.g. New chat
  // flipping the id to null), re-fetching a session the URL no longer names. It is
  // behaviorally stable (it reads only internal refs/setters), so the ref is safe.
  const continueSessionRef = useRef(continueSession)
  useEffect(() => {
    continueSessionRef.current = continueSession
  }, [continueSession])

  // First-run onboarding flag (spec §2/§3). Once set, the user is "onboarded":
  // they land on Chat (not the Home front door) next time. The flag is shared
  // (useSyncExternalStore) so Home, the rail, and this layout all observe the
  // same bit. This layout only WRITES it (on a first meaningful interaction).
  const [, markOnboarded] = useOnboarded()

  // ⌘K command palette + `?` shortcuts overlay state.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // The PREVIEW panel (#116) — its open/url/load state lives in the singleton
  // preview store (a chat link or a terminal URL opens it from anywhere, so the
  // store, not local state, is the source of truth). The header toggle (⌘⇧V) and
  // the AppShell drive its `open` bit through these.
  const previewOpen = usePreviewStore((s) => s.open)
  const togglePreview = usePreviewStore((s) => s.toggle)

  // The WORK PANEL (artifact canvas) — driven by the singleton workPanelStore
  // (a CodeBlock open-in-panel click or the auto-open heuristic opens it from
  // anywhere). The header toggle (⌘⇧W) and the AppShell drive its `open` bit.
  const workPanelOpen = useWorkPanelStore((s) => s.open)
  const toggleWorkPanel = useWorkPanelStore((s) => s.toggle)

  // The TERMINAL DOCK — a single-session terminal in the SAME side-panel slot,
  // mutually exclusive with preview + work (the dock store closes those two on
  // open). The reverse half — opening preview/work closes the dock — is wired
  // below in an effect, since those stores aren't ours to teach about the dock.
  const terminalPanelOpen = useTerminalPanelStore((s) => s.open)
  const toggleTerminalPanel = useTerminalPanelStore((s) => s.toggle)
  const closeTerminalPanel = useTerminalPanelStore((s) => s.close)

  // Keep the ONE side-panel slot to a single occupant: when the Preview or Work
  // panel opens (from anywhere — a chat link, a CodeBlock click), close the dock.
  // The forward direction (dock closes them) lives in the dock store itself.
  useEffect(() => {
    if ((previewOpen || workPanelOpen) && terminalPanelOpen) closeTerminalPanel()
  }, [previewOpen, workPanelOpen, terminalPanelOpen, closeTerminalPanel])

  // Sending a message is a "first meaningful interaction" (spec §2/§3): mark the
  // user onboarded so they land on Chat (not Home) and never re-trigger the
  // one-time drawer auto-open on later visits. Idempotent after the first send.
  const handleSend = useCallback(
    (text: string, model?: string, attachments?: RunAttachment[]) => {
      markOnboarded()
      send(text, model, attachments)
    },
    [markOnboarded, send],
  )

  // "New chat" from the rail/palette/⌘N: reset the conversation and land on the
  // bare Chat surface (`/chat`, no `:id`) — which clears the pane's highlight,
  // since the selection now follows the URL's session id. Also a meaningful
  // interaction → mark onboarded.
  const handleNewChat = useCallback(() => {
    markOnboarded()
    newChat()
    // Allow re-resuming ANY session (including the one just left) after a fresh
    // chat: without clearing the consume guard, clicking the prior session again
    // would early-return in the seed effect below and silently do nothing.
    consumedRef.current = null
    navigate(CHAT_PATH)
  }, [markOnboarded, newChat, navigate])

  // "Clear chat": reset the conversation in place (no navigation), so a power
  // user can wipe the current transcript without leaving the surface they're on.
  const handleClearChat = useCallback(() => {
    newChat()
  }, [newChat])

  // Open the ⌘K palette. One App-owned action backs both the global shortcut and
  // surfaces that don't own the palette state (Home's hero ⌘K hint chip, via the
  // Outlet context below).
  const handleOpenPalette = useCallback(() => setPaletteOpen(true), [])

  // j/k session quick-switching (P5). We keep the rail's loaded list here and
  // walk it relative to the session the rail currently has selected, so the move
  // is visible immediately via the pane's existing `aria-current` highlight. The
  // list is the same cached query the rail uses.
  const location = useLocation()
  const sessionsQuery = useSessions({ limit: 50 })
  // A stable id list so the nav callback's deps don't change every render.
  // §3 — j/k walks the SAME web-default set the pane shows (web/ui-originated),
  // so keyboard + click agree on the default view and j/k can never resume a
  // session the pane is hiding. External sessions revealed via the pane's "From
  // other places" toggle stay click-reachable; the keyboard walk tracks the
  // default set, which is the safe, invariant-preserving choice.
  const railSessionIds = useMemo(
    () => (sessionsQuery.data?.sessions ?? []).filter(isWebOriginated).map((s) => s.id),
    [sessionsQuery.data],
  )
  const openSessionId = matchPath('/sessions/:id', location.pathname)?.params.id ?? null
  // The durable session id the chat URL names (`/chat/:id`) — the refresh-safe
  // restore key. Drives both rehydration (the seed effect) and the rail highlight.
  const chatRouteId = matchPath(`${CHAT_PATH}/:id`, location.pathname)?.params.id ?? null

  // The read-only transcript route (`/sessions/:id`) drives the highlight when
  // it's the open surface; otherwise the chat URL's id (`/chat/:id`) does. Both
  // come straight from the URL, so the rail highlight survives a refresh.
  const selectedSessionId = openSessionId ?? chatRouteId

  // Surface-aware rail morphology (spec §1): Chat ('/chat' and '/chat/:id') and the
  // Sessions history route get the SPLIT rail (slim icon-nav + dedicated sessions
  // pane); every other surface (including the Home front door at '/') keeps the
  // single labeled rail.
  const onChat = matchPath(CHAT_PATH, location.pathname) !== null || chatRouteId !== null
  const railVariant: RailVariant = onChat || openSessionId !== null ? 'split' : 'single'

  // The dedicated sessions pane is open by default (desktop Chat); ⌘B / the
  // header toggle collapses it. State lives here so it persists across surfaces.
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const toggleSessions = useCallback(() => setSessionsCollapsed((c) => !c), [])

  // §1 — keyboard quick-switch RESUMES in place (same target as a pane click), so
  // j/k → type agrees with click → type. It walks the list relative to the
  // currently-selected session (resumed or transcript-open) and seeds a resume.
  const handleSessionNav = useCallback(
    (direction: SessionNavDirection) => {
      const target = nextSessionId(railSessionIds, selectedSessionId, direction)
      if (target) navigate(resumeTarget(target))
    },
    [railSessionIds, selectedSessionId, navigate],
  )

  // Enter (when a session is the focused rail row) jumps the user straight into
  // the message composer, so j/k → Enter is a keyboard-only "hop then type"
  // flow. Returns true only when the composer was found+focused, so the global
  // shortcut never swallows a plain Enter elsewhere.
  const handleOpenFocusedSession = useCallback((): boolean => {
    const composer = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message your agent"]',
    )
    if (!composer) return false
    composer.focus()
    return true
  }, [])

  useGlobalShortcuts({
    onOpenPalette: handleOpenPalette,
    onNewChat: handleNewChat,
    onShowShortcuts: () => setShortcutsOpen(true),
    onToggleSessions: toggleSessions,
    onTogglePreview: togglePreview,
    onSessionNav: handleSessionNav,
    onOpenFocusedSession: handleOpenFocusedSession,
  })

  useEffect(() => {
    // Rehydrate the conversation NAMED BY THE URL (`/chat/:id`) — this is what
    // makes a browser refresh RESTORE the open chat (and its rail highlight)
    // instead of dropping into a blank /chat. Each id is consumed once (the ref
    // guard); the capture effect below pre-marks the id of a freshly-created chat
    // so we never re-fetch and clobber its still-live transcript. The ref (not a
    // cancel flag) guards StrictMode's double-mount: seeding writes the module
    // store and is safe to complete, so we don't abort the in-flight load.
    if (!chatRouteId || consumedRef.current === chatRouteId) return
    // Reload-mid-stream: the socket is already resuming the in-flight run from
    // sessionStorage (it replays the live transcript). For THAT first conversation
    // we must NOT also rehydrate from history — it would race and clobber the live
    // turns. Mark it consumed and let the run replay own the transcript. Only the
    // first /chat/:id after such a reload is gated; later navigations rehydrate.
    if (resumingInFlightRun && !reloadResumeHandledRef.current) {
      reloadResumeHandledRef.current = true
      consumedRef.current = chatRouteId
      return
    }
    consumedRef.current = chatRouteId
    void (async () => {
      try {
        // Load the transcript AND the session detail (title · model) together so
        // the live chat header carries the identity forward — resuming must not
        // drop you into an identity-less header (T1.3). The detail is best-effort.
        const [{ messages }, detail] = await Promise.all([
          fetchSessionMessages(chatRouteId),
          fetchSession(chatRouteId).catch(() => null),
        ])
        // If the user started a New chat (which clears consumedRef to null) or
        // opened a DIFFERENT session (which sets it to that id) while this load
        // was in flight, the result is now STALE. Dropping it here is what stops a
        // slow load from clobbering the new chat: without this it re-seeds the old
        // turns and snaps the URL back via the activeSessionId effect below.
        if (consumedRef.current !== chatRouteId) return
        continueSessionRef.current(chatRouteId, transcriptToTurns(messages), {
          title: detail?.title,
          model: detail?.model,
        })
      } catch {
        // A failed preload still adopts the session id so the next send carries
        // it; the user just doesn't see the prior turns rendered. Same staleness
        // guard: never adopt a session the user already navigated away from.
        if (consumedRef.current !== chatRouteId) return
        continueSessionRef.current(chatRouteId, [])
      }
    })()
    // continueSession is intentionally omitted (called via continueSessionRef): the
    // URL's session id and the reload-resume flag are the only real triggers here.
  }, [chatRouteId, resumingInFlightRun])

  // Reflect the live conversation's durable session id into the URL, but ONLY when
  // the URL names NO session yet (chatRouteId === null): a fresh chat that just
  // learned its id from run.started. We adopt it (replace) so a refresh rehydrates,
  // and mark it consumed so the seed effect never re-fetches and clobbers the live
  // transcript. When the URL ALREADY names a session, that id is the user's intent
  // (a click or a resume) and MUST win: navigating back to the active run's session
  // would fight the user's switch to another session and, with the seed effect's
  // staleness guard, drop the session they just clicked.
  useEffect(() => {
    if (!activeSessionId || !onChat || chatRouteId !== null) return
    consumedRef.current = activeSessionId
    navigate(`${CHAT_PATH}/${encodeURIComponent(activeSessionId)}`, { replace: true })
  }, [activeSessionId, onChat, chatRouteId, navigate])

  // Back-compat: an old `?continue=<id>` deep-link (external bookmark, ⌘K) funnels
  // into the canonical path route so it gets the same refresh-safe rehydration.
  useEffect(() => {
    if (continueId) navigate(`${CHAT_PATH}/${encodeURIComponent(continueId)}`, { replace: true })
  }, [continueId, navigate])

  // The split rail's dedicated sessions pane (the connected SessionList). The
  // pane is LIST-ONLY: the single "New chat" action lives in the labeled rail
  // beside it (the Sidebar's key action), so the chrome carries exactly ONE
  // interactive control named "New chat" (no duplicate affordance, no colliding
  // accessible names). The Recent group floats the latest few sessions above the
  // date groups so the last conversations are always one glance away. Selecting
  // opens the session; deleting the open one routes to Chat.
  const sessionsPane = (
    <div className="flex h-full flex-col gap-3 p-3">
      <SessionList
        selectedId={selectedSessionId}
        // §1 — a pane click RESUMES the conversation in place (→ /chat?continue=,
        // reusing the existing seed effect), so a past chat is one click from
        // typing again. The read-only transcript is the row overflow's secondary
        // "View transcript" action.
        onSelect={(sid) => navigate(resumeTarget(sid))}
        onViewTranscript={(sid) => navigate(`/sessions/${sid}`)}
        onSessionDeleted={() => navigate(CHAT_PATH)}
        recentLimit={4}
        // §3 — the chat rail is the clean, competitor-style dense view (no bulk
        // select, projects/folders, external-source toggle, or pagination chrome).
        dense
      />
    </div>
  )

  const context: ChatOutletContext = {
    send: handleSend,
    stop,
    respondApproval,
    retry,
    editTurn,
    connection,
    // The same App-owned actions the rail/palette/global shortcuts drive, handed
    // to the Chat surface so the composer's `/` menu mirrors the ⌘K palette.
    newChat: handleNewChat,
    clearChat: handleClearChat,
    openPalette: handleOpenPalette,
    // The live session id (null for an unsent new chat) — threaded down so the
    // composer keys its persisted draft per-conversation (Composer.sessionKey).
    activeSessionId,
  }

  return (
    <>
      <AppShell
        connection={toDotStatus(connection)}
        onNewChat={handleNewChat}
        remote={remote}
        // Header accessory: the always-on glanceable burn-rate pill (today's
        // spend, amber when a soft budget is crossed) + the terminal-dock toggle
        // (honestly hidden when the server reports the terminal disabled).
        headerAccessory={
          <>
            <LiveBurnRate />
            {terminalEnabled && (
              <TerminalDockToggle open={terminalPanelOpen} onToggle={toggleTerminalPanel} />
            )}
          </>
        }
        // Surface-aware split rail (spec §1): Chat/Sessions get the icon-nav +
        // dedicated sessions pane; other surfaces keep the single labeled rail.
        variant={railVariant}
        sessionsPane={sessionsPane}
        sessionsCollapsed={sessionsCollapsed}
        onToggleSessions={toggleSessions}
        // The right side panel — hosts the WorkPanel (artifact canvas), the
        // Preview panel (in-app iframe browser), OR the Terminal dock (a single
        // live shell), whichever was most recently opened. The three stores are
        // mutually exclusive (opening one closes the others), so the AppShell
        // column is open when ANY is. The header toggles route to the active one.
        preview={
          <SidePanel
            previewOpen={previewOpen}
            workPanelOpen={workPanelOpen}
            terminalPanelOpen={terminalPanelOpen}
          />
        }
        previewOpen={previewOpen || workPanelOpen || terminalPanelOpen}
        onTogglePreview={() => {
          // Close whichever is open. Toggling the panel icon closes the active
          // occupant; re-opening it returns to the last active one.
          if (terminalPanelOpen) closeTerminalPanel()
          else if (workPanelOpen) toggleWorkPanel()
          else togglePreview()
        }}
      >
        {/* Surfaces are route-level code-split (navigation.tsx) — including the
            Agent Studio (Home), which owns the index '/'; the Suspense boundary
            shows a calm skeleton while a surface chunk loads on first navigation. */}
        <Suspense fallback={<SurfaceFallback />}>
          <Outlet context={context} />
        </Suspense>
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewChat={handleNewChat}
        onClearChat={handleClearChat}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Toaster />
      {/* Headless subscriber: surfaces a run finishing / failing / blocking on an
          approval (toast + blurred-tab title flip + browser Notification) when the
          operator isn't looking at the conversation. Renders nothing. */}
      <RunNotifications />
      {/* Headless cost watcher: on each usage poll, warns once per breach when a
          soft budget is crossed (calm toast + "Go to Usage"). Renders nothing. */}
      <BudgetAlerts />
    </>
  )
}

/** Mounts the headless budget watcher hook. Renders nothing. */
function BudgetAlerts() {
  useBudgetAlerts()
  return null
}

/**
 * The right side panel content switcher. The AppShell has ONE side column slot;
 * this component renders the active occupant — the Terminal dock (a live shell),
 * the WorkPanel artifact canvas, OR the Preview URL browser — based on which is
 * open. The three stores are mutually exclusive, so at most one is open at a
 * time; the precedence here (terminal → work → preview) is only the tie-breaker
 * for the brief overlap during a swap. The Work + Preview panels stay MOUNTED
 * (hidden) so a loaded URL / open artifact isn't discarded across a glance; the
 * Terminal dock unmounts when closed so a parked shell isn't kept needlessly
 * socket-connected behind the scenes (it reattaches on reopen via its stable id).
 */
function SidePanel({
  previewOpen,
  workPanelOpen,
  terminalPanelOpen,
}: {
  previewOpen: boolean
  workPanelOpen: boolean
  terminalPanelOpen: boolean
}) {
  return (
    <>
      {/* The Terminal dock only mounts while open (it owns a live socket). */}
      {terminalPanelOpen && (
        <div className="h-full">
          <TerminalPanel />
        </div>
      )}
      <div className={!terminalPanelOpen && workPanelOpen ? 'h-full' : 'hidden'}>
        <WorkPanel open={workPanelOpen} />
      </div>
      <div className={!terminalPanelOpen && !workPanelOpen ? 'h-full' : 'hidden'}>
        <PreviewPanel open={previewOpen} />
      </div>
    </>
  )
}

/**
 * The terminal-dock toggle — surfaced in the chat chrome next to the burn-rate
 * pill (and the Preview/Work toggle the AppShell owns). Lucide Terminal glyph,
 * accessible label, the single --primary accent ONLY for the active state.
 * Honestly hidden by the caller when the server reports the terminal disabled, so
 * this is never a dead button.
 *
 * Responsive shedding: a docked terminal beside the chat is a desktop/power
 * affordance, so the toggle hides below `sm` (the narrow header already carries
 * the burn-rate pill + connection dot + theme + preview + new-chat — a fourth
 * control crowds/overflows the top bar at 375px). The full `/terminal` surface
 * stays one tap away from the nav, so nothing is lost; the toggle reappears at
 * `sm+` as a real 44px target.
 */
function TerminalDockToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-label={open ? 'Close terminal' : 'Open terminal'}
      aria-expanded={open}
      data-testid="terminal-dock-toggle"
      className={cn(
        'hidden size-11 sm:inline-flex sm:size-10',
        open ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <TerminalIcon className="size-4" />
    </Button>
  )
}

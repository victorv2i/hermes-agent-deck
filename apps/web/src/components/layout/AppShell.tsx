import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FocusScope } from 'radix-ui/internal'
import { ChevronsLeft, ChevronsRight, Globe, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import {
  useMediaQuery,
  MOBILE_QUERY,
  SESSIONS_PANE_QUERY,
  WIDE_QUERY,
  usePrefersReducedMotion,
} from '@/lib/useMediaQuery'
import { useHeaderContent } from '@/state/headerStore'
import { surfaceTitle } from '@/app/navigation'
import { useDynamicIdentity } from '@/app/useDynamicIdentity'
import { Wordmark } from './Wordmark'
import { Sidebar } from './Sidebar'
import { ConnectionDot, type ConnectionStatus } from './ConnectionDot'
import { RemoteModeBanner } from './RemoteModeBanner'

// The animated chrome (rail springs · backdrop/wordmark fades) lives in a lazy
// chunk so framer-motion stays off the eager entry path. Each is wrapped below
// in Suspense with a plain fallback rendered at the TARGET geometry, so layout
// is correct on first paint and the springs just smooth later toggles.
const MobileBackdrop = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.MobileBackdrop })),
)
const MobileRailNav = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.MobileRailNav })),
)
const DesktopRailNav = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.DesktopRailNav })),
)
const HeaderWordmark = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.HeaderWordmark })),
)
const PreviewBackdrop = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.PreviewBackdrop })),
)
const PreviewDrawer = lazy(() =>
  import('./AppShellMotion').then((m) => ({ default: m.PreviewDrawer })),
)

const RAIL_WIDTH = 260
/** The PREVIEW panel (#116) hosts a real iframe browser, so it wants room.
 * Mirrors PREVIEW_WIDTH in AppShellMotion. */
const PREVIEW_WIDTH = 480
/** The dedicated sessions-pane column width in the split rail. */
const SESSIONS_PANE_WIDTH = 280

/**
 * Path PREFIXES whose surfaces render their OWN in-content header — a `PageHeader`
 * or `SurfaceHeader` (an `<h1>`), e.g. Files, Settings, Usage, the
 * History/Sessions views, …. For these the chrome header-title fallback is
 * SUPPRESSED so the page title isn't stacked twice ("Settings" over "Settings").
 * The fallback is kept for a surface that projects NO header of its own — the
 * Agent Studio (Home) is one: it leads with a launchpad strip + roster/workbench
 * (no page <h1>), so it reads its "Agent Studio" title from the chrome fallback.
 * Chat is excluded here because it projects its own header CONTENT into the slot
 * (handled by the `headerContent` check), which already suppresses the fallback.
 *
 * Matched by longest-prefix so nested paths (`/sessions/:id`)
 * resolve through their parent surface.
 */
const SURFACES_WITH_OWN_HEADER = [
  // NOTE: the index '/' is the Agent Studio (Home), which does NOT render its own
  // page <h1> (it leads with a slim launchpad strip + the roster/workbench), so it
  // is intentionally ABSENT here — the chrome header shows its "Agent Studio"
  // fallback title. The folded `/profiles` + `/tools` paths redirect to '/', so
  // they need no entry either.
  '/chat',
  '/history',
  '/sessions',
  '/kanban',
  '/files',
  '/terminal',
  // The unified Terminal surface also answers `/workspaces` + `/workspaces/:id`
  // and brings its own SurfaceHeader, so suppress the chrome fallback title here.
  '/workspaces',
  '/jobs',
  // Connections mounts the existing Voice/Messaging/MCP Routes as tabs, and each
  // brings its OWN PageHeader — so the chrome fallback title is suppressed here
  // too (the tab strip + the surface's own header are the page chrome).
  '/connections',
  '/usage',
  '/logs',
  '/system',
  '/settings',
] as const

/** Whether the active surface renders its own in-content header (so the chrome
 * fallback title must not duplicate it). The index '/' (the Agent Studio) is
 * intentionally NOT in the list — it has no own page <h1>, so it reads its
 * "Agent Studio" title from the chrome fallback. Every listed prefix matches the
 * path itself or any nested child path. */
function surfaceRendersOwnHeader(pathname: string): boolean {
  return SURFACES_WITH_OWN_HEADER.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * The rail morphology (spec §1). `single` = today's labeled rail (grouped nav +
 * the session list inside it) on every workspace/system surface. `split` =
 * Chat/Sessions: a slim icon-nav + a DEDICATED sessions pane beside it (a true
 * three-panel layout). One component, two morphologies — never a permanent
 * everywhere-three-column.
 */
export type RailVariant = 'single' | 'split'

export type AppShellProps = {
  children: React.ReactNode
  /** Connection state surfaced as a calm header dot. */
  connection?: ConnectionStatus
  /** New-chat action for the rail. */
  onNewChat?: () => void
  /**
   * Remote bind posture (from the health probe). When true the server is bound
   * to a non-loopback host, so a standing REMOTE-MODE warning banner is shown.
   */
  remote?: boolean
  /**
   * An optional header accessory (e.g. the live burn-rate pill) rendered just
   * before the connection dot. Owned by the caller, kept here so it persists
   * across routes rather than living in the route-cleared header slot.
   */
  headerAccessory?: React.ReactNode
  /**
   * The rail morphology for the active surface (spec §1). `single` (default) is
   * today's labeled rail; `split` is the icon-nav + dedicated sessions pane used
   * on Chat/Sessions. The caller derives this from the route.
   */
  variant?: RailVariant
  /**
   * The dedicated sessions pane content (the connected SessionList), rendered as
   * the split rail's second column. Only used when `variant === 'split'` and the
   * viewport clears the width gate.
   */
  sessionsPane?: React.ReactNode
  /** Whether the sessions pane is collapsed (⌘B). Controlled by the caller. */
  sessionsCollapsed?: boolean
  /** Toggle the sessions pane (⌘B / the header collapse toggle in split mode). */
  onToggleSessions?: () => void
  /**
   * The right PREVIEW panel content (#116) — the in-app iframe browser. When
   * provided, the header shows a Preview toggle (⌘⇧V). It lives ABOVE the route
   * Outlet so the loaded page survives navigation.
   */
  preview?: React.ReactNode
  /** Whether the Preview panel is open (controlled by the caller). */
  previewOpen?: boolean
  /** Toggle the Preview panel. Also used by the header trigger. */
  onTogglePreview?: () => void
}

export function AppShell({
  children,
  connection = 'connecting',
  onNewChat,
  remote = false,
  headerAccessory,
  variant = 'single',
  sessionsPane,
  sessionsCollapsed = false,
  onToggleSessions,
  preview,
  previewOpen = false,
  onTogglePreview,
}: AppShellProps) {
  // P8 ambient identity: drive document.title + favicon from the active agent.
  // Mounted here (always-rendered chrome), so there's exactly one title writer.
  useDynamicIdentity()
  const reduce = usePrefersReducedMotion()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  // The split rail's dedicated sessions pane is width-gated: it only mounts at/
  // above this width so a narrow desktop isn't crushed into three columns.
  const wideEnoughForPane = useMediaQuery(SESSIONS_PANE_QUERY)
  // The WIDE cockpit gate (>=1280px): at/above it the Preview panel DOCKS as a
  // static in-flow third column (no scrim, no focus-trap, no aria-modal) so the
  // operator keeps the conversation WHILE it's open; below it the panel stays a
  // modal-with-scrim slide-over (dim + trap), the right call on a phone/narrow
  // window where a third column wouldn't fit.
  const isWideCockpit = useMediaQuery(WIDE_QUERY)
  // Split morphology applies only on the desktop layout; mobile always uses the
  // existing focus-trapped slide-over (the full labeled rail), regardless of
  // variant — we reuse that machinery rather than hand-rolling a mobile split.
  const isSplit = variant === 'split' && !isMobile
  // The dedicated pane mounts only when split + wide enough + content provided.
  const showSessionsPane = isSplit && wideEnoughForPane && sessionsPane != null
  // §2(a) — ONE stable desktop treatment for the split rail's first column: the
  // FULL labeled nav (same vocabulary as the single rail), at every desktop
  // width. It no longer shapeshifts to a slim icon-nav at a mid breakpoint (a
  // surprising change on resize); only the dedicated PANE is width-gated. The
  // icon/slide-over fallback happens solely at the true MOBILE breakpoint (handled
  // by the `isMobile` branch above). Width budget at 1024px: labeled nav (260) +
  // pane (280) + content (~484) is comfortable for the centered chat column.
  // Content the active route projects into the header (title · model · ring).
  const headerContent = useHeaderContent()
  // When no route projects its own header content, fall back to the active
  // surface's friendly TITLE so you always know where you are — but ONLY on a
  // surface that renders no in-content header of its own. Surfaces that DO
  // project content (Chat's title·model·ring) keep owning the slot via
  // `headerContent`; surfaces that render their own PageHeader/SurfaceHeader
  // (Settings, Usage, Files, …) suppress the fallback so the title isn't stacked
  // twice ("Settings" over "Settings").
  const { pathname } = useLocation()
  const fallbackTitle =
    headerContent == null && !surfaceRendersOwnHeader(pathname) ? surfaceTitle(pathname) : null
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  // The header's leading nav control (Menu trigger on mobile, collapse toggle on
  // desktop — the same slot). When a resize auto-closes the open slide-over, the
  // trapped focus would otherwise fall to <body>; we return it here so a keyboard
  // user keeps their place. `railOpenRef` mirrors the open state so the resize
  // effect can read whether the rail was open at the moment we left mobile.
  const headerNavRef = useRef<HTMLButtonElement>(null)
  const railOpenRef = useRef(false)

  // Esc dismisses the open Preview panel or the mobile slide-over rail. Listens
  // in the CAPTURE phase so stopPropagation actually preempts ChatView's
  // bubble-phase "Esc aborts the run" handler — otherwise an operator reflexively
  // closing the panel with Esc would also kill the in-flight run behind it.
  // (Bubble-phase stopPropagation between two window listeners can't do this.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // The Preview panel (an overlay/dock the operator opened on purpose) takes
      // Esc precedence — closing the thing most recently brought forward without
      // killing the run behind it.
      if (previewOpen) {
        e.stopPropagation()
        onTogglePreview?.()
        return
      }
      if (mobileRailOpen) {
        e.stopPropagation()
        setMobileRailOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mobileRailOpen, previewOpen, onTogglePreview])

  // Leaving the mobile breakpoint dismisses the slide-over so the desktop rail
  // returns to its width-animated state cleanly. Reconciled during render
  // (React's "adjust state while rendering" pattern) — no effect needed.
  if (!isMobile && mobileRailOpen) {
    setMobileRailOpen(false)
  }

  // When a resize crosses OUT of the mobile breakpoint while the slide-over was
  // open, that auto-close isn't user-driven: the FocusScope's trapped focus would
  // otherwise fall to <body>. Return focus to the header nav control (the collapse
  // toggle now occupying the Menu trigger's slot) so a keyboard user keeps place.
  // `railOpenRef` still holds the PREVIOUS commit's open state here — the mirror
  // effect below (declared after, so it runs after) updates it for next time.
  useEffect(() => {
    if (!isMobile && railOpenRef.current) {
      headerNavRef.current?.focus()
    }
  }, [isMobile])

  // Keep a ref mirror of the open state for the resize effect above.
  useEffect(() => {
    railOpenRef.current = mobileRailOpen
  }, [mobileRailOpen])

  // A "New chat" from the mobile slide-over should also close it.
  const handleNewChat = useCallback(() => {
    onNewChat?.()
    if (isMobile) setMobileRailOpen(false)
  }, [onNewChat, isMobile])

  // The slide-over's inner content (shared by the animated nav and its plain
  // Suspense fallback). When open it behaves as a modal: focus is trapped inside
  // (FocusScope) and the rest of the page is inert to AT via aria-modal on the
  // <nav>. We keep the element's implicit `navigation` role (not `dialog`) so
  // the rail semantics — and the chrome tests that query it by that role — hold.
  const mobileRailContent = mobileRailOpen ? (
    // Mounting the FocusScope on open moves focus into the panel and (on
    // unmount/close) restores it to the trigger; `trapped` keeps Tab within the
    // slide-over, `loop` wraps at the ends.
    <FocusScope.FocusScope
      asChild
      trapped
      loop
      onUnmountAutoFocus={(e) => {
        // Let the browser restore focus to the menu trigger; prevent Radix from
        // re-focusing a stale element after the close anim.
        e.preventDefault()
      }}
    >
      <div className="h-full">
        <Sidebar onNewChat={handleNewChat} showSessions />
      </div>
    </FocusScope.FocusScope>
  ) : (
    <Sidebar onNewChat={handleNewChat} showSessions />
  )

  // The Preview panel's inner content. A modal slide-over (below the wide
  // cockpit) focus-traps so the iframe
  // chrome is keyboard-reachable and Tab can't escape behind the scrim; when
  // docked (>=1280px) it's an in-flow column and must NOT trap focus (the
  // operator keeps typing in the conversation beside it).
  const previewContent =
    previewOpen && !isWideCockpit ? (
      <FocusScope.FocusScope
        asChild
        trapped
        loop
        onUnmountAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <div className="h-full">{preview}</div>
      </FocusScope.FocusScope>
    ) : (
      <div className="h-full">{preview}</div>
    )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Left rail. Desktop: a width-animated column. Mobile: an off-canvas
          slide-over rendered above the content with a dismiss backdrop. */}
      {isMobile ? (
        <>
          <Suspense
            fallback={
              mobileRailOpen ? (
                <button
                  type="button"
                  data-testid="mobile-rail-backdrop"
                  aria-label="Close navigation"
                  onClick={() => setMobileRailOpen(false)}
                  className="fixed inset-0 z-30 bg-black/55"
                />
              ) : null
            }
          >
            <MobileBackdrop open={mobileRailOpen} onClose={() => setMobileRailOpen(false)} />
          </Suspense>
          {/* The slide-over rail. The animated <nav> shell is lazy (framer-motion
              off the entry path); the fallback is the same <nav> positioned at
              its target x via a CSS transform, so it's correct before the chunk
              loads. The FocusScope-wrapped Sidebar is passed in as children so
              the modal focus-trap semantics live here, not in the motion chunk. */}
          <Suspense
            fallback={
              <nav
                aria-label="Sidebar"
                aria-modal={mobileRailOpen ? true : undefined}
                aria-hidden={mobileRailOpen ? undefined : true}
                data-mobile-open={mobileRailOpen}
                inert={mobileRailOpen ? undefined : true}
                // The fallback only shows for the sub-frame it takes the (tiny,
                // shared) motion chunk to load. We render the slide-over at its
                // CLOSED/offscreen x — the same starting point framer-motion
                // animates FROM — so a just-opened rail doesn't momentarily
                // overlay (and swallow clicks meant for) the backdrop before the
                // spring takes over. The animated nav then slides it open.
                style={{ width: RAIL_WIDTH, transform: `translateX(${-(RAIL_WIDTH + 8)}px)` }}
                className="fixed inset-y-0 left-0 z-40 border-r border-border bg-sidebar shadow-2xl shadow-black/40"
              >
                {mobileRailContent}
              </nav>
            }
          >
            <MobileRailNav open={mobileRailOpen} reduce={reduce}>
              {mobileRailContent}
            </MobileRailNav>
          </Suspense>
        </>
      ) : isSplit ? (
        // SPLIT morphology (Chat/Sessions): the stable LABELED surface-nav column
        // (§2(a) — no mid-width icon-collapse) + a dedicated, width-gated,
        // ⌘B-collapsible sessions pane → a true three-panel layout on desktop.
        // The nav reads identically at every desktop width; only the pane is
        // width-gated (it slides in at >=1024px). The labeled nav drops its own
        // embedded session list — the dedicated pane owns that.
        <>
          <nav
            aria-label="Sidebar"
            style={{ width: RAIL_WIDTH }}
            className="relative z-10 shrink-0 overflow-hidden border-r border-border bg-sidebar"
          >
            <Sidebar onNewChat={onNewChat} showSessions={false} />
          </nav>
          {showSessionsPane && (
            <aside
              aria-label="Sessions"
              aria-modal="false"
              data-testid="sessions-pane"
              data-sessions-collapsed={sessionsCollapsed}
              aria-hidden={sessionsCollapsed ? true : undefined}
              inert={sessionsCollapsed ? true : undefined}
              style={{ width: sessionsCollapsed ? 0 : SESSIONS_PANE_WIDTH }}
              // The pane is rail CHROME (bg-sidebar) — §2(b): it must read as part
              // of the rail, never as surface content (which is bg-surface-1), so
              // the sessions pane and the Files tree never look interchangeable.
              className={cn(
                'relative z-[5] shrink-0 overflow-hidden border-r border-border bg-sidebar',
                reduce ? '' : 'transition-[width] duration-200 ease-out',
              )}
            >
              {/* The pane keeps its intrinsic width so its content doesn't reflow
                  while the column collapses to 0 (mirrors the rail pattern). */}
              <div style={{ width: SESSIONS_PANE_WIDTH }} className="h-full">
                {sessionsPane}
              </div>
            </aside>
          )}
        </>
      ) : (
        <Suspense
          fallback={
            <nav
              aria-label="Sidebar"
              data-collapsed={railCollapsed}
              aria-hidden={railCollapsed ? true : undefined}
              inert={railCollapsed ? true : undefined}
              style={{ width: railCollapsed ? 0 : RAIL_WIDTH }}
              className="relative z-10 shrink-0 overflow-hidden border-r border-border bg-sidebar"
            >
              <div style={{ width: RAIL_WIDTH }} className="h-full">
                <Sidebar onNewChat={onNewChat} />
              </div>
            </nav>
          }
        >
          <DesktopRailNav collapsed={railCollapsed} reduce={reduce}>
            <div style={{ width: RAIL_WIDTH }} className="h-full">
              <Sidebar onNewChat={onNewChat} />
            </div>
          </DesktopRailNav>
        </Suspense>
      )}

      {/* Center column: optional remote-mode banner + header + conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {remote && <RemoteModeBanner />}
        <header
          role="banner"
          className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 sm:gap-2"
        >
          {isMobile ? (
            <Button
              ref={headerNavRef}
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileRailOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileRailOpen}
              className="size-11 text-muted-foreground hover:text-foreground sm:size-10"
            >
              <Menu className="size-4" />
            </Button>
          ) : isSplit ? (
            // In split mode the icon-nav is always present, so the header toggle
            // collapses the SESSIONS PANE (same action as ⌘B) rather than the
            // rail. Inert affordance is hidden when there's no pane to toggle.
            showSessionsPane && (
              <Button
                ref={headerNavRef}
                variant="ghost"
                size="icon-sm"
                onClick={onToggleSessions}
                aria-label={sessionsCollapsed ? 'Show sessions pane' : 'Hide sessions pane'}
                aria-expanded={!sessionsCollapsed}
                aria-keyshortcuts="Meta+B Control+B"
                className="size-10 text-muted-foreground hover:text-foreground"
              >
                {sessionsCollapsed ? (
                  <ChevronsRight className="size-4" />
                ) : (
                  <ChevronsLeft className="size-4" />
                )}
              </Button>
            )
          ) : (
            <Button
              ref={headerNavRef}
              variant="ghost"
              size="icon-sm"
              onClick={() => setRailCollapsed((c) => !c)}
              aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="size-10 text-muted-foreground hover:text-foreground"
            >
              {railCollapsed ? (
                <ChevronsRight className="size-4" />
              ) : (
                <ChevronsLeft className="size-4" />
              )}
            </Button>
          )}

          {/* Brand persists in the header when the rail isn't showing the
              wordmark: a collapsed desktop rail or any mobile view. The split
              rail now always shows the labeled nav (which owns the wordmark), so
              the header doesn't duplicate it there (§2(a)). */}
          <Suspense
            fallback={
              isMobile || railCollapsed ? (
                <Wordmark className="max-[479px]:[&>span:last-child]:sr-only" />
              ) : null
            }
          >
            <HeaderWordmark show={isMobile || railCollapsed} reduce={reduce}>
              <Wordmark className="max-[479px]:[&>span:last-child]:sr-only" />
            </HeaderWordmark>
          </Suspense>

          {/* Live-header slot: the active route projects title · model · context
              ring here (design language §4), CENTERED. When a route projects
              nothing, the slot falls back to the active surface's friendly NAME —
              a quiet location label (left-aligned beside the wordmark) so the
              persistent top bar always answers "where am I?". It's a chrome LABEL,
              not the page's document heading (the content's own SurfaceHeader /
              PageHeader owns the <h1>), so it never duplicates a heading or
              shadows the page's landmark for assistive tech. */}
          <div
            data-testid="header-slot"
            // Left-anchored, NOT centered: a centered header re-centers and slides
            // while the right panel (terminal dock / preview / canvas) docks in-flow
            // and shrinks this column, a visible "glitch" on open. Anchoring left
            // keeps it stable through that animation, and reads cleaner.
            className="flex min-w-0 flex-1 items-center gap-2 justify-start"
          >
            {headerContent ??
              (fallbackTitle && (
                <span
                  data-testid="surface-title"
                  className="truncate text-sm font-medium text-foreground"
                >
                  {fallbackTitle}
                </span>
              ))}
          </div>

          {/* Cluster order = status first (connection dot, then the spend pill),
              then the contextual view control (Preview), then the global Theme
              toggle anchored at the far-right edge. */}
          <ConnectionDot status={connection} />
          {headerAccessory}

          {/* Preview panel toggle (⌘⇧V). Only mounts when a preview panel is
              provided, so surfaces without one leave the header clean. */}
          {preview && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onTogglePreview}
              aria-label={previewOpen ? 'Close preview' : 'Open preview'}
              aria-expanded={previewOpen}
              aria-keyshortcuts="Meta+Shift+V Control+Shift+V"
              data-testid="preview-toggle"
              className={cn(
                'size-11 sm:size-10',
                previewOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Globe className="size-4" />
            </Button>
          )}

          <ThemeToggle />
        </header>

        <main className="relative flex min-h-0 flex-1 justify-center overflow-hidden">
          {/* The conversation surfaces self-cap at ~720px and stay centered; the
              wide workspace/system surfaces (Files two-pane, Terminal, Usage) use
              their own intended widths, so the shell doesn't clamp them here.
              `overflow-y-auto` makes document-style surfaces (Settings, Models,
              Agents, Usage, Logs, …) scroll when taller than the viewport; the
              full-height surfaces (Chat/Files/Terminal use h-full/flex-1 + min-h-0)
              fill it exactly, so they never get a second scrollbar. */}
          <div className="flex min-h-0 w-full flex-col overflow-y-auto px-4">{children}</div>
        </main>
      </div>

      {/* Right PREVIEW panel (#116) — the in-app iframe browser. Two
          morphologies (docked in-flow column at the wide cockpit; a fixed
          slide-over + scrim + focus-trap below it). It always
          renders so the loaded page survives route changes + toggles; the
          structurally-identical Suspense fallback keeps layout correct before the
          motion chunk lands. */}
      {preview && (
        <>
          {!isWideCockpit && (
            <Suspense fallback={null}>
              <PreviewBackdrop open={previewOpen} onClose={() => onTogglePreview?.()} />
            </Suspense>
          )}
          <Suspense
            fallback={
              isWideCockpit ? (
                <aside
                  aria-label="Preview"
                  data-testid="preview-drawer"
                  data-open={previewOpen}
                  data-docked
                  aria-hidden={previewOpen ? undefined : true}
                  inert={previewOpen ? undefined : true}
                  style={{ width: previewOpen ? PREVIEW_WIDTH : 0 }}
                  className="relative z-[5] shrink-0 overflow-hidden border-l border-border bg-surface-1 data-[open=false]:pointer-events-none"
                >
                  <div style={{ width: PREVIEW_WIDTH }} className="h-full">
                    {previewContent}
                  </div>
                </aside>
              ) : (
                <aside
                  aria-label="Preview"
                  data-testid="preview-drawer"
                  data-open={previewOpen}
                  data-docked={false}
                  aria-hidden={previewOpen ? undefined : true}
                  inert={previewOpen ? undefined : true}
                  style={{
                    width: PREVIEW_WIDTH,
                    transform: previewOpen ? undefined : `translateX(${PREVIEW_WIDTH + 16}px)`,
                  }}
                  className="fixed inset-y-0 right-0 z-50 max-w-[92vw] border-l border-border bg-surface-1 shadow-2xl shadow-black/40 data-[open=false]:pointer-events-none"
                >
                  {previewContent}
                </aside>
              )
            }
          >
            <PreviewDrawer open={previewOpen} reduce={reduce} docked={isWideCockpit}>
              {previewContent}
            </PreviewDrawer>
          </Suspense>
        </>
      )}
    </div>
  )
}

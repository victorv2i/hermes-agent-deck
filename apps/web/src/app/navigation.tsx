import { lazy, type ReactNode } from 'react'
import {
  Home,
  MessagesSquare,
  History,
  Library,
  FolderTree,
  SquareTerminal,
  IdCard,
  Cable,
  Settings,
  BarChart3,
  CalendarClock,
  ScrollText,
  KanbanSquare,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ApprovalChoice, RunAttachment } from '@agent-deck/protocol'
import type { ConnectionStatus } from '@/lib/chatSocket'
import { en } from '@/i18n/messages.en'
// Chat (now at '/chat') stays EAGER — it's the surface a power user opens fastest
// and most often, and keeping it off the lazy path avoids a Suspense flash on the
// very first send. Every other surface is route-level code-split via React.lazy so
// the entry chunk no longer bundles all 8 surfaces (the ~767kB monolith); each
// loads on first navigation, behind the Suspense skeleton in App.
import { ChatRoute } from '@/components/chat/ChatRoute'

// Home is the welcoming front door — the ROOT/index surface newcomers land on.
// It's code-split: the entry chunk stays lean, and the index Home renders behind
// the Suspense skeleton in App on first paint.
const HomeRoute = lazy(() => import('@/features/home').then((m) => ({ default: m.HomeRoute })))
const SessionsRoute = lazy(() =>
  import('@/features/sessions/SessionsRoute').then((m) => ({ default: m.SessionsRoute })),
)
const HistoryRoute = lazy(() =>
  import('@/features/sessions/HistoryRoute').then((m) => ({ default: m.HistoryRoute })),
)
const FilesRoute = lazy(() =>
  import('@/features/files/FilesRoute').then((m) => ({ default: m.FilesRoute })),
)
const TerminalRoute = lazy(() =>
  import('@/features/terminal/TerminalRoute').then((m) => ({ default: m.TerminalRoute })),
)
const ProfilesPage = lazy(() =>
  import('@/features/profiles/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
)
const SettingsPage = lazy(() =>
  import('@/features/settings').then((m) => ({ default: m.SettingsPage })),
)
const UsageRoute = lazy(() =>
  import('@/features/usage/UsageRoute').then((m) => ({ default: m.UsageRoute })),
)
const JobsRoute = lazy(() =>
  import('@/features/jobs/JobsRoute').then((m) => ({ default: m.JobsRoute })),
)
const LogsRoute = lazy(() =>
  import('@/features/logs/LogsRoute').then((m) => ({ default: m.LogsRoute })),
)
const KanbanRoute = lazy(() =>
  import('@/features/kanban').then((m) => ({ default: m.KanbanRoute })),
)
const SystemRoute = lazy(() =>
  import('@/features/system').then((m) => ({ default: m.SystemRoute })),
)
// Voice + Messaging + MCP fold into ONE tabbed Connections surface — those three
// Routes are now MOUNTED (unchanged) as tabs inside ConnectionsRoute, not as
// standalone rail surfaces. The old /voice · /messaging · /mcp paths redirect
// here (router.tsx) so deep-links + Settings' "Configured on the X page →" land.
const ConnectionsRoute = lazy(() =>
  import('@/features/connections').then((m) => ({ default: m.ConnectionsRoute })),
)
const ToolsetsRoute = lazy(() =>
  import('@/features/tools').then((m) => ({ default: m.ToolsetsRoute })),
)
const AgentDetailPage = lazy(() =>
  import('@/features/profiles/AgentDetailPage').then((m) => ({ default: m.AgentDetailPage })),
)

/**
 * Surface registry — the SINGLE source of truth for the app's navigable
 * surfaces. The rail (Sidebar) renders these grouped, and the router
 * (app/router.tsx) turns each entry into a route. Registering a new surface is a
 * purely additive edit here: append a `NavItem` and provide its `element`.
 *
 * Home owns the index ('/') — the welcoming front door — and Chat lives at
 * '/chat'. Every other surface maps its own path.
 */

/**
 * The rail groups surfaces under these section keys, in this order. The KEY is a
 * stable internal identifier; the human-facing rail HEADER is {@link NAV_GROUP_LABELS}:
 * friendly words ("Your agent", "Workspace", "Activity") instead of raw jargon.
 *
 * Home + Chat are PINNED-TOP standalone items (not group members), so there's no
 * "chat"/"Conversations" group: the rail leads with the two primary destinations,
 * then "Your agent" first (identity + capabilities, the product's personalization
 * core), then Workspace, then Activity.
 */
export const NAV_GROUPS = ['agent', 'workspace', 'activity'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]
type MessageKey = keyof typeof en
export type NavGroupLabelKey = Extract<MessageKey, `navigation.group.${NavGroup}.label`>
export type NavItemLabelKey = Extract<MessageKey, `navigation.item.${string}.label`>

function navMessage<K extends MessageKey>(key: K): (typeof en)[K] {
  return en[key]
}

export const NAV_GROUP_LABEL_KEYS = {
  workspace: 'navigation.group.workspace.label',
  agent: 'navigation.group.agent.label',
  activity: 'navigation.group.activity.label',
} satisfies Record<NavGroup, NavGroupLabelKey>

/** The friendly section header shown in the rail for each group (recognition over
 * jargon). Keep these warm + plain so a newcomer reads the rail without a glossary.
 * The KEYS stay internal/stable; only these LABELS are user-facing. */
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  workspace: navMessage(NAV_GROUP_LABEL_KEYS.workspace),
  agent: navMessage(NAV_GROUP_LABEL_KEYS.agent),
  activity: navMessage(NAV_GROUP_LABEL_KEYS.activity),
}

/**
 * The Chat surface path. Home owns the index ('/'), so Chat lives here. Exported
 * as the single source of truth for the few places that must detect/route to the
 * conversation surface (the layout's rail morphology, new-chat/resume navigation,
 * the background-notification "are you viewing chat?" check).
 */
export const CHAT_PATH = '/chat'

export interface NavItem {
  /** Stable key (also used for keyed lists / active-state lookups). */
  key: string
  /** Rail label. */
  label: string
  /** i18n key for the rail label. */
  labelKey: NavItemLabelKey
  /** Route path; the active surface renders in the content Outlet. */
  path: string
  /** Lucide icon component for the rail row. */
  icon: LucideIcon
  /** Rail section this surface belongs to. */
  group: NavGroup
  /** The element rendered when this surface is active. */
  element: ReactNode
  /**
   * When true the surface is routed but NOT rendered as a rail nav link. Used by
   * the dynamic Sessions History route (`/sessions/:id`), whose entry point is
   * the session list in the rail, not a static nav link.
   */
  hidden?: boolean
  /**
   * When true this surface is PINNED to the bottom of the rail (below the grouped
   * nav, above the fold), separated by a hairline. Settings uses this — the
   * conventional "anchored at the bottom" home for app preferences.
   */
  pinned?: boolean
  /**
   * When true this surface is PINNED to the TOP of the rail — a STANDALONE item
   * ABOVE the grouped nav (mirror of {@link pinned}), not under any section
   * header. Home + Chat use this: the two primary destinations lead the rail
   * (Home is the front door; Chat is the surface opened most), not as members of
   * any group.
   */
  pinnedTop?: boolean
}

export const NAV: NavItem[] = [
  {
    // Home is a STANDALONE top item — the welcoming front door, NOT a member of
    // any group. `pinnedTop` floats it ABOVE the grouped nav (mirror of how
    // Settings is `pinned` below). Its `group` is just a stable routing tag (the
    // rail never lists it there); `workspace` is an arbitrary valid bucket.
    key: 'home',
    label: navMessage('navigation.item.home.label'),
    labelKey: 'navigation.item.home.label',
    path: '/',
    icon: Home,
    group: 'workspace',
    element: <HomeRoute />,
    pinnedTop: true,
  },
  {
    // Chat is PROMOTED to a primary pinned-top item, beside Home — the surface a
    // user opens fastest/most often. Like Home it's standalone (not a group
    // member); the `group` tag is just stable routing metadata.
    key: 'chat',
    label: navMessage('navigation.item.chat.label'),
    labelKey: 'navigation.item.chat.label',
    path: CHAT_PATH,
    icon: MessagesSquare,
    group: 'workspace',
    element: <ChatRoute />,
    pinnedTop: true,
  },
  {
    // History — past conversations' home (search · date groups · projects ·
    // pin/delete). It FOLDED INTO Chat in the nav: on desktop the Chat surface's
    // session pane IS the history, so History is no longer a rail link
    // (`hidden`). The `/history` route survives for deep-links, ⌘K, and the
    // mobile "Past chats" button in ChatHeader. Keeps `chats` as the stable key
    // (the data term stays "session"); the path + label stay "History".
    key: 'chats',
    label: navMessage('navigation.item.chats.label'),
    labelKey: 'navigation.item.chats.label',
    path: '/history',
    icon: Library,
    group: 'workspace',
    element: <HistoryRoute />,
    hidden: true,
  },
  {
    key: 'sessions',
    label: navMessage('navigation.item.sessions.label'),
    labelKey: 'navigation.item.sessions.label',
    path: '/sessions/:id',
    icon: History,
    group: 'workspace',
    element: <SessionsRoute />,
    hidden: true,
  },
  {
    // Files + Terminal were the techie tuck under a collapsible "Advanced" group.
    // That group is removed (flatter, cohesive rail): the daily work surfaces now
    // live in "Workspace"; Tools moved to "Your agent"; Usage to "Activity".
    key: 'files',
    label: navMessage('navigation.item.files.label'),
    labelKey: 'navigation.item.files.label',
    path: '/files',
    icon: FolderTree,
    group: 'workspace',
    element: <FilesRoute />,
  },
  {
    // Tasks (scheduled/cron work) — PROMOTED out of Advanced to the top-level
    // "Activity" group (it's a daily-shaped destination, not a techie-only tuck).
    // Registry order puts it FIRST in Activity, ahead of the Board. Label is
    // "Tasks"; the route stays /jobs.
    key: 'jobs',
    label: navMessage('navigation.item.jobs.label'),
    labelKey: 'navigation.item.jobs.label',
    path: '/jobs',
    icon: CalendarClock,
    group: 'activity',
    element: <JobsRoute />,
  },
  {
    // Board (the live task board) — PROMOTED out of Advanced to the top-level
    // "Activity" group, beside Tasks. Label is "Board"; the route stays /kanban.
    key: 'kanban',
    label: navMessage('navigation.item.kanban.label'),
    labelKey: 'navigation.item.kanban.label',
    path: '/kanban',
    icon: KanbanSquare,
    group: 'activity',
    element: <KanbanRoute />,
  },
  {
    key: 'terminal',
    label: navMessage('navigation.item.terminal.label'),
    labelKey: 'navigation.item.terminal.label',
    path: '/terminal',
    icon: SquareTerminal,
    group: 'workspace',
    element: <TerminalRoute />,
  },
  {
    key: 'profiles',
    label: navMessage('navigation.item.profiles.label'),
    labelKey: 'navigation.item.profiles.label',
    path: '/profiles',
    icon: IdCard,
    group: 'agent',
    element: <ProfilesPage />,
  },
  {
    // The Tools surface — "what your agent can actually do." Models = its brain,
    // MCP/Voice/Messaging now live in Connections, Tools = the built-in toolsets
    // (web/browser/terminal/files/vision/…). Real in-browser toggle backed by
    // stock PUT /api/tools/toolsets/{name} (web_server.py:5752); change persists
    // to config.yaml and takes effect after a gateway restart (honest copy shown).
    key: 'tools',
    label: navMessage('navigation.item.tools.label'),
    labelKey: 'navigation.item.tools.label',
    path: '/tools',
    icon: Wrench,
    group: 'agent',
    element: <ToolsetsRoute />,
  },
  {
    // Connections — ONE tabbed home for the agent's outward reach: Voice ·
    // Messaging · MCP (folded from three separate rail rows). These are
    // settings-shaped (Settings deep-links "Configured on the X page →"), not
    // daily destinations, so they collapse into one surface. Each tab MOUNTS the
    // existing surface Route unchanged (re-house, not rewrite); the old
    // /voice · /messaging · /mcp paths redirect here with the right ?tab=.
    key: 'connections',
    label: navMessage('navigation.item.connections.label'),
    labelKey: 'navigation.item.connections.label',
    path: '/connections',
    icon: Cable,
    group: 'agent',
    element: <ConnectionsRoute />,
  },
  {
    // The per-agent HUB. Routed (the catch-all `*` is replaced by this dynamic
    // child) but NOT a rail link — you reach it from the Agents list / chip.
    // Soul (the former standalone /memory) lives here now, scoped to the agent.
    key: 'agent-detail',
    label: navMessage('navigation.item.agent-detail.label'),
    labelKey: 'navigation.item.agent-detail.label',
    path: '/profiles/:name',
    icon: IdCard,
    group: 'agent',
    element: <AgentDetailPage />,
    hidden: true,
  },
  {
    // Usage = cost + token metering, not the agent's "Activity" (Tasks/Board). It is
    // floated to the pinned-bottom cluster, just above Settings, where metering and
    // preferences sit together. `group` stays a routing tag; `pinned` floats it out.
    key: 'usage',
    label: navMessage('navigation.item.usage.label'),
    labelKey: 'navigation.item.usage.label',
    path: '/usage',
    icon: BarChart3,
    group: 'activity',
    element: <UsageRoute />,
    pinned: true,
  },
  {
    // Logs — DEMOTED out of the top-level rail (it's a debugging tool, not a daily
    // destination). Routed + fully reachable, just not a rail row: it's listed in
    // the ⌘K palette ("Open Logs") and Settings' "Maintenance & logs" link.
    // `hidden` keeps it off the rail AND out of the palette's auto "Go to" rows
    // (which only show non-hidden surfaces); the explicit palette action covers it.
    key: 'logs',
    label: navMessage('navigation.item.logs.label'),
    labelKey: 'navigation.item.logs.label',
    path: '/logs',
    icon: ScrollText,
    group: 'activity',
    element: <LogsRoute />,
    hidden: true,
  },
  {
    // The Maintenance dock — restart the gateway + update Hermes (honest, real
    // checks). A VISIBLE Activity rail row (registry order puts it after Board,
    // just above the pinned bottom): these are the RECOVERY actions, and a user
    // whose agent is down needs them findable from the rail — not only via ⌘K,
    // a buried Settings link, or Home's StatusBand deep-link.
    key: 'system',
    label: navMessage('navigation.item.system.label'),
    labelKey: 'navigation.item.system.label',
    path: '/system',
    icon: ShieldCheck,
    group: 'activity',
    element: <SystemRoute />,
  },
  {
    // Settings is PINNED to the bottom of the rail (the conventional anchored
    // home for app preferences), so it's grouped 'activity' for routing but the
    // rail floats it below the fold via {@link pinned}.
    key: 'settings',
    label: navMessage('navigation.item.settings.label'),
    labelKey: 'navigation.item.settings.label',
    path: '/settings',
    icon: Settings,
    group: 'activity',
    element: <SettingsPage />,
    pinned: true,
  },
  // Skills retired as a standalone surface — folded into each agent's hub
  // (`/profiles/:name`, the Skills tab). The `/skills` path redirects (router.tsx),
  // so deep links survive, mirroring how `/memory` was folded in.
]

/** NAV grouped + ordered by {@link NAV_GROUPS}, dropping empty groups. The
 * Sidebar consumes this so the grouping logic lives next to the registry.
 * `hidden` surfaces (the dynamic Sessions route, the demoted Logs) are
 * routed but never shown as rail links; `pinned` surfaces (Settings) are pulled
 * OUT of the grouped flow — the rail floats them at the bottom via
 * {@link pinnedNavItems}; `pinnedTop` surfaces (Home + Chat) are floated ABOVE the
 * grouped nav via {@link pinnedTopNavItems}. */
export function navByGroup(): { group: NavGroup; label: string; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: NAV.filter(
      (item) => item.group === group && !item.hidden && !item.pinned && !item.pinnedTop,
    ),
  })).filter((g) => g.items.length > 0)
}

/** The rail-link surfaces PINNED to the TOP (Home + Chat), in registry order.
 * Rendered ABOVE the grouped nav as standalone items (mirror of {@link pinnedNavItems}). */
export function pinnedTopNavItems(): NavItem[] {
  return NAV.filter((item) => item.pinnedTop && !item.hidden)
}

/** The rail-link surfaces PINNED to the bottom (Settings), in registry order.
 * Rendered below the grouped nav, separated by a hairline. */
export function pinnedNavItems(): NavItem[] {
  return NAV.filter((item) => item.pinned && !item.hidden)
}

/**
 * The friendly TITLE for a surface, resolved from a pathname — what the shell
 * header shows on surfaces that don't project their own header content (most of
 * them today read as contextless). Matches the longest static NAV path so
 * `/profiles/foo` still reads "Agents"; the dynamic `/sessions/:id` reads
 * "History" (its conceptual home). Returns null for an unknown path (the header
 * then stays a plain spacer rather than inventing a title).
 */
export function surfaceTitle(pathname: string): string | null {
  // The index '/' is Home.
  if (pathname === '/') return navMessage('navigation.item.home.label')
  // A session-history deep link belongs to the History surface conceptually.
  if (pathname.startsWith('/sessions/')) return navMessage('navigation.item.chats.label')
  // Longest static-prefix match over the visible + routed surfaces, so nested
  // paths (e.g. /profiles/:name) resolve to their parent surface's label.
  const candidates = NAV.filter((i) => i.path !== '/' && !i.path.includes(':'))
  let best: NavItem | null = null
  for (const item of candidates) {
    if (pathname === item.path || pathname.startsWith(item.path + '/')) {
      if (!best || item.path.length > best.path.length) best = item
    }
  }
  return best?.label ?? null
}

/**
 * Shared chat actions the layout owns (one live `/chat-run` socket) and exposes
 * to the Chat surface via react-router's Outlet context. Co-located here so the
 * surface registry and its context contract stay together.
 */
export interface ChatOutletContext {
  /** Send a message, optionally targeting a specific model (composer picker) and
   * carrying inline image attachments (S5). */
  send: (text: string, model?: string, attachments?: RunAttachment[]) => void
  stop: () => void
  respondApproval: (choice: ApprovalChoice) => void
  /** Retry/Regenerate an assistant turn (re-run its prompting user turn). */
  retry: (assistantTurnId: string, model?: string) => void
  /** Edit-and-resend a user turn (trim later turns, re-run with edited text). */
  editTurn: (userTurnId: string, newText: string, model?: string) => void
  connection: ConnectionStatus
  /** Start a fresh conversation (rail/palette/⌘N) — wires the composer's `/new`. */
  newChat: () => void
  /** Clear the current conversation in place — wires the composer's `/clear`. */
  clearChat: () => void
  /** Open the ⌘K command palette. The App layout owns the palette's open state;
   * surfaces that advertise it (Home's hero ⌘K hint chip) drive it through this
   * App-owned action, the same seam as newChat/clearChat. */
  openPalette: () => void
  /** The active hermes session id (null/undefined for an unsent new chat). Keys
   * the composer's per-conversation persisted draft so each chat keeps its own.
   * Optional so a stub Outlet provider that doesn't run a live socket compiles
   * (it falls back to the `:new` draft sentinel). */
  activeSessionId?: string | null
}

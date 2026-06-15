import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  type ComponentType,
  type KeyboardEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { AudioLines, Blocks, KeyRound, Send, Shield, Webhook, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SurfaceFallback } from '@/components/layout/SurfaceFallback'
import { resolveConnectionsTab, type ConnectionsTabId } from './connectionsTabs'

/**
 * The Connections surface (`/connections`) — ONE home for the agent's outward
 * reach: Voice, Messaging, MCP, Pairing, Webhooks, and Credentials. The first
 * three were already here; the last three are new (P5) covering the full Hermes
 * connections surface: approve/revoke pairing users, manage inbound webhooks,
 * and manage the rotating API-key credential pool.
 *
 * Each tab mounts its own surface component; the shell adds the tab strip and
 * routes the active tab through `?tab=`.
 */

const VoiceRoute = lazy(() => import('@/features/voice').then((m) => ({ default: m.VoiceRoute })))
const MessagingRoute = lazy(() =>
  import('@/features/messaging').then((m) => ({ default: m.MessagingRoute })),
)
const McpRoute = lazy(() => import('@/features/mcp').then((m) => ({ default: m.McpRoute })))
const PairingTab = lazy(() => import('./PairingTab').then((m) => ({ default: m.PairingTab })))
const WebhooksTab = lazy(() => import('./WebhooksTab').then((m) => ({ default: m.WebhooksTab })))
const CredentialsTab = lazy(() =>
  import('./CredentialsTab').then((m) => ({ default: m.CredentialsTab })),
)

/** A Connections tab: its `?tab=` id, rail/tab label, icon, and the surface it mounts. */
interface ConnectionsTab {
  id: ConnectionsTabId
  label: string
  icon: LucideIcon
  element: ComponentType
}

/** A labeled cluster of tabs in the strip (user-facing channels vs admin infra). */
interface ConnectionsTabCluster {
  id: string
  /** The small muted group label shown in the tab strip (decorative for SRs). */
  label: string
  tabs: ConnectionsTab[]
}

/**
 * The six tabs, grouped into two labeled clusters: the user-facing CHANNELS
 * (Voice · Messaging · MCP) lead; the admin-infra ADVANCED cluster (Pairing ·
 * Webhooks · Credentials) follows. Each `element` is code-split; only the active
 * tab's chunk loads, behind the shared Suspense skeleton. The flattened order
 * still matches {@link CONNECTIONS_TAB_IDS}, so `?tab=` deep links and the
 * roving arrow-key nav are unchanged.
 */
const CONNECTIONS_TAB_CLUSTERS: ConnectionsTabCluster[] = [
  {
    id: 'channels',
    label: 'Channels',
    tabs: [
      { id: 'voice', label: 'Voice', icon: AudioLines, element: VoiceRoute },
      { id: 'messaging', label: 'Messaging', icon: Send, element: MessagingRoute },
      { id: 'mcp', label: 'MCP', icon: Blocks, element: McpRoute },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    tabs: [
      { id: 'pairing', label: 'Pairing', icon: Shield, element: PairingTab },
      { id: 'webhooks', label: 'Webhooks', icon: Webhook, element: WebhooksTab },
      { id: 'credentials', label: 'Credentials', icon: KeyRound, element: CredentialsTab },
    ],
  },
]

/** All six tabs in display order — the keyboard walk + active lookup use this. */
const CONNECTIONS_TABS: ConnectionsTab[] = CONNECTIONS_TAB_CLUSTERS.flatMap((c) => c.tabs)

export function ConnectionsRoute() {
  const [params, setParams] = useSearchParams()
  const active = resolveConnectionsTab(params.get('tab'))

  // Switch tab = rewrite ?tab= (replace, so the tab strip doesn't pollute Back).
  const selectTab = useCallback(
    (id: ConnectionsTabId) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', id)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Roving arrow-key nav across the tabs (a real tablist), mirroring the
  // Terminal/AgentMemory tab pattern: ←/→ move + activate, Home/End jump to ends.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = CONNECTIONS_TABS.map((t) => t.id)
    const i = ids.indexOf(active)
    if (i === -1) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % ids.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    if (next === null) return
    e.preventDefault()
    selectTab(ids[next]!)
  }

  const ActiveSurface = CONNECTIONS_TABS.find((t) => t.id === active)!.element

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab strip — a real tablist with roving tabindex + arrow-key nav, grouped
          into two LABELED clusters (Channels, then Advanced) so the user-facing
          channels never read as peers of the admin plumbing. The cluster labels +
          separator are decorative (aria-hidden / presentation): one flat tablist
          remains, ids and order unchanged. The active tab carries the sanctioned
          faint-amber active treatment (amber tint + amber label); inactive tabs
          stay quiet/neutral. This wrapper owns the page's SINGLE top zone (pt-4);
          the child surfaces start flush below it (their own wrappers add no top
          padding), so the top rhythm reads once, not doubled. */}
      <div className="mx-auto w-full max-w-4xl px-4 pt-4 sm:px-6">
        <div
          role="tablist"
          aria-label="Connections"
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className="ad-surface ad-raised flex w-full flex-col gap-1 rounded-md bg-surface-1 p-1 sm:inline-flex sm:w-auto sm:max-w-full sm:flex-row sm:items-center sm:gap-1 sm:overflow-x-auto"
        >
          {CONNECTIONS_TAB_CLUSTERS.map((cluster, index) => (
            <Fragment key={cluster.id}>
              {index > 0 && (
                <div
                  aria-hidden
                  className="mx-1 h-px shrink-0 bg-border sm:mx-1.5 sm:my-1 sm:h-auto sm:w-px sm:self-stretch"
                />
              )}
              <div
                role="presentation"
                className="flex min-w-0 flex-col sm:flex-row sm:items-center"
              >
                <span
                  aria-hidden
                  className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wider text-foreground-tertiary uppercase sm:px-1.5 sm:py-0"
                >
                  {cluster.label}
                </span>
                <div role="presentation" className="grid grid-cols-3 sm:flex">
                  {cluster.tabs.map((t) => {
                    const selected = t.id === active
                    const Icon = t.icon
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        id={`connections-tab-${t.id}`}
                        aria-selected={selected}
                        aria-controls="connections-tabpanel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => selectTab(t.id)}
                        className={cn(
                          'inline-flex min-h-11 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-13 font-medium transition-colors sm:gap-2 sm:px-3.5',
                          'focus-visible:ad-focus',
                          selected
                            ? 'bg-primary/12 text-primary'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4 shrink-0 max-[359px]:hidden" aria-hidden />
                        <span className="min-w-0 truncate">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* Active surface — the EXISTING Route, unchanged (owns its own header +
          data). Keyed by tab id so switching remounts the surface cleanly. */}
      <div
        id="connections-tabpanel"
        role="tabpanel"
        aria-labelledby={`connections-tab-${active}`}
        className="flex min-h-0 flex-1 flex-col pt-4"
      >
        <Suspense fallback={<SurfaceFallback />}>
          <ActiveSurface key={active} />
        </Suspense>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { ArrowLeft, Server } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/state'
import type { ProfileSummary } from '@/features/profiles/types'
import type { StudioSection, StudioView } from './state/selection'
import { StudioHero } from './StudioHero'
import { StudioLaunchpad, type LaunchpadStatus } from './StudioLaunchpad'
import { StudioRoster } from './StudioRoster'
import { StudioWorkbench } from './StudioWorkbench'

/**
 * StudioPage — the Agent Studio surface (Home). The "Agents" view leads: the
 * pixel-art gateway hero, a slim launchpad strip beneath it (tending status + a
 * quiet "Connections" action + "Start a chat"), then a master-detail layout: the
 * agent roster (master) beside the selected agent's workbench (detail). The
 * GLOBAL Connections surface (it applies to every agent) opens FROM the launchpad
 * as its own view with a back link, rather than as a top-level peer of the
 * roster. On mobile the master-detail columns stack (roster first, then
 * workbench).
 *
 * Presentational by design: the roster + selection + the launchpad status + every
 * action callback arrive as props (the connected {@link './StudioRoute'} wires the
 * hooks), and the embedded Connections surface arrives as the `connections` node,
 * so the surface is testable hermetically. The Hatch + Clone dialogs live in the
 * route (they navigate / mutate), not here.
 */
export interface StudioPageProps {
  /** The top-level Studio view: the roster ("agents") or the global Connections. */
  view: StudioView
  onViewChange: (view: StudioView) => void
  /** The embedded global Connections surface, rendered when `view === 'connections'`. */
  connections: ReactNode
  profiles: ProfileSummary[]
  loading: boolean
  error: string | null
  /** The open agent (its workbench shows), or null (empty roster). */
  selectedAgent: string | null
  /** The full roster row for the open agent, or null. */
  selectedProfile: ProfileSummary | null
  section: StudioSection
  /** The launchpad's tending status summary, or undefined while it loads. */
  launchpadStatus: LaunchpadStatus | undefined
  /**
   * The "While you were away" catch-up card, rendered at the top of the agents
   * view as a gentle on-return note (or null when there is nothing to report).
   * Passed as a node so the Studio stays presentational; the route wires its data.
   */
  awayDigest?: ReactNode
  onSelectAgent: (name: string) => void
  onSectionChange: (section: StudioSection) => void
  onStartChat: () => void
  onNewAgent: () => void
  onCloneSelected: (sourceName: string) => void
  /** Open the Import dialog (bring an exported `.tar.gz` agent back as a new one). */
  onImport: () => void
  onRetry: () => void
}

export function StudioPage({
  view,
  onViewChange,
  connections,
  profiles,
  loading,
  error,
  selectedAgent,
  selectedProfile,
  section,
  launchpadStatus,
  awayDigest,
  onSelectAgent,
  onSectionChange,
  onStartChat,
  onNewAgent,
  onCloneSelected,
  onImport,
  onRetry,
}: StudioPageProps) {
  return (
    // Top-aligned, capped at a comfortable measure. A small top pad keeps the
    // hero banner up near the chrome (no dead space above it); the launchpad,
    // heading, and roster/workbench flow beneath.
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pt-4 pb-10 sm:px-6 lg:pt-5 lg:pb-12">
      <div className="flex w-full flex-col gap-6">
        {view === 'connections' ? (
          // The GLOBAL Connections surface, embedded unchanged (it keeps its own
          // internal Voice/Messaging/MCP/Pairing/Webhooks/Credentials sub-tabs).
          // Reached FROM the launchpad's "Connections" action (not a top-level
          // peer of the roster), so a quiet back link returns to the agents view.
          <section aria-label="Connections" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onViewChange('agents')}
                className="inline-flex items-center gap-1.5 self-start rounded text-13 text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus"
              >
                <ArrowLeft className="size-4 shrink-0" aria-hidden />
                Agent Studio
              </button>
              <h2 className="text-lg font-semibold text-foreground">Connections</h2>
              <p className="text-13 text-foreground-tertiary">
                These connections apply to all your agents.
              </p>
            </div>
            {connections}
          </section>
        ) : (
          <>
            {/* The deliberate hero band, then the slim launchpad strip integrated
                directly beneath it. */}
            <StudioHero />
            <StudioLaunchpad
              status={launchpadStatus}
              onStartChat={onStartChat}
              onOpenConnections={() => onViewChange('connections')}
            />

            {/* The on-return catch-up note sits UNDER the banner + launchpad: a
                gentle note before the daily landing. Null when nothing to report. */}
            {awayDigest}

            {/* The Studio's own heading sits under the launchpad - the nav/chrome
                call this surface "Home"; here it names the workbench beneath. */}
            <div className="flex flex-col gap-0.5">
              <h2 className="font-wordmark text-xl font-semibold text-foreground">Agent Studio</h2>
              <p className="text-13 text-foreground-tertiary">
                Pick an agent to shape its identity, model, tools, and memory.
              </p>
            </div>

            {loading ? (
              <StudioSkeleton />
            ) : error ? (
              <ErrorState
                icon={Server}
                title="Couldn't load your agents"
                description={error}
                onRetry={onRetry}
              />
            ) : (
              // Master-detail: a clean secondary roster column beside the
              // workbench (the focus). On mobile (<lg) the grid collapses to one
              // column, so the roster stacks above the workbench (master →
              // detail). The workbench is the wider, raised panel so the eye lands
              // on it.
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <StudioRoster
                    profiles={profiles}
                    selected={selectedAgent}
                    onSelect={onSelectAgent}
                    onNewAgent={onNewAgent}
                    onCloneSelected={onCloneSelected}
                    onImport={onImport}
                  />
                </div>

                {selectedAgent && selectedProfile ? (
                  // A comfortable minimum height gives the detail panel real
                  // vertical presence, so the centered landing reads as an
                  // intentional workbench rather than a thin strip. It grows past
                  // this for tall sections (then the wrapper top-aligns and the
                  // page scrolls).
                  // overflow-visible (Card defaults to overflow-hidden) lets the
                  // workbench's sticky section tabs pin to the page scroll
                  // container instead of clipping inside the Card.
                  <Card className="ad-raised min-h-[26rem] min-w-0 overflow-visible p-5 sm:p-6">
                    <StudioWorkbench
                      key={selectedAgent}
                      agent={selectedAgent}
                      profile={selectedProfile}
                      section={section}
                      onSectionChange={onSectionChange}
                    />
                  </Card>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StudioSkeleton() {
  return (
    <div
      data-testid="studio-loading"
      className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]"
      aria-busy="true"
    >
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <Card key={i} size="sm">
            <div className="flex items-center gap-3 px-3.5 py-3">
              <Skeleton circle className="size-10" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </Card>
    </div>
  )
}

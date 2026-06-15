import { Server } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/state'
import type { ProfileSummary } from '@/features/profiles/types'
import type { StudioSection } from './state/selection'
import { StudioLaunchpad, type LaunchpadStatus } from './StudioLaunchpad'
import { StudioRoster } from './StudioRoster'
import { StudioWorkbench } from './StudioWorkbench'

/**
 * StudioPage — the Agent Studio surface (Home). A slim launchpad strip on top
 * (tending status + Start a chat), then a master-detail layout: the agent roster
 * (master) beside the selected agent's workbench (detail). On mobile the columns
 * stack (roster first, then workbench), reusing the app's responsive grid.
 *
 * Presentational by design: the roster + selection + the launchpad status + every
 * action callback arrive as props (the connected {@link './StudioRoute'} wires the
 * hooks), so the surface is testable hermetically. The Hatch + Clone dialogs live
 * in the route (they navigate / mutate), not here.
 */
export interface StudioPageProps {
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
  onSelectAgent: (name: string) => void
  onSectionChange: (section: StudioSection) => void
  onStartChat: () => void
  onNewAgent: () => void
  onCloneSelected: (sourceName: string) => void
  onRetry: () => void
}

export function StudioPage({
  profiles,
  loading,
  error,
  selectedAgent,
  selectedProfile,
  section,
  launchpadStatus,
  onSelectAgent,
  onSectionChange,
  onStartChat,
  onNewAgent,
  onCloneSelected,
  onRetry,
}: StudioPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <StudioLaunchpad status={launchpadStatus} onStartChat={onStartChat} />

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
        // Master-detail: the roster column (fixed-ish) beside the workbench. On
        // mobile (<lg) the grid collapses to one column, so the roster stacks
        // above the workbench (master → detail), keeping the mobile flow.
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-2 lg:self-start">
            <StudioRoster
              profiles={profiles}
              selected={selectedAgent}
              onSelect={onSelectAgent}
              onNewAgent={onNewAgent}
              onCloneSelected={onCloneSelected}
            />
          </div>

          {selectedAgent && selectedProfile ? (
            <Card className="min-w-0 p-4 sm:p-5">
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

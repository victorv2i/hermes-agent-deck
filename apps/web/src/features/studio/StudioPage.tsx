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
    // Fill the available viewport height; the inner wrapper centers the
    // composition (launchpad + roster + workbench) when it fits, so a short
    // landing reads as a balanced panel rather than content stranded at the top
    // over a dead void. When a tall section overflows (Model's provider list, a
    // long Soul), `my-auto` collapses to 0 and the wrapper top-aligns + scrolls,
    // so the tab bar is never pushed above the fold (unlike `justify-center`,
    // which clips the top of a scroll container). Capped at a comfortable measure.
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-8 sm:px-6 lg:py-12">
      <div className="my-auto flex w-full flex-col gap-6">
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
          // Master-detail: a clean secondary roster column beside the workbench
          // (the focus). On mobile (<lg) the grid collapses to one column, so the
          // roster stacks above the workbench (master → detail). The workbench is
          // the wider, raised panel so the eye lands on it.
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <StudioRoster
                profiles={profiles}
                selected={selectedAgent}
                onSelect={onSelectAgent}
                onNewAgent={onNewAgent}
                onCloneSelected={onCloneSelected}
              />
            </div>

            {selectedAgent && selectedProfile ? (
              // A comfortable minimum height gives the detail panel real vertical
              // presence, so the centered landing reads as an intentional
              // workbench rather than a thin strip. It grows past this for tall
              // sections (then the wrapper top-aligns and the page scrolls).
              <Card className="ad-raised min-h-[26rem] min-w-0 p-5 sm:p-6">
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

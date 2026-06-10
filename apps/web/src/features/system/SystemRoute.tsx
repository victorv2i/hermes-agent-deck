import { ServerCog } from 'lucide-react'
import type { HermesUpdateChannel } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/state'
import { toast } from '@/lib/toast'
import { SystemPage, type HermesUpdateActionState, type DoctorActionState } from './SystemPage'
import { useApplyHermesUpdate, useRestartGateway, useRunDoctor, useSystem } from './useSystem'

/**
 * Route element for the Maintenance dock (`/system`). Bridges the `useSystem`
 * query to the presentational {@link SystemPage} and owns the two REAL mutations
 * behind the dock's actions:
 *
 *  - Restart gateway → POST .../gateway/restart, then the dock read is invalidated
 *    so the GatewayCard re-resolves from a fresh probe. The card shows the calm
 *    reconnecting UX while the mutation is in flight (`status: 'restarting'`).
 *  - Apply Hermes update → POST .../hermes/update, surfacing the terminal result
 *    (scrubbed log + re-probed version) so the card shows the TRUTH and never a
 *    fake success. The dock read is invalidated on settle so availability/version
 *    re-resolve.
 *
 * Both report honestly via a toast on success/failure; no action ever fakes a
 * state — the enabled state of every button comes from the real `useSystem` read.
 */
export function SystemRoute() {
  const query = useSystem()
  const restart = useRestartGateway()
  const apply = useApplyHermesUpdate()
  const doctor = useRunDoctor()

  const onRestart = () => {
    restart.mutate(undefined, {
      onSuccess: (state) => {
        if (state.status === 'running') {
          toast.success('Gateway restarted', { description: 'Your agent is back online.' })
        } else {
          toast.warning('Gateway restarted', {
            description: `It is reporting "${state.status}". Check the System surface.`,
          })
        }
      },
      onError: (err) => toast.error("Couldn't restart your agent", { description: err.message }),
    })
  }

  const onApply = (channel: HermesUpdateChannel) => {
    apply.mutate(channel, {
      onSuccess: (result) => {
        if (result.status === 'up-to-date') {
          toast.success('Hermes updated', {
            description: result.currentVersion
              ? `Now on v${result.currentVersion.replace(/^v/, '')}.`
              : 'The update finished.',
          })
        } else {
          toast.error("The update didn't finish", {
            description: 'See the log on the System surface for details.',
          })
        }
      },
      onError: (err) => toast.error("Couldn't update Hermes", { description: err.message }),
    })
  }

  const onRunDoctor = () => {
    doctor.mutate(undefined, {
      onSuccess: (report) => {
        if (report.status === 'unavailable') {
          toast.warning('Health check unavailable', {
            description: "`hermes doctor` couldn't run on this machine.",
          })
        } else if (report.status === 'ok') {
          toast.success('Hermes is healthy', { description: 'All checks passed.' })
        } else {
          const { warning, error } = report.counts
          toast.warning('Health check finished', {
            description: `${error} issue${error === 1 ? '' : 's'}, ${warning} warning${warning === 1 ? '' : 's'}. See the breakdown below.`,
          })
        }
      },
      onError: (err) => toast.error("Couldn't run the health check", { description: err.message }),
    })
  }

  const hermesUpdate: HermesUpdateActionState = {
    status: apply.isPending ? 'applying' : 'idle',
    onApply,
    result: apply.data,
    error: apply.error?.message,
  }

  const doctorAction: DoctorActionState = {
    status: doctor.isPending ? 'running' : 'idle',
    onRun: onRunDoctor,
    result: doctor.data,
    error: doctor.error?.message,
  }

  if (query.status === 'pending') {
    return (
      <div className="mx-auto flex w-full max-w-[860px] flex-col px-6 py-8">
        <PageHeader
          icon={ServerCog}
          title="System"
          subtitle="Keep your agent's home tended: restart your agent, update Hermes, and check its health."
        />
        <div className="flex flex-col gap-6" aria-hidden data-testid="system-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="ad-surface h-28 animate-pulse rounded-xl bg-card motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    )
  }

  if (query.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[860px] flex-col px-6 py-8">
        <PageHeader icon={ServerCog} title="System" />
        <ErrorState
          icon={ServerCog}
          title="Couldn't load system status"
          description="The maintenance checks couldn't reach Hermes. This doesn't affect chatting."
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  return (
    <SystemPage
      system={query.data}
      gateway={{ status: restart.isPending ? 'restarting' : 'idle', onRestart }}
      hermesUpdate={hermesUpdate}
      doctor={doctorAction}
    />
  )
}

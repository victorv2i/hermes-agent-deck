import { MessagesSquare } from 'lucide-react'
import type { SetMessagingTokenRequest } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/state'
import { toast } from '@/lib/toast'
import { useRestartGateway } from '@/features/system/useSystem'
import { MessagingPage } from './MessagingPage'
import { useMessaging, useRefreshMessaging, useSetMessagingToken } from './useMessaging'

/**
 * Route element for the Messaging surface (`/messaging`). Bridges the
 * `useMessaging` read to the presentational {@link MessagingPage} and owns the
 * two honest mutations:
 *
 *  - Save token → POST .../messaging/token (shape-only response), then the
 *    messaging read is invalidated so the card re-resolves its `isSet` /
 *    `redactedValue`. The toast states the truth: stored, restart to apply.
 *  - Restart to apply → REUSES the Maintenance dock's `useRestartGateway` (the
 *    one real restart mutation — never reimplemented here), then RE-POLLS
 *    messaging so the gateway's fresh per-platform state flips the badges.
 *
 * No action fakes a state: connection truth always comes from the next read.
 */
export function MessagingRoute() {
  const query = useMessaging()
  const setToken = useSetMessagingToken()
  const restart = useRestartGateway()
  const refreshMessaging = useRefreshMessaging()

  const onSetToken = (request: SetMessagingTokenRequest) => {
    setToken.mutate(request, {
      onSuccess: () =>
        toast.success('Token stored', {
          description: 'Restart your agent to apply it.',
        }),
      onError: (err) =>
        toast.error('Couldn’t store the token', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  const onRestart = () => {
    restart.mutate(undefined, {
      onSuccess: (state) => {
        // Re-poll messaging so the gateway's fresh per-platform state shows.
        refreshMessaging()
        if (state.status === 'running') {
          toast.success('Gateway restarted', {
            description: 'Connection status will update in a moment.',
          })
        } else {
          toast.warning('Gateway restarted', {
            description: `It is reporting "${state.status}". Check the System surface.`,
          })
        }
      },
      onError: (err) =>
        toast.error('Couldn’t restart your agent', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  if (query.status === 'pending') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader
          icon={MessagesSquare}
          title="Messaging"
          subtitle="Give your agent a presence where you already are."
        />
        <div className="flex flex-col gap-4" aria-hidden data-testid="messaging-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ad-surface h-40 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </div>
    )
  }

  if (query.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader icon={MessagesSquare} title="Messaging" />
        <ErrorState
          icon={MessagesSquare}
          title="Couldn’t load messaging status"
          description="Agentdeck couldn’t reach Hermes to read your platforms. This doesn’t affect chatting."
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  return (
    <MessagingPage
      state={query.data}
      onSetToken={onSetToken}
      onRestart={onRestart}
      restarting={restart.isPending}
    />
  )
}

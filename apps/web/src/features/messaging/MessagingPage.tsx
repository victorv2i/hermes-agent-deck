import { Loader2, MessagesSquare, RefreshCw } from 'lucide-react'
import type { MessagingState, SetMessagingTokenRequest } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/state'
import { PlatformTile } from './PlatformTile'
import { DmAuthPanel } from './DmAuthPanel'

/**
 * MessagingPage — the Messaging pairing hub, data-driven from the registry the BFF
 * returns. The redesign is COMPACT: a responsive GRID of {@link PlatformTile}s
 * (each showing its real per-platform status AT A GLANCE) that EXPAND on click to
 * reveal the setup steps + paste-token field, so the page fits ~one screen and the
 * user only opens what they configure. The single {@link DmAuthPanel} follows.
 *
 * The page is purely presentational (props in / callbacks out) so the route owns
 * the read + the two mutations and every state is exercisable without a query
 * client.
 *
 * "Your agent lives where you do" — give it a presence on the platforms you
 * already use. Every status here is the gateway's real per-platform truth.
 */

export interface MessagingPageProps {
  state: MessagingState
  /** Store/replace a credential (the route owns the real mutation). */
  onSetToken: (request: SetMessagingTokenRequest) => void
  /** Restart the gateway to apply stored tokens (the shared Maintenance restart). */
  onRestart: () => void
  /** Whether a gateway restart is currently in flight. */
  restarting: boolean
}

export function MessagingPage({ state, onSetToken, onRestart, restarting }: MessagingPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={MessagesSquare}
        title="Messaging"
        subtitle="Connect the places your agent can reply from. Open a platform, paste the bot token you created there, then restart to apply."
      />
      {state.platforms.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No messaging platforms available"
          description="Hermes didn’t report any messaging platforms to configure on this install."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {!state.gatewayRunning ? (
            <div
              role="status"
              className="ad-surface flex flex-col gap-3 rounded-xl bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-13 leading-relaxed text-muted-foreground">
                Your agent is stopped, so platform statuses are paused until it starts again.
              </p>
              <Button variant="outline" size="sm" disabled={restarting} onClick={onRestart}>
                {restarting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Restarting…
                  </>
                ) : (
                  <>
                    <RefreshCw aria-hidden />
                    Restart your agent
                  </>
                )}
              </Button>
            </div>
          ) : null}
          {/* items-start: each tile keeps its natural height. Without it the grid
              stretches a collapsed tile to match an expanded row-sibling, so opening
              one platform inflates the empty neighbor into a phantom "open" box. */}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            {state.platforms.map((platform) => (
              <PlatformTile
                key={platform.platform.id}
                platform={platform}
                gatewayRunning={state.gatewayRunning}
                onSetToken={onSetToken}
                onRestart={onRestart}
                restarting={restarting}
              />
            ))}
          </div>
          <DmAuthPanel />
        </div>
      )}
    </div>
  )
}

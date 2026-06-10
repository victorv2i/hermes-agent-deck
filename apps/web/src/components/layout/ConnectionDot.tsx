import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'

export type ConnectionStatus = 'online' | 'connecting' | 'offline'

const LABEL: Record<ConnectionStatus, string> = {
  online: 'Connected',
  connecting: 'Connecting…',
  offline: 'Offline',
}

/**
 * The gateway/socket connection indicator in the chrome header. A *connection*
 * being online is a SEMANTIC STATUS (success), NOT the live-stream accent — so it
 * reads green here and everywhere via the shared {@link StatusDot}. (A live data
 * stream — e.g. Kanban's board socket — is the separate sanctioned accent pulse.)
 * connecting → info + pulse (in-progress); offline → error.
 */
const TONE: Record<ConnectionStatus, { tone: StatusTone; pulse: boolean }> = {
  online: { tone: 'ok', pulse: false },
  connecting: { tone: 'info', pulse: true },
  offline: { tone: 'error', pulse: false },
}

export function ConnectionDot({
  status,
  className,
}: {
  status: ConnectionStatus
  className?: string
}) {
  const { tone, pulse } = TONE[status]
  return (
    <StatusDot
      tone={tone}
      label={LABEL[status]}
      pulse={pulse}
      className={className}
      role="status"
      data-testid="connection-dot"
      data-status={status}
    />
  )
}

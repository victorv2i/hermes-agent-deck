import type { TerminalStatus } from './terminalSocket'

/**
 * The live socket/shell status presentation, shared by the route (which mounts
 * it in the single SurfaceHeader actions slot — T1.8) and lifted out of
 * TerminalView so that component exports only components (fast-refresh).
 */

function statusLabel(status: TerminalStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…'
    case 'connected':
      return 'Connected'
    case 'exited':
      return 'Session ended'
    case 'error':
      return 'Unavailable'
    case 'disconnected':
      return 'Disconnected'
    case 'dropped':
      return 'Connection dropped'
  }
}

/**
 * The live socket/shell status — the semantic dot + label re-homed from the old
 * inner header bar into the route's single SurfaceHeader actions slot (T1.8).
 */
export function TerminalStatusIndicator({ status }: { status: TerminalStatus }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-foreground-tertiary">
      <StatusDot status={status} />
      {statusLabel(status)}
    </span>
  )
}

function StatusDot({ status }: { status: TerminalStatus }) {
  // Semantic status dots (color = meaning): live = success teal-green, error =
  // destructive, ended/disconnected = quiet tertiary. "Connecting" is a transient
  // state, so it pulses in `info` — the action accent stays reserved for primary/active only.
  const color =
    status === 'connected'
      ? 'bg-success'
      : status === 'error' || status === 'dropped'
        ? 'bg-destructive'
        : status === 'exited' || status === 'disconnected'
          ? 'bg-foreground-tertiary'
          : 'bg-info'
  return (
    <span
      aria-hidden
      className={`size-2 rounded-full ${color} ${status === 'connecting' ? 'motion-safe:animate-pulse' : ''}`}
    />
  )
}

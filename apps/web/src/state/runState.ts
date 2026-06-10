/**
 * Honest live run-state derivation — the #1 hermes-user frustration is an agent
 * that has gone quiet with no way to tell "still working", "waiting on the
 * model", "waiting on ME", or "probably stuck". This module turns the facts the
 * deck TRULY observes (run lifecycle events, the last substantive event time,
 * the last gateway keepalive, pending approvals, socket health) into one calm
 * bucket, with soft language wherever we infer rather than know.
 *
 * Honesty rules encoded here:
 *  - "Working" is claimed only off a RECENT real event (< {@link WORKING_RECENT_MS}).
 *  - "Thinking" is claimed only while SOMETHING still proves the stream alive
 *    (an event or a forwarded gateway keepalive within {@link STALL_SILENCE_MS}).
 *  - Past that window we do NOT claim a state hermes never signals (there is no
 *    "compacting"/"retrying" wire signal today) — we say, softly, that the agent
 *    MAY be stuck. The existing Stop control is the action.
 *  - No run → null (no chip, no idle theater).
 *
 * Pure + clock-injected so every transition (including the exact boundary
 * times) is unit-testable.
 */
import type { ConnectionStatus } from '@/lib/chatSocket'
import type { RunStatus } from './chatStore'

/** A real event this recent means the agent is demonstrably working. */
export const WORKING_RECENT_MS = 10_000

/** No event AND no heartbeat for this long: we can no longer claim liveness.
 * Generous on purpose — the gateway keepalives arrive ~every 30s on a healthy
 * stream, so a truly alive run practically never crosses this. */
export const STALL_SILENCE_MS = 120_000

export type LiveRunState =
  | 'working'
  | 'thinking'
  | 'waiting_approval'
  | 'maybe_stalled'
  | 'offline'
  | null

/** The observed facts the derivation consumes. All come straight from existing
 * state — nothing here is fabricated or polled into existence. */
export interface RunStateInputs {
  /** The reducer's run lifecycle ('idle' | 'running' | 'stopping'). */
  runStatus: RunStatus
  /** True while an approval.request is unanswered (the run is waiting on YOU). */
  hasPendingApproval: boolean
  /** Epoch ms of the last substantive server event, or null (see ChatState). */
  lastEventAt: number | null
  /** Epoch ms of the last forwarded gateway keepalive, or null. */
  lastHeartbeatAt: number | null
  /** The `/chat-run` socket lifecycle (header dot vocabulary). */
  connection: ConnectionStatus
  /** The evaluation clock (epoch ms). Injected so boundaries are testable. */
  now: number
}

/**
 * Derive the single honest run-state bucket. Precedence:
 *  1. no active run → null (the chip disappears; idle is not a status)
 *  2. socket terminally down → 'offline' (the stream cannot be observed at all)
 *  3. unanswered approval → 'waiting_approval' (waiting on the user beats all
 *     liveness math — the agent is intentionally paused)
 *  4. a real event within 10s → 'working'
 *  5. no event AND no heartbeat for 120s+ → 'maybe_stalled' (soft claim)
 *  6. otherwise → 'thinking' (events stale, but the stream is provably alive)
 */
export function deriveRunState(inputs: RunStateInputs): LiveRunState {
  const { runStatus, hasPendingApproval, lastEventAt, lastHeartbeatAt, connection, now } = inputs

  if (runStatus === 'idle') return null
  if (connection === 'disconnected') return 'offline'
  if (hasPendingApproval) return 'waiting_approval'

  if (lastEventAt !== null && now - lastEventAt < WORKING_RECENT_MS) return 'working'

  // The freshest proof of life we hold, from either signal.
  const lastSignalAt = Math.max(lastEventAt ?? 0, lastHeartbeatAt ?? 0)
  // A running status with NO recorded signal at all is a hydration edge (the
  // run.started that set 'running' also stamps lastEventAt). Soft language.
  if (lastSignalAt === 0) return 'thinking'

  if (now - lastSignalAt >= STALL_SILENCE_MS) return 'maybe_stalled'
  return 'thinking'
}

/** The freshest signal timestamp (event or heartbeat), or null when neither has
 * been observed. Drives the chip tooltip's honest "last signal Xs ago". */
export function lastSignalAt(
  inputs: Pick<RunStateInputs, 'lastEventAt' | 'lastHeartbeatAt'>,
): number | null {
  const at = Math.max(inputs.lastEventAt ?? 0, inputs.lastHeartbeatAt ?? 0)
  return at === 0 ? null : at
}

/** A short, honest "Xs ago" / "Xm ago" for the chip tooltip. Null-safe: no
 * observed signal → null, never a fabricated time. */
export function formatSince(signalAt: number | null, now: number): string | null {
  if (signalAt === null) return null
  const s = Math.max(0, Math.floor((now - signalAt) / 1000))
  if (s < 90) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

/** The chip's SHORT label per bucket (the full honest sentence lives in
 * {@link RUN_STATE_DETAIL} and rides the tooltip + accessible description). */
export const RUN_STATE_LABEL: Record<Exclude<LiveRunState, null>, string> = {
  working: 'Working',
  thinking: 'Still thinking',
  waiting_approval: 'Waiting for your OK',
  maybe_stalled: 'May be stuck',
  offline: 'Offline',
}

/** The honest plain-language detail per bucket. Soft language for inference;
 * never a state hermes does not signal. The offline line matches the existing
 * connection-lost copy so the two surfaces never disagree. */
export const RUN_STATE_DETAIL: Record<Exclude<LiveRunState, null>, string> = {
  working: 'Your agent is actively responding.',
  thinking: 'Still thinking. Waiting on the model.',
  waiting_approval: 'Waiting for your OK',
  maybe_stalled: 'No signal from your agent for a while. It may be stuck.',
  offline: 'The link to the agent dropped. Reload to reconnect.',
}

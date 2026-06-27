/**
 * Composer message queue — send-while-busy.
 *
 * A thin LAYER over the run pump ({@link useChatRun}) that lets a user compose and
 * "send" while a run is still in flight: the message is held in a FIFO queue and
 * auto-fired — ONE AT A TIME — when the active run completes. It never touches the
 * pump internals; it only observes the `running` boolean the host already derives
 * from `runStatus`, and fires the existing `send()` for the next queued message.
 *
 * Two parts:
 *   - a tiny PURE core ({@link enqueue}/{@link cancel}/{@link takeNext}) carrying
 *     the FIFO invariants, trivially unit-testable without React; and
 *   - {@link useMessageQueue}, the hook that holds the queue state and flushes the
 *     head on each run-completion edge (running → false), exactly once per run.
 *
 * Honest UI: a queued message is clearly pending (the composer shows it as a
 * "Queued" pill) and cancel really removes it from the queue before it can send.
 * LOCAL-ONLY: the queue lives entirely in the browser tab.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** One pending message awaiting flush. The id is stable for the item's lifetime so
 * the UI can render a keyed pill and cancel by id. */
export interface QueuedMessage {
  id: string
  /** The raw composer text. Trimming/validation is the send path's job (so a
   * flushed send is byte-identical to a live one), but blank text never enters. */
  text: string
}

/** Monotonic id source — sufficient for in-tab, never-persisted queue items. */
let nextId = 0
function makeId(): string {
  nextId += 1
  return `q${nextId}`
}

/**
 * Append `text` to the queue tail (FIFO). Blank / whitespace-only text is ignored
 * (there is nothing honest to queue), so the queue never holds an empty pill.
 * Returns a NEW array (the prior queue is untouched) so callers stay referentially
 * honest with React state.
 */
export function enqueue(queue: QueuedMessage[], text: string): QueuedMessage[] {
  if (text.trim().length === 0) return queue
  return [...queue, { id: makeId(), text }]
}

/** Remove the message with `id`, preserving order. A no-op for an unknown id
 * (returns the same array reference, so an idempotent cancel doesn't churn state). */
export function cancel(queue: QueuedMessage[], id: string): QueuedMessage[] {
  if (!queue.some((m) => m.id === id)) return queue
  return queue.filter((m) => m.id !== id)
}

/** Pop the head (FIFO): the next message to flush plus the remaining tail. On an
 * empty queue `next` is null and `rest` is empty. */
export function takeNext(queue: QueuedMessage[]): {
  next: QueuedMessage | null
  rest: QueuedMessage[]
} {
  if (queue.length === 0) return { next: null, rest: [] }
  const [next, ...rest] = queue
  return { next: next ?? null, rest }
}

export interface UseMessageQueue {
  /** The pending messages, head-first, for rendering the "Queued" pills. */
  queue: QueuedMessage[]
  /** Queue a message for send-when-idle. Blank text is ignored. */
  enqueue: (text: string) => void
  /** Drop a queued message by id before it sends (the pill's × control). */
  cancel: (id: string) => void
}

/**
 * Hold a FIFO queue of messages and auto-flush the head whenever the active run
 * completes — but ONLY when it is honest to do so. `running` is the host's
 * existing run-in-flight signal (derived from `runStatus`); `send` is the host's
 * existing send. We flush AT MOST ONE message per completion edge: flushing the
 * head starts a fresh run, so the host flips `running` back to true and the next
 * head waits for the next completion — plain FIFO, one at a time, no priorities
 * or reordering.
 *
 * `canFlush` gates that auto-flush: it must be false when the connection is down
 * OR the last run ended in error/cancellation, because flushing then would fire
 * the queued message into a dead or just-failed channel (a silent drop, or an
 * unwanted resend after the user already saw the run fail). When `canFlush` is
 * false the head stays queued; the flush fires later — when the run completes
 * cleanly AND the channel is healthy again (a `canFlush` rising edge while idle
 * drains the head too). Defaults to true so a host that always-flushes (and the
 * pure FIFO tests) keep the prior behavior.
 */
export function useMessageQueue({
  running,
  send,
  canFlush = true,
  conversationId,
}: {
  running: boolean
  send: (text: string) => void
  /** False while the connection is down or the last run ended in error/cancel —
   * gates the auto-flush so a queued message never fires into a dead/just-failed
   * channel. Defaults to true (always-flush). */
  canFlush?: boolean
  /** The active conversation id (the composer's sessionKey). When it changes away
   * from a non-null value (New chat / switching sessions) the queue is abandoned,
   * so a message queued in one conversation can never flush into another. The
   * null -> id assignment a fresh chat gets on its first run.started is not a
   * leave (the prior id was null), so a message queued in a new chat still flushes
   * into that same chat. */
  conversationId?: string | null
}): UseMessageQueue {
  const [queue, setQueue] = useState<QueuedMessage[]>([])

  // Hold the latest send in a ref so the flush effect can fire it without listing
  // (and thus re-running on) the host's churning send identity. The ref is written
  // in an effect (never during render) per the refs hygiene rule.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  // "Armed" gates a single flush per idle window. It re-arms whenever a run is in
  // flight (running === true) and disarms on each flush, so a run-completion edge
  // (or an enqueue-while-idle) fires exactly one send — never a cascade that would
  // drain the whole queue at once.
  const armedRef = useRef(true)

  // The conversation the queued messages belong to. When it changes away from an
  // established (non-null) id, the queue is abandoned in the flush effect.
  const convRef = useRef(conversationId)

  const enqueueMessage = useCallback((text: string) => {
    setQueue((q) => enqueue(q, text))
  }, [])

  const cancelMessage = useCallback((id: string) => {
    setQueue((q) => cancel(q, id))
  }, [])

  useEffect(() => {
    // The conversation changed. If we LEFT an established (non-null) conversation
    // (New chat, or switching to another session) abandon any messages queued in
    // it: the single app-lifetime composer would otherwise flush them into the
    // conversation now on screen. The null -> id assignment a fresh chat receives
    // on its first run.started is NOT a leave (the prior id was null), so a message
    // queued in a new chat still flushes into that same chat.
    if (convRef.current !== conversationId) {
      const leftEstablished = convRef.current != null
      convRef.current = conversationId
      if (leftEstablished) {
        armedRef.current = true
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setQueue((q) => (q.length === 0 ? q : []))
        return
      }
    }
    if (running) {
      // A run is in flight: arm for the completion that follows and hold the queue.
      armedRef.current = true
      return
    }
    // Idle but the channel isn't healthy (disconnected, or the last run ended in
    // error/cancel): HOLD the head. We deliberately stay ARMED so a later
    // canFlush rising edge (reconnect, or a clean run that clears the error)
    // still flushes the same idle window — the message is kept, never dropped.
    if (!canFlush) return
    // Idle + healthy: flush the head exactly once, then wait for the next run to
    // re-arm us. We read the head from `queue` (the effect's own dep, always the
    // latest state), so no mirror ref is needed.
    if (!armedRef.current) return
    const { next, rest } = takeNext(queue)
    if (!next) return
    armedRef.current = false
    // Flushing is an event-like reaction to the run-completion edge (an external
    // signal), not derived state — so the setState here is intentional and gated by
    // `armed` to fire exactly once per completion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue(rest)
    sendRef.current(next.text)
    // Re-run on the running edge, the canFlush edge (a reconnect/clean-run drains a
    // held head), as the queue changes while idle (so a message queued during a
    // brief idle moment still flushes on the same idle window), and on a
    // conversation change (so a leave abandons the queue).
  }, [running, queue, canFlush, conversationId])

  return { queue, enqueue: enqueueMessage, cancel: cancelMessage }
}

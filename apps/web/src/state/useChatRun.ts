/**
 * Wires the {@link ChatSocket} (durable `/chat-run` transport) to the
 * {@link useChatStore} reducer and exposes the imperative actions the chat UI
 * calls: `send`, `stop`, `respondApproval`. The socket is created once and torn
 * down on unmount; every validated ChatServerEvent flows into the store via
 * `ingest`. Connection lifecycle is surfaced as a `ConnectionStatus` for the
 * header dot.
 *
 * The transport is injectable so component/integration tests can drive a fake
 * socket without a live BFF (hermetic).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApprovalChoice, RunAttachment } from '@agent-deck/protocol'
import {
  ChatSocket,
  readPersistedRun,
  type ConnectionStatus,
  type SocketLike,
  type StorageLike,
} from '@/lib/chatSocket'
import { toast } from '@/lib/toast'
import { useChatStore } from './useChatStore'
import { branchSendPolicy, type PendingApproval, type Turn } from './chatStore'

export interface UseChatRun {
  connection: ConnectionStatus
  /** Send a message. The optional `model` selects a per-run model (the composer
   * picker, T1.2); omitted uses the gateway's active model. The optional
   * `attachments` carry inline images for the turn (S5) — the BFF folds them
   * into the gateway's native multimodal input. */
  send: (text: string, model?: string, attachments?: RunAttachment[]) => void
  stop: () => void
  respondApproval: (choice: ApprovalChoice) => void
  /** Retry/Regenerate an assistant turn — drop it and re-run the prompting user
   * turn. The optional `model` re-runs with the currently-selected model. */
  retry: (assistantTurnId: string, model?: string) => void
  /** Edit-and-resend a user turn — replace its text, trim later turns, re-run. */
  editTurn: (userTurnId: string, newText: string, model?: string) => void
  newChat: () => void
  /**
   * Resume a prior hermes session ("Continue this session"): seed its transcript
   * into the store and remember its id so the next `send` forwards `session_id`,
   * landing the new turn in the SAME hermes session. The optional `identity`
   * (title · model) is carried into the live chat header so resuming doesn't drop
   * you into an identity-less chat.
   */
  continueSession: (
    sessionId: string,
    turns: Turn[],
    identity?: { title?: string | null; model?: string | null },
  ) => void
  /** The durable hermes session id of the CURRENT live conversation, once known:
   * captured from `run.started` for a fresh chat, or set by `continueSession` on
   * resume. Null for a brand-new, not-yet-sent chat. The chat route reflects this
   * into the URL (`/chat/:id`) so a browser refresh can rehydrate the transcript. */
  activeSessionId: string | null
  /** True when THIS mount adopted a persisted in-flight run to resume (a page
   * reload landed mid-stream). The chat route uses it to SKIP URL-history
   * rehydration for that conversation and let the run replay own the transcript,
   * so the two don't race and clobber the live turns. */
  resumingInFlightRun: boolean
}

export function useChatRun(socket?: SocketLike, storage?: StorageLike | null): UseChatRun {
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  // The durable hermes session id of the live conversation, surfaced reactively
  // (the ref below is the synchronous read for the send path; this state drives
  // the chat route → URL). Kept in lockstep with `activeSessionIdRef`.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // Computed ONCE at first render (a lazy initializer, before any effect runs, so
  // it's ready when the chat route's seed effect first fires): did sessionStorage
  // hold a persisted in-flight run at page load? If so, this mount is a reload
  // that landed mid-stream and the run replay — not history rehydration — owns the
  // transcript. Mirrors how ChatSocket resolves its storage (undefined → window).
  const [resumingInFlightRun] = useState<boolean>(() => {
    const s =
      storage === undefined
        ? typeof window !== 'undefined'
          ? window.sessionStorage
          : null
        : storage
    return s ? readPersistedRun(s) !== null : false
  })
  const clientRef = useRef<ChatSocket | null>(null)
  // The hermes session the next send should resume into, if any. A ref (not
  // state) so updating it never re-creates the memoized action handles.
  const activeSessionIdRef = useRef<string | null>(null)
  // The approval we OPTIMISTICALLY cleared on the last `respondApproval`, kept so
  // a gateway-side `approval.respond` rejection can re-surface it (A4). Cleared
  // once the gateway acknowledges (`approval.responded`) so a later stray error
  // never resurrects a stale gate.
  const lastClearedApprovalRef = useRef<PendingApproval | null>(null)

  // Stable store-action handles (Zustand actions are referentially stable).
  const ingest = useChatStore((s) => s.ingest)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const beginAssistantTurn = useChatStore((s) => s.beginAssistantTurn)
  const clearPendingApproval = useChatStore((s) => s.clearPendingApproval)
  const retryTurn = useChatStore((s) => s.retry)
  const editAndResend = useChatStore((s) => s.editAndResend)
  const seedTurns = useChatStore((s) => s.seedTurns)
  const setError = useChatStore((s) => s.setError)
  const reset = useChatStore((s) => s.reset)

  useEffect(() => {
    // On mount the ChatSocket adopts any persisted in-flight run from
    // sessionStorage; calling connect() then auto-emits resume({ run_id,
    // after_cursor }) so a run survives a full page reload.
    const options: { socket?: SocketLike; storage?: StorageLike | null } = {}
    if (socket) options.socket = socket
    if (storage !== undefined) options.storage = storage
    const client = new ChatSocket(
      {
        onEvent: (event) => {
          // A4: once the gateway acknowledges the response, forget the optimistic
          // snapshot so a later stray `command.error` can't resurrect a stale
          // gate. (The reducer clears `pendingApproval` on this frame.)
          if (event.event === 'approval.responded') lastClearedApprovalRef.current = null
          // Capture the durable hermes session id the BFF stamped on run.started.
          // A fresh chat starts session-less; learning its id here lets the next
          // send continue the SAME session, and lets the chat route carry it in
          // the URL so a browser refresh can rehydrate the transcript.
          if (
            event.event === 'run.started' &&
            event.session_id &&
            activeSessionIdRef.current !== event.session_id
          ) {
            activeSessionIdRef.current = event.session_id
            setActiveSessionId(event.session_id)
          }
          ingest(event)
        },
        onStatusChange: (status) => setConnection(status),
        onConnectionError: () => {
          // A genuinely terminal disconnect (server-forced close, or socket.io
          // exhausted its reconnect attempts) — distinct from a transient drop,
          // which stays a calm 'reconnecting' status and never lands here. Tell
          // the user the link is down and won't self-heal by waiting. (The
          // 'disconnected' status already disables the composer.)
          toast.error('Connection lost', {
            description: 'The link to the agent dropped. Reload to reconnect.',
          })
        },
        onCommandError: (err) => {
          // A4: a rejected `approval.respond` is a DIFFERENT failure than a
          // rejected run. The run is still blocked gateway-side and we already
          // optimistically cleared the gate, so re-surface that exact approval
          // (don't slam the run to idle / raise the generic banner, which would
          // clear the gate again) and toast a targeted retry hint.
          if (err.command === 'approval.respond' && lastClearedApprovalRef.current) {
            const restored = lastClearedApprovalRef.current
            lastClearedApprovalRef.current = null
            useChatStore.setState({ pendingApproval: restored })
            const detail = err.message?.trim()
            toast.error('Approval didn’t go through. Try again.', {
              ...(detail ? { description: detail } : {}),
            })
            return
          }
          // I2: a BFF-side command rejection (e.g. the gateway is down so a `run`
          // can't start) must surface a visible error and drop us back to idle —
          // never a silent dead-end where the composer still looks "running".
          const detail = err.message?.trim()
          setError(
            detail
              ? `Couldn’t reach the agent: ${detail}`
              : 'Couldn’t reach the agent. Check that the gateway is running and try again.',
          )
        },
      },
      options,
    )
    clientRef.current = client
    client.connect()
    return () => {
      client.dispose()
      clientRef.current = null
    }
    // The socket + store actions are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return useMemo<UseChatRun>(() => {
    // Issue a run for an already-trimmed/appended conversation: open the
    // optimistic streaming turn (so the caret shows before the first token) and
    // emit the run command, carrying the resumed session and the chosen model
    // when present. Shared by send / retry / editTurn so re-runs behave exactly
    // like a fresh send.
    const issueRun = (input: string, model?: string, attachments?: RunAttachment[]) => {
      beginAssistantTurn()
      // Branch send policy (Lane D) gates whether the existing Hermes session_id
      // may ride this run. A fork from a HISTORICAL message (unsupported-context)
      // or a fresh local fork (new-session) must NOT reuse the resumed session id —
      // stock Hermes would append to the linear head and corrupt the session. Only
      // a same-session policy (no fork, or a fork at the live head) keeps it.
      const policy = branchSendPolicy(useChatStore.getState())
      const sessionId = policy.kind === 'same-session' ? activeSessionIdRef.current : null
      clientRef.current?.run({
        input,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(model ? { model } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      })
    }
    return {
      connection,
      send: (text: string, model?: string, attachments?: RunAttachment[]) => {
        const trimmed = text.trim()
        const hasImages = !!attachments && attachments.length > 0
        // An image-only turn (no prose) is still a valid send — the gateway
        // accepts a multimodal turn whose visible payload is just the image.
        if (!trimmed && !hasImages) return
        // Optimistic transcript turn carrying the prose AND the sent image(s), so
        // the image stays visible in the bubble after send (an image-only turn
        // renders just the image — no text label). The gateway run below carries
        // the same attachments plus the real (possibly empty) prose text.
        addUserMessage(trimmed, attachments)
        issueRun(trimmed, model, attachments)
      },
      stop: () => {
        const runId = clientRef.current?.runId
        if (runId) clientRef.current?.abort({ run_id: runId })
      },
      respondApproval: (choice: ApprovalChoice) => {
        const runId = clientRef.current?.runId
        const pending = useChatStore.getState().pendingApproval
        const targetRunId = pending?.run_id ?? runId
        if (!targetRunId) return
        // Snapshot the gate before clearing so a gateway-side rejection
        // (`command.error`) can re-surface this exact approval (A4).
        lastClearedApprovalRef.current = pending
        // Optimistically clear so a second click can't re-submit while the
        // gateway round-trips (the approval.responded frame would clear it too).
        clearPendingApproval()
        clientRef.current?.respondApproval({
          run_id: targetRunId,
          approval_id: pending?.approval_id,
          choice,
        })
      },
      retry: (assistantTurnId: string, model?: string) => {
        // The store trims back to (and keeps) the prompting user turn and hands
        // back its text; we then re-issue the run just like a fresh send.
        const input = retryTurn(assistantTurnId)
        if (input === null) return
        issueRun(input, model)
      },
      editTurn: (userTurnId: string, newText: string, model?: string) => {
        const input = editAndResend(userTurnId, newText)
        if (input === null) return
        issueRun(input, model)
      },
      newChat: () => {
        // A fresh chat abandons any resumed session.
        activeSessionIdRef.current = null
        setActiveSessionId(null)
        reset()
      },
      continueSession: (sessionId, turns, identity) => {
        activeSessionIdRef.current = sessionId
        setActiveSessionId(sessionId)
        // Carry the session id onto the seeded branch so the fork send policy can
        // tell a head-fork (keeps the session) from a historical fork (new chat).
        seedTurns(turns, { ...identity, hermesSessionId: sessionId })
      },
      activeSessionId,
      resumingInFlightRun,
    }
  }, [
    connection,
    activeSessionId,
    resumingInFlightRun,
    addUserMessage,
    beginAssistantTurn,
    clearPendingApproval,
    retryTurn,
    editAndResend,
    seedTurns,
    reset,
  ])
}

/** Map the socket connection status to the header dot's vocabulary. A transient
 * `'reconnecting'` reads as the calm pulsing `'connecting'` dot (not offline) —
 * the link is expected to recover and the replay-tail will resume. */
export function toDotStatus(status: ConnectionStatus): 'online' | 'connecting' | 'offline' {
  if (status === 'connected') return 'online'
  if (status === 'connecting' || status === 'reconnecting') return 'connecting'
  return 'offline'
}

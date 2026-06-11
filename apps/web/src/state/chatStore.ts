/**
 * Chat store — the single source of truth for the conversation UI.
 *
 * Shape: an ordered list of `turns` (user + assistant). The active assistant
 * turn accumulates `streaming` text, `toolCalls`, and `reasoning` blocks as
 * ChatServerEvents arrive. Approvals, run status, the active run id, and the
 * last replay cursor live at the top level.
 *
 * The reducer ({@link applyEvent}) is a PURE function keyed by `event`. It is
 * unit-tested against canned event sequences. The Zustand store ({@link
 * useChatStore}) is a thin wrapper that runs the reducer and swaps state.
 *
 * Durable replay-tail de-dup: every buffered event carries a monotonic BFF
 * `cursor`. The reducer drops any event whose cursor is <= `lastCursor`, so a
 * post-reconnect `resume` replay that re-sends already-seen frames is idempotent
 * and never duplicates text, tool cards, or reasoning. Transient frames without
 * a cursor (e.g. `run.stopping`) are always applied but never move `lastCursor`.
 */
import type {
  ChatServerEvent,
  ApprovalChoice,
  TokenUsage,
  RunAttachment,
  ConversationHistoryMessage,
} from '@agent-deck/protocol'
import {
  CONVERSATION_HISTORY_MAX_MESSAGES,
  CONVERSATION_HISTORY_MAX_CHARS,
} from '@agent-deck/protocol'
import { sanitizeSessionPreview } from '../features/sessions/sessionPreview'

export type RunStatus = 'idle' | 'running' | 'stopping'

export interface ToolCall {
  /** Stable key for upsert: the tool name (one active call per tool at a time
   * on this transport). */
  tool: string
  status: 'running' | 'completed' | 'failed'
  preview?: string | null
  /** Seconds, from the gateway's tool.completed frame. */
  duration?: number
  error?: boolean
  errorMessage?: string
  /** Epoch ms the call finished — the gateway's tool.completed/tool.failed
   * `timestamp` (seconds) scaled to ms. Drives the card's relative timestamp.
   * Optional — omitted when the frame carried no timestamp so we never fabricate. */
  completedAt?: number
}

export interface PendingApproval {
  run_id: string
  approval_id?: string
  command: string
  description: string
  pattern_key?: string
  pattern_keys?: string[]
  choices: ApprovalChoice[]
}

export interface UserTurn {
  id: string
  role: 'user'
  content: string
  /** Epoch ms the turn was created (live) or its persisted timestamp (history).
   * Drives the hover timestamp (T3.5). Optional — omitted when unknown so we
   * never show a fabricated time. */
  createdAt?: number
  /** Image attachments the user sent on this turn (paste/attach/drag-drop), so
   * the sent image stays visible in the transcript. Omitted when there are none.
   * Live sends carry them through {@link appendUserTurn}; history seeding has no
   * inline image data, so resumed turns simply omit it. */
  attachments?: RunAttachment[]
}

export interface AssistantTurn {
  id: string
  role: 'assistant'
  /** The turn's text — appended to live while streaming, then finalized. */
  content: string
  toolCalls: ToolCall[]
  reasoning: string[]
  /** True until a terminal event finalizes this turn. */
  streaming: boolean
  usage?: TokenUsage
  /** Epoch ms the turn was created (live) or its persisted timestamp (history).
   * See {@link UserTurn.createdAt}. */
  createdAt?: number
}

export type Turn = UserTurn | AssistantTurn

/** Where a node's turn came from — drives honest branch-send policy. `live` is a
 * turn produced in THIS session; `history` is a turn seeded from a Hermes
 * transcript (a resumed/historical message). */
export type NodeSource = 'live' | 'history'

/**
 * One node in the conversation DAG (Lane D). A node wraps a rendered {@link Turn}
 * and records its parent pointer + owning branch. The render path is unchanged —
 * the UI still consumes {@link Turn `Turn[]`} via {@link activeTurns} — so nodes
 * are an additive graph layer, not a new render shape.
 */
export interface ConversationNode {
  id: string
  turn: Turn
  parentId: string | null
  childIds: string[]
  branchId: string
  source: NodeSource
}

/**
 * A local conversation branch. `localOnly` means Agent Deck owns this branch as
 * local metadata only — there is no Hermes-persisted DAG. `hermesSessionId` is
 * carried ONLY when the branch may legitimately continue an existing Hermes
 * session (a fork at the live head); a fork from a historical message clears it
 * so the next send never silently rewinds a linear Hermes session.
 */
export interface ConversationBranch {
  id: string
  rootNodeId: string | null
  headNodeId: string | null
  /** The projected turns for this branch (root path → head). The ACTIVE branch's
   * turns are mirrored into `state.turns`; inactive branches retain theirs here so
   * forking is non-destructive and switching back restores the full path. */
  turns: Turn[]
  label?: string
  localOnly: boolean
  hermesSessionId?: string | null
}

export interface ChatState {
  turns: Turn[]
  pendingApproval: PendingApproval | null
  runStatus: RunStatus
  error: string | null
  runId: string | null
  /** Highest BFF cursor applied so far; the resume anchor. */
  lastCursor: number
  /** The resumed session's title, carried into the live chat header so a
   * "Continue" doesn't drop identity into an empty header. Null = a new chat. */
  sessionTitle: string | null
  /** The resumed session's model id, shown in the live chat header. Null = use
   * the currently-active model. */
  sessionModel: string | null
  /**
   * Epoch ms the last SUBSTANTIVE server event was applied (run lifecycle,
   * deltas, tools, approvals — anything except a heartbeat). Null until the
   * first event. Feeds the honest run-state derivation (`deriveRunState`):
   * "an event arrived recently" is the only basis for claiming "working".
   */
  lastEventAt: number | null
  /**
   * Epoch ms the last `run.heartbeat` arrived — the gateway's SSE keepalive
   * forwarded by the BFF. Null until one arrives. A fresh heartbeat with stale
   * events means "the stream is alive, the model is just quiet" (thinking);
   * neither for a long time means we honestly cannot claim liveness.
   */
  lastHeartbeatAt: number | null
  /**
   * The conversation DAG (Lane D). UNDEFINED for a plain linear chat — the graph
   * is materialized lazily on the first fork, so an un-forked conversation is
   * byte-identical to before. When present, `branches[activeBranchId].turns`
   * equals `state.turns`.
   */
  nodes?: Record<string, ConversationNode>
  branches?: Record<string, ConversationBranch>
  activeBranchId?: string | null
}

export const initialChatState: ChatState = {
  turns: [],
  pendingApproval: null,
  runStatus: 'idle',
  error: null,
  runId: null,
  lastCursor: 0,
  sessionTitle: null,
  sessionModel: null,
  lastEventAt: null,
  lastHeartbeatAt: null,
}

let optimisticSeq = 0

/** Append the user's turn optimistically (before the run.started round-trips).
 * Used by the socket client when the user hits send. Pure. */
export function appendUserTurn(
  state: ChatState,
  content: string,
  attachments?: RunAttachment[],
): ChatState {
  const turn: UserTurn = {
    id: `u-${Date.now()}-${optimisticSeq++}`,
    role: 'user',
    content,
    createdAt: Date.now(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  }
  return { ...state, turns: [...state.turns, turn] }
}

/**
 * Optimistically open a streaming assistant turn the instant the user sends —
 * before `run.started`/`message.started` round-trips — so the conversation shows
 * the pulsing "working" indicator (the `.ad-dots` → `.ad-caret`) immediately
 * instead of a void. Pure.
 *
 * Idempotent against the live stream: the placeholder is `streaming: true` with
 * empty content, so the reducer's {@link ensureAssistantTurn} (used by every
 * incoming frame) REUSES it rather than appending a second turn — the first real
 * token simply lands in this turn. If an active streaming assistant turn already
 * exists (e.g. a still-running prior run), this is a no-op.
 */
export function beginAssistantTurn(state: ChatState): ChatState {
  if (activeAssistantIndex(state.turns) !== -1) return state
  const turn: AssistantTurn = {
    id: `a-pending-${Date.now()}-${optimisticSeq++}`,
    role: 'assistant',
    content: '',
    toolCalls: [],
    reasoning: [],
    streaming: true,
    createdAt: Date.now(),
  }
  return { ...state, turns: [...state.turns, turn] }
}

/**
 * Result of preparing a message-action re-run: the trimmed state to commit and
 * the input the caller should re-issue as a fresh run. `null` when the
 * action can't apply (e.g. retrying an assistant turn with no preceding user
 * turn, or an unknown turn id).
 */
export interface RerunPlan {
  state: ChatState
  input: string
  /** The re-run user turn's image attachments, when it had any — threaded back
   * through the run so a Retry/Edit resends the images instead of silently
   * re-asking with text only. */
  attachments?: RunAttachment[]
}

/**
 * Reset the run-lifecycle fields without touching `turns`. Shared by the
 * message-action helpers: after trimming the conversation, the next send must
 * start a fresh run (no stale runId/approval/cursor), but unlike {@link
 * seedTurns} we keep the (already-trimmed) turns in place. */
function resetRunLifecycle(turns: Turn[], state: ChatState): ChatState {
  return {
    ...initialChatState,
    turns,
    // Preserve the resumed session's identity — a retry/edit stays in the same
    // session and header.
    sessionTitle: state.sessionTitle,
    sessionModel: state.sessionModel,
  }
}

/**
 * Plan a Retry/Regenerate of an assistant turn: drop that assistant turn (and
 * everything after it) and re-run the user turn that prompted it. Pure — returns
 * the trimmed state plus the user input to re-issue, or `null` when there's no
 * preceding user turn to re-run.
 */
export function prepareRetry(state: ChatState, assistantTurnId: string): RerunPlan | null {
  const idx = state.turns.findIndex((t) => t.id === assistantTurnId && t.role === 'assistant')
  if (idx === -1) return null
  // Walk back to the user turn that prompted this assistant turn.
  let userIdx = -1
  for (let i = idx - 1; i >= 0; i--) {
    const t = state.turns[i]
    if (t && t.role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx === -1) return null
  const userTurn = state.turns[userIdx]
  if (!userTurn || userTurn.role !== 'user') return null
  // Keep up to and including the user turn; drop the assistant reply (and any
  // later turns) so the re-run streams in fresh.
  const turns = state.turns.slice(0, userIdx + 1)
  return {
    state: resetRunLifecycle(turns, state),
    input: userTurn.content,
    ...(userTurn.attachments && userTurn.attachments.length > 0
      ? { attachments: userTurn.attachments }
      : {}),
  }
}

/**
 * Plan an Edit-and-resend of a user turn: replace its text, drop everything
 * after it, and re-run with the edited text. Pure — returns the trimmed state
 * plus the edited input, or `null` for an unknown turn id or empty edit.
 */
export function prepareEdit(
  state: ChatState,
  userTurnId: string,
  newText: string,
): RerunPlan | null {
  const trimmed = newText.trim()
  if (!trimmed) return null
  const idx = state.turns.findIndex((t) => t.id === userTurnId && t.role === 'user')
  if (idx === -1) return null
  const original = state.turns[idx]
  if (!original || original.role !== 'user') return null
  // Keep the turn's identity (createdAt, attachments) — only the text changes,
  // so an edited image turn re-runs WITH its images.
  const edited: UserTurn = { ...original, content: trimmed }
  // Replace the edited user turn and drop everything after it.
  const turns = [...state.turns.slice(0, idx), edited]
  return {
    state: resetRunLifecycle(turns, state),
    input: trimmed,
    ...(original.attachments && original.attachments.length > 0
      ? { attachments: original.attachments }
      : {}),
  }
}

/** Find the index of the active (streaming) assistant turn, or -1. */
function activeAssistantIndex(turns: Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t && t.role === 'assistant' && t.streaming) return i
    // A user turn newer than any streaming assistant turn means there's no
    // active assistant turn yet.
    if (t && t.role === 'user') return -1
  }
  return -1
}

/** Ensure there is an active assistant turn to receive streamed content, tool
 * calls, and reasoning. Returns the (possibly extended) turns array and the
 * index of the active assistant turn. */
function ensureAssistantTurn(
  turns: Turn[],
  runId: string | null,
): { turns: Turn[]; index: number } {
  const existing = activeAssistantIndex(turns)
  if (existing !== -1) return { turns, index: existing }
  const turn: AssistantTurn = {
    id: `a-${runId ?? 'run'}-${turns.length}`,
    role: 'assistant',
    content: '',
    toolCalls: [],
    reasoning: [],
    streaming: true,
  }
  return { turns: [...turns, turn], index: turns.length }
}

function patchAssistant(
  turns: Turn[],
  index: number,
  patch: (t: AssistantTurn) => AssistantTurn,
): Turn[] {
  const next = turns.slice()
  const current = next[index]
  if (current && current.role === 'assistant') next[index] = patch(current)
  return next
}

/** Finalize the active assistant turn (mark it no longer streaming). */
export function finalizeStreaming(
  state: ChatState,
  finalContent?: string,
  usage?: TokenUsage,
): ChatState {
  const index = activeAssistantIndex(state.turns)
  if (index === -1) {
    return state
  }
  const turns = patchAssistant(state.turns, index, (t) => ({
    ...t,
    // Prefer the explicit terminal output when present; otherwise keep what
    // streamed in. (The gateway's run.completed `output` is the full text.)
    content: finalContent !== undefined && finalContent !== null ? finalContent : t.content,
    streaming: false,
    usage: usage ?? t.usage,
  }))
  return { ...state, turns }
}

/**
 * Pure reducer. Apply one ChatServerEvent to the state, returning the next
 * state. De-dups by cursor (events at or below `lastCursor` are ignored) so
 * resume-replay is idempotent.
 *
 * `now` (epoch ms, injectable for tests; defaults to the wall clock) stamps the
 * liveness watermarks: `lastHeartbeatAt` for a transient `run.heartbeat`, and
 * `lastEventAt` for every ACCEPTED substantive event. Dropped duplicates (resume
 * replay) stamp nothing — they are not fresh signals from the run.
 */
export function applyEvent(
  state: ChatState,
  event: ChatServerEvent,
  now: number = Date.now(),
): ChatState {
  // A heartbeat is liveness only — never transcript content, never cursored.
  // Gate on run_id so a still-tailed WEDGED old run's keepalives cannot mask
  // the live run as fresh. The runId===null adoption case still accepts:
  // a reload-resume with after_cursor>1 never replays run.started, so the
  // store may legitimately not know its run id yet.
  if (event.event === 'run.heartbeat') {
    if (state.runId !== null && state.runId !== event.run_id) return state
    return { ...state, lastHeartbeatAt: now }
  }
  // RUN-ID GATE for everything else (same rule as the heartbeat above): once the
  // store knows its run, frames from ANOTHER run are dropped instead of merged —
  // a stray/overlapping second run's deltas, tool cards, or terminal frames must
  // never scramble the active bubble or flip the run status. A legitimate second
  // run announces itself with `run.started` (handled inside the reducer, which
  // adopts the new run id and rebases the cursor); only that path switches runs.
  // The runId===null adoption case still accepts, exactly like the heartbeat.
  if (event.event !== 'run.started' && state.runId !== null && state.runId !== event.run_id) {
    return state
  }
  const next = reduceEvent(state, event)
  // Unchanged state means the event was dropped (already seen) — no fresh signal.
  if (next === state) return state
  return { ...next, lastEventAt: now }
}

function reduceEvent(state: ChatState, event: ChatServerEvent): ChatState {
  const cursor = typeof event.cursor === 'number' ? event.cursor : undefined
  // `run.started` for a NEW run begins a fresh cursor sequence (the BFF numbers
  // cursors PER RUN, restarting at 1). The de-dup watermark is conversation-
  // global, so a second run's low cursors would otherwise be <= the prior run's
  // watermark and get dropped — blanking every turn after the first. Rebase the
  // watermark to this run's sequence so the new run streams. This applies ONLY to
  // a genuinely new run id: a resume of the SAME run replays its own run.started
  // (cursor 1), which must still be de-duped against the watermark so replay-tail
  // stays idempotent — so that case falls through to the normal gate below.
  if (event.event === 'run.started' && event.run_id !== state.runId) {
    const rebased: ChatState = cursor !== undefined ? { ...state, lastCursor: cursor } : state
    return {
      ...rebased,
      runId: event.run_id,
      runStatus: 'running',
      error: null,
      pendingApproval: null,
    }
  }

  // Drop already-seen buffered events (resume replay-tail de-dup). Transient
  // cursor-less frames (run.stopping) are never dropped here.
  if (cursor !== undefined && cursor <= state.lastCursor) return state

  // Advance the cursor watermark for any cursored event we accept.
  const advanced: ChatState = cursor !== undefined ? { ...state, lastCursor: cursor } : state

  switch (event.event) {
    case 'run.started': {
      // A NEW run's run.started is handled above (before the de-dup gate) so its
      // per-run cursor rebase fires even when its cursor is <= the prior
      // watermark. A SAME-run resume replay reaches here only if it cleared the
      // de-dup gate; mark running (idempotent) without disturbing the watermark.
      return {
        ...advanced,
        runId: event.run_id,
        runStatus: 'running',
        error: null,
        pendingApproval: null,
      }
    }

    case 'message.started': {
      const { turns } = ensureAssistantTurn(advanced.turns, advanced.runId)
      return { ...advanced, turns }
    }

    case 'message.delta': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      const next = patchAssistant(turns, index, (t) => ({
        ...t,
        content: t.content + event.delta,
      }))
      return { ...advanced, turns: next }
    }

    case 'reasoning.available': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      const next = patchAssistant(turns, index, (t) => ({
        ...t,
        reasoning: [...t.reasoning, event.text],
      }))
      return { ...advanced, turns: next }
    }

    case 'tool.started': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      // A started frame always opens a NEW running card — even when an earlier
      // call to the same tool already completed (a tool may be invoked twice).
      const next = patchAssistant(turns, index, (t) => ({
        ...t,
        toolCalls: [
          ...t.toolCalls,
          { tool: event.tool, status: 'running', preview: event.preview ?? null },
        ],
      }))
      return { ...advanced, turns: next }
    }

    case 'tool.progress': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      const next = patchAssistant(turns, index, (t) =>
        upsertTool(t, event.tool, (prev) => ({
          tool: event.tool,
          status: prev?.status ?? 'running',
          preview: event.preview ?? prev?.preview ?? null,
        })),
      )
      return { ...advanced, turns: next }
    }

    case 'tool.completed': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      const next = patchAssistant(turns, index, (t) =>
        upsertTool(t, event.tool, (prev) => ({
          tool: event.tool,
          status: event.error ? 'failed' : 'completed',
          preview: prev?.preview ?? null,
          duration: event.duration,
          error: event.error,
          ...(typeof event.timestamp === 'number' ? { completedAt: event.timestamp * 1000 } : {}),
        })),
      )
      return { ...advanced, turns: next }
    }

    case 'tool.failed': {
      const { turns, index } = ensureAssistantTurn(advanced.turns, advanced.runId)
      const next = patchAssistant(turns, index, (t) =>
        upsertTool(t, event.tool, (prev) => ({
          tool: event.tool,
          status: 'failed',
          preview: prev?.preview ?? null,
          duration: prev?.duration,
          error: true,
          errorMessage: event.error,
          ...(typeof event.timestamp === 'number'
            ? { completedAt: event.timestamp * 1000 }
            : { ...(prev?.completedAt ? { completedAt: prev.completedAt } : {}) }),
        })),
      )
      return { ...advanced, turns: next }
    }

    case 'approval.request': {
      return {
        ...advanced,
        pendingApproval: {
          run_id: event.run_id,
          approval_id: event.approval_id,
          command: event.command,
          description: event.description,
          pattern_key: event.pattern_key,
          pattern_keys: event.pattern_keys,
          choices: event.choices,
        },
      }
    }

    case 'approval.responded': {
      // Clear the matching pending approval (by id when present, else any).
      const pending = advanced.pendingApproval
      const matches =
        pending !== null &&
        (event.approval_id === undefined ||
          pending.approval_id === undefined ||
          pending.approval_id === event.approval_id)
      return { ...advanced, pendingApproval: matches ? null : pending }
    }

    case 'run.stopping': {
      // Transient status, no cursor. Only meaningful while a run is in flight.
      if (advanced.runStatus === 'idle') return advanced
      return { ...advanced, runStatus: 'stopping' }
    }

    case 'run.completed': {
      const finalized = finalizeStreaming(advanced, event.output ?? undefined, event.usage)
      return {
        ...finalized,
        runStatus: 'idle',
        pendingApproval: null,
      }
    }

    case 'run.failed': {
      const finalized = finalizeStreaming(advanced)
      return {
        ...finalized,
        runStatus: 'idle',
        error: event.error,
        pendingApproval: null,
      }
    }

    case 'run.cancelled': {
      const finalized = finalizeStreaming(advanced)
      return {
        ...finalized,
        runStatus: 'idle',
        pendingApproval: null,
      }
    }

    case 'run.heartbeat': {
      // Handled in applyEvent before reduction (liveness watermark only); kept
      // here so the exhaustiveness guard below stays sound.
      return advanced
    }

    default: {
      // Exhaustiveness guard: every ChatServerEvent variant is handled above.
      const _never: never = event
      void _never
      return advanced
    }
  }
}

/** Upsert a tool card keyed by tool name. `make` receives the prior card (if
 * any) so completion can preserve the started preview. */
function upsertTool(
  turn: AssistantTurn,
  tool: string,
  make: (prev: ToolCall | undefined) => ToolCall,
): AssistantTurn {
  const idx = turn.toolCalls.findIndex((c) => c.tool === tool && c.status === 'running')
  // No running card for this tool? Treat it as a new card (e.g. a second call
  // to the same tool after the first completed).
  const targetIdx = idx !== -1 ? idx : turn.toolCalls.findIndex((c) => c.tool === tool)
  if (targetIdx === -1) {
    return { ...turn, toolCalls: [...turn.toolCalls, make(undefined)] }
  }
  const next = turn.toolCalls.slice()
  next[targetIdx] = make(next[targetIdx])
  return { ...turn, toolCalls: next }
}

/** Apply a batch of events in order (handy for replay snapshots). Pure.
 * (An explicit lambda: `reduce(applyEvent, …)` would pass the array INDEX into
 * applyEvent's `now` clock parameter.) */
export function applyEvents(state: ChatState, events: ChatServerEvent[]): ChatState {
  return events.reduce((acc, event) => applyEvent(acc, event), state)
}

// --- Conversation branching (Lane D) ----------------------------------------
//
// The DAG is an ADDITIVE layer. The reducer above still owns `state.turns` as the
// ACTIVE branch projection; these helpers materialize the graph lazily on the
// first fork, snapshot the active branch so siblings stay reachable, and swap the
// projection on a branch change. `activeTurns(state)` returns `state.turns`
// directly, so the un-forked path is unchanged. Forking copies NO message content
// (the original descendants remain on the original branch).

/**
 * The HONEST fork copy (plan §"UX and honesty copy"). These exact strings are the
 * single source of truth shared by the store actions and the UI — local means
 * local, and we never claim a Hermes-persisted DAG.
 */
export const FORK_COPY = {
  /** The hover-revealed action label. */
  action: 'Fork from here',
  /** The banner shown after a fork lands (the original is never deleted). */
  localBanner: 'Forked locally from this message. Your original chat is still saved.',
  /** Before the first send on a local fork. */
  beforeSend: 'This fork is local until you send it.',
  /** When Hermes cannot clone/import the ancestor path (a historical fork): the
   * next send starts a brand-new Hermes session, but the earlier messages still
   * ride along as conversation_history context (the run carries the transcript). */
  newChatContext:
    'Your next message starts a new chat in Hermes. The earlier messages are sent along as context.',
  /** While a run is in flight — fork after the reply finishes. */
  disabledRunning: 'Fork after the reply finishes.',
} as const

let branchSeq = 0

/** A fresh, collision-resistant local branch id. */
function newBranchId(): string {
  return `branch-${Date.now()}-${branchSeq++}`
}

/** The turns the UI renders for the active branch — always `state.turns`. */
export function activeTurns(state: ChatState): Turn[] {
  return state.turns
}

/**
 * Build the gateway `conversation_history` payload for a run: the PRIOR turns of
 * the active branch as plain {role, content} text, oldest first.
 *
 * Why this exists: the gateway's `/v1/runs` does NOT load prior messages for a
 * bare `session_id` — without an explicit `conversation_history` array every
 * follow-up turn reaches the model with zero context (history=0). The rendered
 * transcript already lives in this store, so it is the source of truth.
 *
 * Rules:
 *  - The trailing user turn is the CURRENT `input` (send/retry/edit all leave it
 *    at the head before issuing the run) and is excluded — it rides as `input`.
 *  - Text only: tool calls/results/reasoning are omitted (the gateway agent
 *    re-derives tool state); empty and still-streaming assistant turns are
 *    skipped.
 *  - Capped oldest-dropped-first at {@link CONVERSATION_HISTORY_MAX_MESSAGES}
 *    messages / {@link CONVERSATION_HISTORY_MAX_CHARS} chars. HONEST limitation:
 *    a longer conversation reaches the model with only its most recent window.
 */
export function conversationHistoryForRun(
  turns: Turn[],
  currentInput: string,
): ConversationHistoryMessage[] {
  const prior = turns.slice()
  const last = prior[prior.length - 1]
  if (last && last.role === 'user' && last.content === currentInput) prior.pop()

  const textual: ConversationHistoryMessage[] = []
  for (const t of prior) {
    if (t.role === 'assistant' && t.streaming) continue
    if (t.content.trim() === '') continue
    textual.push({ role: t.role, content: t.content })
  }

  // Cap from the NEWEST end: keep the most recent messages within both limits.
  const capped: ConversationHistoryMessage[] = []
  let chars = 0
  for (let i = textual.length - 1; i >= 0; i--) {
    const msg = textual[i]!
    if (capped.length >= CONVERSATION_HISTORY_MAX_MESSAGES) break
    if (capped.length > 0 && chars + msg.content.length > CONVERSATION_HISTORY_MAX_CHARS) break
    chars += msg.content.length
    capped.push(msg)
  }
  return capped.reverse()
}

/**
 * Where the NEXT run's history payload would start in `turns`, or null when the
 * whole transcript fits under the caps (the common case). Mirrors the capping in
 * {@link conversationHistoryForRun} over the full transcript (at rest, the next
 * send's NEW user turn rides as `input`, so every current turn is candidate
 * history). Returns the index of the OLDEST turn that still rides along — the UI
 * renders an honest truncation notice above it ("older messages aren't sent").
 * Pure; O(n) over the turns.
 */
export function historyTruncationStartIndex(turns: Turn[]): number | null {
  // The turn indices that would enter the payload (same skip rules as the
  // builder: streaming/empty turns contribute nothing).
  const candidateIdx: number[] = []
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]!
    if (t.role === 'assistant' && t.streaming) continue
    if (t.content.trim() === '') continue
    candidateIdx.push(i)
  }
  // Cap from the NEWEST end, exactly like conversationHistoryForRun.
  let kept = 0
  let chars = 0
  for (let j = candidateIdx.length - 1; j >= 0; j--) {
    const msg = turns[candidateIdx[j]!]!
    if (kept >= CONVERSATION_HISTORY_MAX_MESSAGES) return candidateIdx[j + 1] ?? null
    if (kept > 0 && chars + msg.content.length > CONVERSATION_HISTORY_MAX_CHARS) {
      return candidateIdx[j + 1] ?? null
    }
    chars += msg.content.length
    kept++
  }
  return null
}

/** Whether a turn is SETTLED (forkable): an assistant turn that finished
 * streaming, or any user turn. A streaming assistant head is never forkable. */
function isSettledTurn(turn: Turn): boolean {
  return turn.role === 'user' || !turn.streaming
}

/** Whether the conversation is quiescent enough to fork: no run in flight, no
 * pending approval, no streaming assistant head. */
function canFork(state: ChatState): boolean {
  if (state.runStatus !== 'idle') return false
  if (state.pendingApproval) return false
  // A streaming assistant head means a run is materially live even if status drift
  // says idle — never fork over it.
  return !state.turns.some((t) => t.role === 'assistant' && t.streaming)
}

/** Build a per-turn node map for a linear branch's turns (each node's parent is
 * the previous turn in the path). */
function nodesForPath(turns: Turn[], branchId: string, source: NodeSource): ConversationNode[] {
  return turns.map((turn, i) => ({
    id: turn.id,
    turn,
    parentId: i > 0 ? (turns[i - 1]!.id ?? null) : null,
    childIds: i < turns.length - 1 ? [turns[i + 1]!.id] : [],
    branchId,
    source,
  }))
}

/**
 * The plan returned by {@link forkFromTurn}: the next state (active branch swapped
 * to the new local branch projecting the ancestor path) plus the fork metadata the
 * caller surfaces (whether the original Hermes session can legitimately continue).
 */
export interface ForkPlan {
  state: ChatState
  /** The new local branch id. */
  branchId: string
  /** The branch that retains the original continuation (so the UI can offer
   * "back to the original"). */
  originalBranchId: string
  /** True when the fork point is the live head (the last turn) — the only case
   * where keeping the existing Hermes `session_id` would not rewind it. A fork
   * from an earlier message is mid-history → a new local chat. */
  atHead: boolean
}

/**
 * Fork a NEW local branch rooted at a settled turn. Non-destructive: the original
 * continuation stays reachable on its own branch; the new branch projects the
 * ancestor path (turns[0..forkIndex]). Returns `null` when forking is disallowed
 * (run in flight / pending approval / streaming head) or the turn id is unknown /
 * not settled — so a disabled fork never moves `activeBranchId`. Pure.
 */
export function forkFromTurn(state: ChatState, turnId: string): ForkPlan | null {
  if (!canFork(state)) return null
  const forkIndex = state.turns.findIndex((t) => t.id === turnId)
  if (forkIndex === -1) return null
  const forkTurn = state.turns[forkIndex]!
  if (!isSettledTurn(forkTurn)) return null

  // Ensure the graph exists, with the current `state.turns` captured as the
  // ORIGINAL branch (the full path the fork diverges from).
  const originalBranchId = state.activeBranchId ?? newBranchId()
  const fullTurns = state.turns
  const originalBranch: ConversationBranch = {
    id: originalBranchId,
    rootNodeId: fullTurns[0]?.id ?? null,
    headNodeId: fullTurns[fullTurns.length - 1]?.id ?? null,
    turns: fullTurns,
    localOnly: state.branches?.[originalBranchId]?.localOnly ?? false,
    hermesSessionId: state.branches?.[originalBranchId]?.hermesSessionId,
  }

  const forkBranchId = newBranchId()
  const ancestorPath = fullTurns.slice(0, forkIndex + 1)
  const atHead = forkIndex === fullTurns.length - 1
  const forkBranch: ConversationBranch = {
    id: forkBranchId,
    rootNodeId: ancestorPath[0]?.id ?? null,
    headNodeId: ancestorPath[ancestorPath.length - 1]?.id ?? null,
    turns: ancestorPath,
    localOnly: true,
    // A fork at the live head may keep continuing the same Hermes session; a fork
    // from a historical message must NOT reuse it (stock Hermes would append to
    // the linear head and corrupt the session) → cleared here, the send policy
    // treats it as a new local chat.
    hermesSessionId: atHead ? (originalBranch.hermesSessionId ?? null) : null,
  }

  const nodes: Record<string, ConversationNode> = {}
  for (const n of nodesForPath(originalBranch.turns, originalBranchId, 'live')) nodes[n.id] = n
  // Re-tag the shared ancestor nodes onto the fork so its head node points there;
  // the fork's projection shares the ancestor turns by value (no content copy).
  for (const n of nodesForPath(ancestorPath, forkBranchId, 'live')) {
    nodes[`${forkBranchId}:${n.id}`] = { ...n, id: `${forkBranchId}:${n.id}` }
  }

  return {
    state: {
      ...state,
      turns: ancestorPath,
      branches: {
        ...(state.branches ?? {}),
        [originalBranchId]: originalBranch,
        [forkBranchId]: forkBranch,
      },
      nodes,
      activeBranchId: forkBranchId,
    },
    branchId: forkBranchId,
    originalBranchId,
    atHead,
  }
}

/**
 * Switch the active branch without mutating any branch's turns. Snapshots the
 * outgoing branch's current `state.turns` (it may have grown via live sends),
 * then projects the incoming branch's stored turns. Returns the state unchanged
 * for an unknown branch id. Pure.
 */
export function selectBranch(state: ChatState, branchId: string): ChatState {
  const branches = state.branches
  if (!branches || !branches[branchId]) return state
  if (state.activeBranchId === branchId) return state

  // Persist the outgoing branch's live turns so re-selecting it later restores
  // everything sent since the fork.
  const outgoingId = state.activeBranchId
  const nextBranches: Record<string, ConversationBranch> = { ...branches }
  if (outgoingId && nextBranches[outgoingId]) {
    nextBranches[outgoingId] = {
      ...nextBranches[outgoingId]!,
      turns: state.turns,
      headNodeId: state.turns[state.turns.length - 1]?.id ?? null,
    }
  }

  const incoming = nextBranches[branchId]!
  return {
    ...state,
    turns: incoming.turns,
    branches: nextBranches,
    activeBranchId: branchId,
  }
}

/**
 * Seed the conversation with a prior session's transcript as ONE clean linear
 * branch (the "Continue this session" resume path). Resets run/approval/cursor so
 * the next send starts a fresh run, preserves the resumed identity (title ·
 * model), and records a single local branch so a later fork has a graph to
 * diverge from. The seeded turns keep their stable history node ids. Pure.
 */
export function seedTurns(
  turns: Turn[],
  identity?: { title?: string | null; model?: string | null; hermesSessionId?: string | null },
): ChatState {
  const branchId = newBranchId()
  const branch: ConversationBranch = {
    id: branchId,
    rootNodeId: turns[0]?.id ?? null,
    headNodeId: turns[turns.length - 1]?.id ?? null,
    turns,
    localOnly: false,
    // Remember the resumed Hermes session so a fork at the live head may keep it,
    // while a fork from a historical message must drop it (honesty: no rewind).
    hermesSessionId: identity?.hermesSessionId ?? null,
  }
  const nodes: Record<string, ConversationNode> = {}
  for (const n of nodesForPath(turns, branchId, 'history')) nodes[n.id] = n
  return {
    ...initialChatState,
    turns,
    // Skill/cron sessions carry a machine `[IMPORTANT: …` preamble as their
    // title; sanitize it so the sticky chat header reads human.
    sessionTitle: sanitizeSessionPreview(identity?.title) || null,
    sessionModel: identity?.model?.trim() || null,
    branches: { [branchId]: branch },
    nodes,
    activeBranchId: branchId,
  }
}

/**
 * How the NEXT send on the active branch should be issued, with honest copy. The
 * UI surfaces `copy`; {@link useChatRun} reads `kind` to decide whether to forward
 * a Hermes `session_id`.
 *
 *  - `same-session`: no fork, or a fork at the live head of a Hermes-backed
 *    session → the send may legitimately continue that session.
 *  - `new-session`: a local fork that has no Hermes session to continue (a fresh
 *    local chat / a fork at the head of a session-less chat) → a normal new run.
 *  - `unsupported-context`: a fork from a HISTORICAL message of a Hermes session →
 *    stock Hermes can't clone the ancestor path, so the next send starts a new
 *    Hermes session; the earlier turns still reach the model as the run's
 *    conversation_history context (only the persisted session is new).
 */
export interface BranchSendPolicy {
  kind: 'same-session' | 'new-session' | 'unsupported-context'
  copy: string
}

export function branchSendPolicy(state: ChatState): BranchSendPolicy {
  const activeId = state.activeBranchId
  const branch = activeId ? state.branches?.[activeId] : undefined
  // No graph / no active branch → a plain linear chat. Same-session is honest:
  // a resumed chat keeps its session (the session_id ref lives in useChatRun);
  // a fresh chat has none and the send is a normal new run regardless.
  if (!branch) return { kind: 'same-session', copy: '' }

  // A local fork that may continue a Hermes session (forked at the live head and
  // carried its session id) → same session.
  if (branch.localOnly && branch.hermesSessionId) {
    return { kind: 'same-session', copy: '' }
  }

  // A local fork with NO Hermes session id: if it was forked out of a Hermes
  // session (the original branch had a session id), the ancestor path can't be
  // cloned → unsupported-context, new chat. Otherwise it's just a fresh local
  // chat → new-session.
  if (branch.localOnly) {
    const forkedFromHermes = Object.values(state.branches ?? {}).some(
      (b) => b.id !== branch.id && b.hermesSessionId,
    )
    return forkedFromHermes
      ? { kind: 'unsupported-context', copy: FORK_COPY.newChatContext }
      : { kind: 'new-session', copy: FORK_COPY.beforeSend }
  }

  // The seeded/original (non-local) branch → continues its session as before.
  return { kind: 'same-session', copy: '' }
}

/** A safe, empty single-branch state — the fail-open fallback for hydration. */
function emptyBranchState(): ChatState {
  return { ...initialChatState }
}

/**
 * Hydrate persisted local branch metadata, FAILING OPEN to a safe empty
 * single-branch state on anything malformed (wrong types, missing fields,
 * non-object). Never throws — hydration must never block chat. The active-run
 * resume cursor is NOT carried here (it lives in its own storage key).
 */
export function hydrateBranchState(blob: unknown): ChatState {
  try {
    if (typeof blob !== 'object' || blob === null) return emptyBranchState()
    const b = blob as Partial<ChatState>
    if (typeof b.branches !== 'object' || b.branches === null) return emptyBranchState()
    if (typeof b.nodes !== 'object' || b.nodes === null) return emptyBranchState()
    const activeBranchId = typeof b.activeBranchId === 'string' ? b.activeBranchId : null
    const active = activeBranchId ? (b.branches as Record<string, unknown>)[activeBranchId] : null
    const turns =
      active && Array.isArray((active as ConversationBranch).turns)
        ? (active as ConversationBranch).turns
        : []
    return {
      ...emptyBranchState(),
      turns,
      branches: b.branches as Record<string, ConversationBranch>,
      nodes: b.nodes as Record<string, ConversationNode>,
      activeBranchId,
    }
  } catch {
    return emptyBranchState()
  }
}

/**
 * Zustand binding over the pure {@link applyEvent} reducer. The UI subscribes
 * here; the socket client calls `ingest` for each ChatServerEvent and the
 * action helpers when the user sends / aborts. Keeping the reducer pure (in
 * `chatStore.ts`) lets us unit-test transitions without React or a socket.
 */
import { create } from 'zustand'
import type { ChatServerEvent, RunAttachment } from '@agent-deck/protocol'
import {
  applyEvent,
  appendUserTurn,
  beginAssistantTurn,
  prepareRetry,
  prepareEdit,
  forkFromTurn,
  selectBranch,
  seedTurns as seedTurnsPure,
  finalizeStreaming,
  FORK_COPY,
  initialChatState,
  type ChatState,
  type Turn,
} from './chatStore'

export interface ChatStore extends ChatState {
  /** Feed one server event through the pure reducer. */
  ingest: (event: ChatServerEvent) => void
  /** Optimistically append the user's message before run.started returns. Carries
   * any sent image attachments so they render in the transcript bubble. */
  addUserMessage: (content: string, attachments?: RunAttachment[]) => void
  /** Optimistically open a streaming assistant turn so the pulsing "working"
   * indicator shows the instant the user sends — never a void before the first
   * token. Reused (not duplicated) by the first real frame. */
  beginAssistantTurn: () => void
  /** Optimistically clear the pending approval the instant the user responds,
   * so the card can't be submitted twice while the gateway round-trips. */
  clearPendingApproval: () => void
  /** Retry/Regenerate an assistant turn: drop it (and any later turns) and
   * return the prompting user turn's text so the caller can re-issue the run.
   * Returns null when the turn can't be retried (no preceding user turn). */
  retry: (assistantTurnId: string) => string | null
  /** Edit-and-resend a user turn: replace its text, drop everything after it,
   * and return the edited text to re-run. Returns null for an empty edit or an
   * unknown turn. */
  editAndResend: (userTurnId: string, newText: string) => string | null
  /** Seed the conversation with a prior session's transcript (the "Continue this
   * session" resume path). Replaces the turns with the read-only history and
   * resets run/approval/cursor state so the next send starts a fresh run inside
   * the resumed session. The optional `identity` (title · model) is carried into
   * the live chat header so resuming doesn't drop you into an empty header. */
  seedTurns: (
    turns: Turn[],
    identity?: { title?: string | null; model?: string | null; hermesSessionId?: string | null },
  ) => void
  /** Surface a transport-level error (e.g. the BFF rejected a command because the
   * gateway is down) and reset runStatus to idle so the UI isn't a silent
   * dead-end. Pass null to clear. */
  setError: (message: string | null) => void
  /** Reset to a clean conversation (New chat). */
  reset: () => void
  /**
   * Fork a NEW local branch rooted at a settled turn (non-destructive — the
   * original continuation stays reachable). Swaps the active branch to the
   * ancestor path and returns the honesty copy for the local-fork banner, or
   * `null` when forking is disallowed (run in flight / streaming / pending
   * approval / unknown-or-unsettled turn) so the UI can keep the action disabled.
   */
  forkFromTurn: (turnId: string) => string | null
  /** Switch the active branch's projection without mutating the graph. */
  selectBranch: (branchId: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  ...initialChatState,
  ingest: (event) => set((state) => applyEvent(state, event)),
  addUserMessage: (content, attachments) =>
    set((state) => appendUserTurn(state, content, attachments)),
  beginAssistantTurn: () => set((state) => beginAssistantTurn(state)),
  clearPendingApproval: () => set((state) => ({ ...state, pendingApproval: null })),
  retry: (assistantTurnId) => {
    const plan = prepareRetry(useChatStore.getState(), assistantTurnId)
    if (!plan) return null
    set(() => plan.state)
    return plan.input
  },
  editAndResend: (userTurnId, newText) => {
    const plan = prepareEdit(useChatStore.getState(), userTurnId, newText)
    if (!plan) return null
    set(() => plan.state)
    return plan.input
  },
  seedTurns: (turns, identity) => set(() => seedTurnsPure(turns, identity)),
  setError: (message) =>
    set((state) =>
      message === null
        ? { ...state, error: null }
        : // A surfaced transport error also clears the "running" spinner and any
          // stale pending approval, so the composer returns to an actionable state.
          // It ALSO finalizes any in-flight streaming turn — otherwise a rejected
          // run (`command.error`) leaves the optimistic assistant placeholder stuck
          // "thinking…" forever (unlike run.failed/cancelled, which finalize it).
          {
            ...finalizeStreaming(state),
            error: message,
            runStatus: 'idle',
            pendingApproval: null,
          },
    ),
  // Reset must EXPLICITLY clear the graph fields: zustand's `set` shallow-merges,
  // so spreading initialChatState (which has no graph keys) would leave a prior
  // fork's branches/nodes behind. Set them to undefined to drop them.
  reset: () =>
    set(() => ({
      ...initialChatState,
      nodes: undefined,
      branches: undefined,
      activeBranchId: null,
    })),
  forkFromTurn: (turnId) => {
    const plan = forkFromTurn(useChatStore.getState(), turnId)
    if (!plan) return null
    set(() => plan.state)
    // Honest local-fork copy: the fork is local until the user sends it. The
    // per-branch send context (new-chat vs same-session) is surfaced by
    // branchSendPolicy in the UI banner; this is the immediate confirmation.
    return FORK_COPY.beforeSend
  },
  selectBranch: (branchId) => set((state) => selectBranch(state, branchId)),
}))

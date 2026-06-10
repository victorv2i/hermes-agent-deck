import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ArrowDown,
  Boxes,
  CalendarRange,
  FileSearch,
  GitBranch,
  Sparkles,
  Unplug,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ApprovalChoice, RunAttachment } from '@agent-deck/protocol'
import type { PendingApproval, RunStatus, Turn } from '@/state/chatStore'
import type { ModelEntry } from '@/features/models/types'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useOnboarded } from '@/lib/useOnboarded'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Message } from './Message'
import type { ChatAgentIdentity } from './chatIdentity'
import { VirtualMessageList } from './VirtualMessageList'
import { ApprovalCard } from './ApprovalCard'
import { Composer } from './Composer'
import { FindInConversation } from '@/features/chat-input/FindInConversation'

// Jump-to-latest lives in a lazy chunk so framer-motion stays off the eager
// entry path. The Suspense fallback renders an un-animated button so the control
// works before the chunk loads. (Per-row enter animation was retired with
// virtualization: animating measured, absolutely-positioned virtual rows fights
// height measurement and thrashes — the windowed log renders rows directly.)
const JumpToLatest = lazy(() =>
  import('./ChatViewMotion').then((m) => ({ default: m.JumpToLatest })),
)

// Dual-audience starters (A7) — one newcomer, one everyday, one builder — mirroring
// Home's StarterPrompts mix so a non-technical newcomer is never told "not for
// you". Each one-click seeds the prompt and starts the conversation.
const EXAMPLE_PROMPTS: { icon: LucideIcon; text: string }[] = [
  { icon: Sparkles, text: 'Summarize my morning and what needs my attention.' },
  { icon: CalendarRange, text: 'Help me plan my week.' },
  { icon: FileSearch, text: 'Read this repo and explain what it does.' },
]

export interface ChatViewProps {
  turns: Turn[]
  runStatus: RunStatus
  pendingApproval: PendingApproval | null
  error?: string | null
  /** The active agent's identity (face + name) — drives the first-person empty-
   * state greeting and the per-group assistant avatar gutter (A1). Null while the
   * roster loads → chat degrades to its honest anonymous copy. */
  agent?: ChatAgentIdentity | null
  /** The gateway's model list for the composer picker (T1.2). */
  models?: ModelEntry[]
  /** The currently-selected model id. */
  model?: string | null
  /** Commit a model selection. */
  onModelChange?: (id: string) => void
  contextTokens?: number
  contextLimit?: number
  /** Composer disabled (e.g. socket disconnected). */
  inputDisabled?: boolean
  /** Why the chat genuinely can't run right now, if anything — honest, not a fake
   * "ready" composer that silently fails on send: 'unreachable' = the agent
   * (Hermes gateway) isn't responding; 'no-model' = no usable model is connected
   * yet. When set, an explanatory notice shows above the composer and the composer
   * is disabled. Null/undefined = chat is ready. */
  blockedReason?: 'unreachable' | 'no-model' | null
  /** Navigate to the connect-a-model surface — the action on the 'no-model' notice. */
  onConnectModel?: () => void
  /** One-click recovery action for the 'unreachable' notice (the shared Start my
   * agent button). The connected route passes it ONLY when the deck's own server
   * answered the health probe and reported the agent down; when the BFF itself is
   * unreachable a restart call cannot land, so no action is offered and the
   * honest no-action copy stands alone. */
  startAgentAction?: ReactNode
  /** Whether the active model can accept images (drives the composer's attach
   * affordance — honest degradation when vision is unavailable, S5). */
  canAttachImages?: boolean
  /** Move focus into the composer once on mount (first-run hand-off from Home,
   * where a starter prompt seeds the draft and lands the cursor ready to send). */
  autoFocusComposer?: boolean
  /** The active session id — keys the composer's PER-CONVERSATION persisted draft
   * (see {@link Composer} `sessionKey`). Null/undefined for the unsent new chat
   * (maps to the `:new` sentinel), so each conversation keeps its own draft rather
   * than sharing one. */
  sessionId?: string | null
  onSend: (text: string, attachments?: RunAttachment[]) => void
  onStop: () => void
  /** Retry/Regenerate an assistant turn (T1.4). */
  onRetry?: (assistantTurnId: string) => void
  /** Edit-and-resend a user turn (T1.4). */
  onEditTurn?: (userTurnId: string, newText: string) => void
  /** Fork a new local branch rooted at a settled turn (Lane D). Non-destructive —
   * the original continuation stays reachable. */
  onFork?: (turnId: string) => void
  /** The honest local-fork banner copy to show above the composer after a fork,
   * or null/undefined when no fork is active. Local means local. */
  forkBanner?: string | null
  /** Return to the original (pre-fork) chat — restores the original branch's full
   * path. Offered in the fork banner so the original continuation is always one
   * click away (honest: it was never deleted). */
  onReturnToOriginal?: () => void
  onRespondApproval: (choice: ApprovalChoice) => void
  /** Send a follow-up prompt (used by the refinement row on the last assistant turn). */
  onSendRefinement?: (text: string) => void
  /** Composer slash-command handlers (mirror the ⌘K palette). Each command is
   * offered only when its handler is wired, so an unwired one is simply absent. */
  onNewChat?: () => void
  onClearChat?: () => void
  onToggleTheme?: () => void
}

export function ChatView({
  turns,
  runStatus,
  pendingApproval,
  error,
  agent,
  models,
  model,
  onModelChange,
  contextTokens,
  contextLimit,
  inputDisabled,
  blockedReason,
  onConnectModel,
  startAgentAction,
  canAttachImages,
  autoFocusComposer,
  sessionId,
  onSend,
  onStop,
  onRetry,
  onEditTurn,
  onFork,
  forkBanner,
  onReturnToOriginal,
  onRespondApproval,
  onSendRefinement,
  onNewChat,
  onClearChat,
  onToggleTheme,
}: ChatViewProps) {
  const reduce = usePrefersReducedMotion()
  // Newcomer-only onboarding affordances (orientation line + composer hint) are
  // gated on the shared onboarded flag so experts never see the hand-holding.
  const [onboarded] = useOnboarded()
  const scrollElRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const running = runStatus !== 'idle'

  const isEmpty = turns.length === 0

  // Honest send-gating: when the chat genuinely can't run (agent unreachable or no
  // model connected) the composer is disabled and a notice explains why — never a
  // live-looking composer that silently fails on the first send.
  const blocked = blockedReason ?? null
  const composerDisabled = Boolean(inputDisabled) || blocked !== null

  // Honest send-queue flush gating: a message queued while a run was in flight may
  // only auto-flush when the channel is healthy. It is NOT honest to flush into a
  // disabled composer (disconnected / blocked) or right after a run ended in error
  // — that would fire the queued turn into a dead or just-failed channel. The queue
  // holds it instead and flushes once this recovers (reconnect / a clean run clears
  // the error). `error` is the store's last-run error string (set on a failed run).
  const canFlushQueue = !composerDisabled && !error

  // The index of the LAST completed (non-streaming) assistant turn — the only one
  // that gets the refinement row. Computed once per render; stable for the list.
  const lastCompletedAssistantIndex = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t && t.role === 'assistant' && !t.streaming) return i
    }
    return -1
  })()

  // --- Find in conversation (⌘F) --------------------------------------------
  // Search the OPEN session's rendered turns, highlight the turn carrying the
  // active match, and step next/prev — scrolling each active match into view
  // through the windowing virtualizer. We own all the matching here; the overlay
  // (a Foundation module) is purely presentational.
  const find = useFindInConversation(turns, scrollElRef)

  // Lock the approval buttons after the first click so a double-tap can't
  // submit twice while the response round-trips. We key the busy flag to the
  // pending approval and reset it *during render* (React's adjust-state-on-prop
  // -change pattern) whenever a different approval arrives — no effect needed.
  const approvalKey = pendingApproval
    ? (pendingApproval.approval_id ?? pendingApproval.command)
    : null
  const [busyForApproval, setBusyForApproval] = useState<string | null>(null)
  const approvalBusy = busyForApproval !== null && busyForApproval === approvalKey

  const handleRespondApproval = useCallback(
    (choice: ApprovalChoice) => {
      if (approvalBusy) return
      setBusyForApproval(approvalKey)
      onRespondApproval(choice)
    },
    [approvalBusy, approvalKey, onRespondApproval],
  )

  // Stick-to-bottom + the at-bottom signal now live in VirtualMessageList (it owns
  // the windowed scroll element). It re-pins to the newest row on streaming
  // token-appends and reports when the user scrolls away (driving jump-to-latest).
  const jumpToLatest = useCallback(() => {
    setAtBottom(true)
    const el = scrollElRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
  }, [reduce])

  // Esc aborts an in-flight run (design-language keyboard map). While the find
  // overlay is open, Esc belongs to find (it closes there), so we defer.
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !find.open) onStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onStop, find.open])

  // ⌘F / Ctrl+F opens find — but ONLY when focus is inside the chat surface, so
  // we never hijack the browser's native find elsewhere in the app. The listener
  // lives on the ChatView root; an event only reaches it while focus is within.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        find.openFind()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [find])

  // The empty hero is one composed screen: headline → prompt cards → composer,
  // grouped tightly and anchored to the optical center. Once a conversation
  // exists, content is TOP-anchored (no vertical centering) and the composer is
  // pinned to the floor — so a short reply doesn't float in a vertical gulf.
  if (isEmpty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="message-list">
        {/* Mobile: bottom-bias the hero toward optical center (justify-end + a
            breathing-room bottom pad) so the composer sits in thumb reach and
            the void below shrinks. A fixed `pb-6` keeps a calm gap above the
            keyboard/floor without the ~100px dead space the old `pb-[12vh]` left
            on phones. Desktop (sm:+) keeps true vertical centering. */}
        <div className="flex min-h-0 flex-1 items-center justify-end overflow-y-auto pt-6 pb-6 sm:justify-center sm:py-10 sm:pb-10">
          <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7 px-4">
            <EmptyHero
              onPick={onSend}
              disabled={composerDisabled}
              showOrientation={!onboarded}
              agent={agent}
            />
            <div className="flex flex-col gap-2">
              <ChatBlockedNotice
                reason={blocked}
                onConnectModel={onConnectModel}
                startAgentAction={startAgentAction}
              />
              <Composer
                onSend={onSend}
                onStop={onStop}
                running={running}
                models={models}
                model={model}
                onModelChange={onModelChange}
                contextTokens={contextTokens}
                contextLimit={contextLimit}
                disabled={composerDisabled}
                canFlushQueue={canFlushQueue}
                canAttachImages={canAttachImages}
                autoFocus={autoFocusComposer}
                sessionKey={sessionId}
                floating={false}
                onNewChat={onNewChat}
                onClearChat={onClearChat}
                onToggleTheme={onToggleTheme}
              />
              {/* A calm pull-revelation for newcomers: the slash + ⌘K affordances
                  spelled out once, under the empty composer. Suppressed for
                  onboarded users so the instrument stays quiet for experts. */}
              {!onboarded && (
                <p
                  data-testid="composer-empty-hint"
                  className="px-2 text-center text-[11px] text-foreground-tertiary"
                >
                  Type <kbd className="font-sans">/</kbd> for commands
                  {/* The ⌘K part is keyboard-only guidance: hidden on
                      touch/coarse-pointer devices where there is no ⌘K to press. */}
                  <span className="pointer-coarse:hidden">
                    {' '}
                    · <kbd className="font-sans">⌘K</kbd> to search
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {/* The find overlay floats over the transcript's top-right. It is mounted
          only while open; ⌘F (surface-scoped) toggles it. It owns no matching —
          ChatView computes matches over the rendered turns and drives scroll. */}
      {find.open && (
        <div className="pointer-events-none absolute top-2 right-2 z-30 flex justify-end">
          <FindInConversation
            className="pointer-events-auto"
            query={find.query}
            matches={find.matches}
            activeIndex={find.activeIndex}
            onQueryChange={find.setQuery}
            onNext={find.next}
            onPrev={find.prev}
            onClose={find.close}
          />
        </div>
      )}

      {/* The log itself is silent to SRs (aria-live="off"); per-turn narration is
          delegated to this visually-hidden polite region. It sits outside the
          windowed list so it is never unmounted by scrolling. */}
      <ChatLiveRegion turns={turns} running={running} />

      {/* The conversation log is WINDOWED: only the visible slice of the
          transcript mounts, so a long session no longer janks or OOMs. Stick-to-
          bottom (streaming auto-scroll) and the labelled, keyboard-focusable
          role="log" region are preserved by VirtualMessageList; the pending
          caret rides inside the streaming Message row. The approval card, run
          error, and bottom anchor render in the footer slot after the rows. */}
      <VirtualMessageList
        turns={turns}
        ariaLabel="Conversation"
        // Find takes precedence while open: pause stick-to-bottom so a concurrent
        // stream re-pin can't yank the viewport off the active match.
        stickToBottom={!find.open}
        estimateSize={ROW_ESTIMATE}
        className="px-1"
        innerClassName="pt-5 pb-2"
        onAtBottomChange={setAtBottom}
        scrollRef={(el) => {
          scrollElRef.current = el
        }}
        renderTurn={(turn, index) => (
          <div
            data-find-turn={turn.id}
            data-find-active={find.open && find.activeTurnId === turn.id ? 'true' : undefined}
            className={cn(
              find.open &&
                find.activeTurnId === turn.id &&
                'rounded-xl ring-2 ring-[var(--border-strong)] ring-offset-2 ring-offset-background motion-reduce:transition-none',
            )}
          >
            <Message
              turn={turn}
              agent={agent}
              // The agent's face shows ONCE per consecutive assistant group (A1):
              // only on an assistant turn whose predecessor is NOT an assistant
              // turn. Continuation turns leave the gutter empty so the column reads
              // as one speaker, not a face per bubble.
              showAvatar={turn.role === 'assistant' && turns[index - 1]?.role !== 'assistant'}
              // Find-in-conversation: while open, <mark>-highlight the query in a
              // user turn's plain text AND in assistant prose (via a rehype HAST
              // pass that skips code/KaTeX/links). The turn carrying the active
              // match reads with the accent mark + the turn-level ring.
              highlightQuery={find.open ? find.query : undefined}
              highlightActive={find.open && find.activeTurnId === turn.id}
              onRetry={onRetry}
              onEdit={onEditTurn}
              onFork={onFork}
              onSend={onSendRefinement ?? onSend}
              // Show the refinement row only on the LAST completed assistant turn
              // and only when a run is not in flight (honest: can't refine mid-run).
              showRefinement={
                index === lastCompletedAssistantIndex && !running && !!onSendRefinement && !!onRetry
              }
              actionsDisabled={running || inputDisabled}
            />
          </div>
        )}
        footer={
          <>
            {pendingApproval && (
              <ApprovalCard
                approval={pendingApproval}
                onRespond={handleRespondApproval}
                busy={approvalBusy}
              />
            )}

            {error && (
              <div
                role="alert"
                className="my-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
          </>
        }
      />

      <div className="relative mx-auto w-full max-w-[720px]">
        <Suspense
          fallback={
            !atBottom ? (
              <button
                type="button"
                onClick={jumpToLatest}
                data-testid="jump-to-latest"
                aria-label="Jump to latest"
                className="absolute -top-12 left-1/2 z-20 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground shadow-lg transition-colors hover:text-foreground focus-visible:ad-focus sm:min-h-0 sm:px-3 sm:py-1.5"
              >
                <ArrowDown className="size-3.5" aria-hidden />
                Jump to latest
              </button>
            ) : null
          }
        >
          <JumpToLatest show={!atBottom} reduce={reduce} onClick={jumpToLatest} />
        </Suspense>

        {/* The honest local-fork banner (Lane D): local means local — the original
            chat is never deleted, and a historical fork's next send is a NEW chat.
            Rendered above the composer so it reads as context for the next send. */}
        {forkBanner && (
          <div
            data-testid="fork-banner"
            role="status"
            className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] leading-snug text-muted-foreground"
          >
            <GitBranch className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
            <span className="min-w-0 flex-1">{forkBanner}</span>
            {onReturnToOriginal && (
              <button
                type="button"
                onClick={onReturnToOriginal}
                data-testid="fork-return"
                className="shrink-0 rounded px-1.5 py-0.5 text-[13px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:ad-focus"
              >
                Return to original chat
              </button>
            )}
          </div>
        )}

        <ChatBlockedNotice
          reason={blocked}
          onConnectModel={onConnectModel}
          startAgentAction={startAgentAction}
        />

        <Composer
          onSend={onSend}
          onStop={onStop}
          running={running}
          models={models}
          model={model}
          onModelChange={onModelChange}
          contextTokens={contextTokens}
          contextLimit={contextLimit}
          disabled={composerDisabled}
          canFlushQueue={canFlushQueue}
          canAttachImages={canAttachImages}
          autoFocus={autoFocusComposer}
          sessionKey={sessionId}
          onNewChat={onNewChat}
          onClearChat={onClearChat}
          onToggleTheme={onToggleTheme}
        />
      </div>
    </div>
  )
}

/** The row-height estimate handed to the virtualizer — also used to seed the
 * scroll offset when bringing an off-window match index into view before the
 * virtualizer measures it. */
const ROW_ESTIMATE = 120

/** The text a turn contributes to find: the user/assistant message body plus
 * any assistant reasoning segments (all visible-ish prose), lower-cased once so
 * matching is case-insensitive without re-allocating per query. */
function turnSearchText(turn: Turn): string {
  if (turn.role === 'user') return turn.content
  // Assistant: the reply text + reasoning segments (tool args are noise here).
  return turn.reasoning.length > 0 ? `${turn.content} ${turn.reasoning.join(' ')}` : turn.content
}

/** One match occurrence, resolved to the turn (for highlight) and its index in
 * the transcript (for the virtualizer scroll). */
interface FindMatch {
  turnId: string
  turnIndex: number
}

export interface FindController {
  open: boolean
  query: string
  matches: readonly FindMatch[]
  activeIndex: number
  /** The id of the turn carrying the active match, or null. */
  activeTurnId: string | null
  openFind: () => void
  close: () => void
  setQuery: (q: string) => void
  next: () => void
  prev: () => void
}

/**
 * Find-in-conversation state + behavior, scoped to ChatView. It computes
 * case-insensitive match occurrences across the rendered turns, tracks the
 * active occurrence, and — composing with `@tanstack/react-virtual` windowing —
 * scrolls the active match into view (seed the scroll offset by index so the
 * virtualizer mounts that row, then `scrollIntoView` the real node). Esc closes
 * and restores the pre-find scroll position.
 */
function useFindInConversation(
  turns: Turn[],
  scrollElRef: React.MutableRefObject<HTMLDivElement | null>,
): FindController {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // The scrollTop captured when find opened, restored on close (Esc) so closing
  // returns the user to where they were reading.
  const restoreTopRef = useRef<number | null>(null)

  const matches = useMemo<FindMatch[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const out: FindMatch[] = []
    turns.forEach((turn, turnIndex) => {
      const hay = turnSearchText(turn).toLowerCase()
      let from = 0
      // Count every (possibly overlapping-free) occurrence so the counter and
      // the steppers match what the user reads — each lands on the same turn.
      for (;;) {
        const at = hay.indexOf(needle, from)
        if (at === -1) break
        out.push({ turnId: turn.id, turnIndex })
        from = at + needle.length
      }
    })
    return out
  }, [turns, query])

  // The active match index, clamped to the live match set at read time (typing
  // narrows results) — so we never store an out-of-range index in an effect.
  const safeIndex = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1)
  const active = safeIndex >= 0 ? matches[safeIndex] : undefined
  const activeTurnId = active?.turnId ?? null

  // Scroll the active match into view, composing with windowing: nudge the scroll
  // element toward the target index (so the virtualizer mounts that row), then
  // scrollIntoView the now-mounted highlighted node. Runs after paint.
  useLayoutEffect(() => {
    if (!open || !active) return
    const el = scrollElRef.current
    const selector = `[data-find-turn="${cssEscape(active.turnId)}"]`
    const center = () => {
      const node = el?.querySelector<HTMLElement>(selector)
      node?.scrollIntoView({ block: 'center', behavior: 'auto' })
      return !!node
    }
    if (el) {
      // Seed the offset by index so an off-window match mounts (the virtualizer
      // re-derives its window from scrollTop); the precise centering follows.
      el.scrollTop = active.turnIndex * ROW_ESTIMATE
    }
    // Center now if the row is already mounted (the common in-window case); if it
    // was off-window, the offset seed above will have mounted it next frame, so
    // retry once after paint to center precisely.
    if (center()) return
    const raf = requestAnimationFrame(center)
    return () => cancelAnimationFrame(raf)
  }, [open, active, safeIndex, scrollElRef])

  const openFind = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) restoreTopRef.current = scrollElRef.current?.scrollTop ?? null
      return true
    })
    setActiveIndex(0)
  }, [scrollElRef])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
    // Restore the reading position the user had before opening find.
    const el = scrollElRef.current
    const top = restoreTopRef.current
    if (el && top != null) el.scrollTop = top
    restoreTopRef.current = null
  }, [scrollElRef])

  // Step from the CLAMPED index so a stale-high stored index (after the match set
  // shrank) still moves predictably; both directions wrap.
  const next = useCallback(() => {
    setActiveIndex((i) => {
      const n = matches.length
      if (n === 0) return 0
      return (Math.min(i, n - 1) + 1) % n
    })
  }, [matches.length])

  const prev = useCallback(() => {
    setActiveIndex((i) => {
      const n = matches.length
      if (n === 0) return 0
      return (Math.min(i, n - 1) - 1 + n) % n
    })
  }, [matches.length])

  // Reset the active match to the first whenever the query changes.
  const setQueryAndReset = useCallback((q: string) => {
    setQuery(q)
    setActiveIndex(0)
  }, [])

  return {
    open,
    query,
    matches,
    activeIndex: safeIndex,
    activeTurnId,
    openFind,
    close,
    setQuery: setQueryAndReset,
    next,
    prev,
  }
}

/** Minimal CSS.escape shim for the attribute selector (turn ids are safe ids in
 * practice, but escape defensively so an exotic id can't break the query). */
function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape
  return fn ? fn(value) : value.replace(/["\\]/g, '\\$&')
}

/**
 * A visually-hidden polite live region that narrates the conversation to screen
 * readers PER TURN (never token-by-token, which would flood). It announces that
 * the assistant is responding when a turn starts streaming, and the finished
 * reply once — when that turn flips out of `streaming`. The message log itself is
 * a plain scroll container that SRs don't narrate; this is its voice (T1.6).
 */
function ChatLiveRegion({ turns, running }: { turns: Turn[]; running: boolean }) {
  const [message, setMessage] = useState('')
  // The id of the assistant turn whose COMPLETION we've already announced, so a
  // re-render (e.g. a later token elsewhere) never re-announces the same reply.
  const announcedDoneId = useRef<string | null>(null)
  // Whether we've announced "responding" for the current streaming turn.
  const respondingId = useRef<string | null>(null)

  // Find the most recent assistant turn — the only one whose state we narrate.
  let lastAssistant: Extract<Turn, { role: 'assistant' }> | null = null
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t && t.role === 'assistant') {
      lastAssistant = t
      break
    }
  }

  // On first mount, treat any already-completed assistant turn (e.g. a resumed
  // session's seeded transcript) as already-announced — we narrate replies that
  // complete DURING this session, never re-read pre-loaded history aloud. This
  // mount-only effect runs before the announcement effect below (declaration
  // order), so the latter sees the seeded watermark and stays silent on mount.
  useEffect(() => {
    if (lastAssistant && !lastAssistant.streaming) {
      announcedDoneId.current = lastAssistant.id
    }
    // Mount-only: intentionally not reacting to later turn changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!lastAssistant) return
    if (lastAssistant.streaming) {
      // Announce "responding" once per streaming turn (not on every token).
      if (respondingId.current !== lastAssistant.id) {
        respondingId.current = lastAssistant.id
        setMessage('Assistant is responding…')
      }
      return
    }
    // The turn has finished streaming: announce its COMPLETION exactly once.
    // We deliberately announce only "Assistant replied." plus a short head —
    // not the whole reply — so long agentic replies don't flood the SR buffer.
    // The full text lives in the focusable role="log" region, which the user can
    // read at their own pace.
    if (announcedDoneId.current !== lastAssistant.id && lastAssistant.content.trim()) {
      announcedDoneId.current = lastAssistant.id
      setMessage(announceReply(lastAssistant.content))
    }
    // Depend on identity + streaming + finished content (not streaming content,
    // so we don't fire per token).
  }, [lastAssistant?.id, lastAssistant?.streaming, lastAssistant])

  // While running with no assistant turn started yet, still say "responding".
  const text = message || (running ? 'Assistant is responding…' : '')

  return (
    <div
      data-testid="chat-live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {text}
    </div>
  )
}

/**
 * The concise per-turn SR announcement for a finished reply. We announce that
 * the assistant replied plus a short (~80-char) head for orientation — never the
 * whole reply, which would flood a screen reader on long agentic answers. The
 * full text is in the focusable role="log" region for the user to read at pace.
 */
const ANNOUNCE_HEAD_MAX = 80
function announceReply(content: string): string {
  const head = content.trim().replace(/\s+/g, ' ')
  if (!head) return 'Assistant replied.'
  if (head.length <= ANNOUNCE_HEAD_MAX) return `Assistant replied. ${head}`
  return `Assistant replied. ${head.slice(0, ANNOUNCE_HEAD_MAX).trimEnd()}…`
}

/**
 * Honest "this chat can't run right now" notice, shown above the composer. Calm
 * (the fork-banner pattern), never an alarming error: 'no-model' offers a one-tap
 * route to connect one; 'unreachable' explains the agent isn't responding and,
 * when the route passed a `startAgentAction` (deck server up, agent down), offers
 * the one-click Start my agent recovery. Without the action the copy stands
 * alone, since a restart call could not land. Renders nothing when ready.
 */
function ChatBlockedNotice({
  reason,
  onConnectModel,
  startAgentAction,
}: {
  reason: 'unreachable' | 'no-model' | null
  onConnectModel?: () => void
  startAgentAction?: ReactNode
}) {
  if (!reason) return null
  const isModel = reason === 'no-model'
  const Icon = isModel ? Boxes : Unplug
  const showStartAgent = !isModel && startAgentAction != null
  return (
    <div
      data-testid="chat-blocked-notice"
      role="status"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] leading-snug text-muted-foreground"
    >
      <Icon className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
      <span className="min-w-0 flex-1">
        {isModel
          ? 'No model connected yet. Connect one to start chatting.'
          : showStartAgent
            ? // The Start button carries the recovery; the long self-help line
              // would only repeat what one click now does.
              "Can't reach your agent right now."
            : "Can't reach your agent right now. Make sure Hermes is running; the chat reconnects on its own."}
      </span>
      {isModel && onConnectModel && (
        <button
          type="button"
          onClick={onConnectModel}
          data-testid="chat-blocked-connect"
          className="shrink-0 rounded px-1.5 py-0.5 text-[13px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:ad-focus"
        >
          Connect a model
        </button>
      )}
      {showStartAgent && <span className="min-w-0">{startAgentAction}</span>}
    </div>
  )
}

function EmptyHero({
  onPick,
  disabled,
  showOrientation = false,
  agent,
}: {
  onPick: (text: string) => void
  disabled?: boolean
  /** Newcomers (not yet onboarded) get one quiet orientation line; experts don't. */
  showOrientation?: boolean
  /** The active agent — a NAMED agent greets in the first person (A1). */
  agent?: ChatAgentIdentity | null
}) {
  // A first-person greeting when the agent is named ("Hi, I'm Sol. What are
  // we working on?"), falling back to the neutral wordmark copy for the unnamed
  // default — honest: chat never invents a name it doesn't have.
  const named = !!agent?.isNamed
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* Identity hero (A1): a NAMED agent's FACE leads the empty state, so a
            blank conversation reads as "your agent, ready" — not an anonymous text
            box. Decorative (the headline names it); never the amber accent (the
            Avatar primitive enforces the neutral `--border-strong` ring). The
            unnamed default has no face/name to surface, so it's omitted. */}
        {named && (
          <span data-testid="empty-hero-avatar" className="shrink-0">
            <Avatar avatarId={agent!.avatarId} name={agent!.friendlyName} size={56} />
          </span>
        )}
        <div className="space-y-1.5">
          <h1 className="font-wordmark text-[28px] leading-tight font-medium tracking-tight text-foreground">
            {named
              ? `Hi, I’m ${agent!.friendlyName}. What are we working on?`
              : 'What are we building?'}
          </h1>
          {/* One honest line for a named agent — presence, never a fabricated
              status or capability. Falls back to the neutral invite otherwise. */}
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {named
              ? 'Ready when you are.'
              : 'Ask anything, or pick a prompt to start a conversation with your agent.'}
          </p>
          {showOrientation && (
            <p
              data-testid="chat-orientation"
              className="mx-auto max-w-md text-[13px] leading-relaxed text-foreground-tertiary"
            >
              Replies stream in live. You can stop or steer at any time.
              {/* The shortcut sentence is keyboard-only guidance: hidden on
                  touch/coarse-pointer devices where there is no ⌘K to press. */}
              <span className="pointer-coarse:hidden">
                {' '}
                Press <kbd className="font-sans">⌘K</kbd> for commands.
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {EXAMPLE_PROMPTS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="ad-surface ad-surface-hover group/prompt flex flex-col gap-2 rounded-xl bg-surface-1 px-3.5 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:ad-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon
              className="size-4 text-foreground-tertiary transition-colors group-hover/prompt:text-muted-foreground"
              aria-hidden
            />
            <span className="text-[13px] leading-snug text-muted-foreground transition-colors group-hover/prompt:text-foreground">
              {text}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

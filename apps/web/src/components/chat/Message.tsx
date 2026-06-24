import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Copy, GitBranch, Pencil, RefreshCw, Square, Volume2, X } from 'lucide-react'
import type { RunAttachment } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import type { Turn } from '@/state/chatStore'
import { ChatImage } from './ChatImage'
import { Avatar } from '@/components/ui/avatar'
import { useSpeechSynthesis, useVoicePrefs } from '@/features/voice'
import { useReasoningVerbosity } from '@/features/reasoning/reasoningPrefs'
import type { ChatAgentIdentity } from './chatIdentity'
import { Markdown } from './Markdown'
import { RunReceiptLine } from './RunReceiptLine'
import { ToolCardGroup } from './ToolCardGroup'
import { ReasoningBlock } from './ReasoningBlock'
import { PlanCard } from './PlanCard'
import { RefinementRow } from './RefinementRow'
import { ToolStatusChip } from './ToolStatusChip'

/**
 * One conversation turn.
 *  - user: a soft surface card, right-aligned, max-width-constrained. Hovering
 *    reveals Copy + Edit (edit-and-resend trims later turns and re-runs, T1.4).
 *  - assistant: full-width prose via <Markdown>, with tool chips + a thinking
 *    disclosure. A pulsing sky-blue caret trails the text while streaming. Hovering
 *    a finished turn reveals Copy + Retry (re-run the prompting user turn, T1.4).
 * The hover meta row also shows a relative timestamp when known (T3.5).
 */
type MessageProps = {
  turn: Turn
  /** Retry/Regenerate this assistant turn. */
  onRetry?: (assistantTurnId: string) => void
  /** Edit-and-resend this user turn with new text. */
  onEdit?: (userTurnId: string, newText: string) => void
  /** Send a follow-up prompt (used by the refinement row). */
  onSend?: (text: string) => void
  /** Fork a new local branch rooted at THIS settled turn (Lane D). Non-
   * destructive: the original continuation stays reachable. Offered only on
   * settled (non-streaming) turns; disabled while a run is in flight. */
  onFork?: (turnId: string) => void
  /** Suppress actions while a run is in flight / disconnected. */
  actionsDisabled?: boolean
  /** The active agent's identity — its face shows in the gutter at the start of a
   * consecutive assistant group (A1). */
  agent?: ChatAgentIdentity | null
  /** Whether to render the agent's face in the gutter for THIS turn (the group
   * start). The caller groups consecutive assistant turns so the face shows once
   * per group, never per bubble; user turns never carry a gutter face. */
  showAvatar?: boolean
  /** Show the refinement row (Retry / Shorter / More detail / Copy) on the LAST
   * completed assistant turn. The caller is responsible for setting this only on
   * the truly last turn so exactly one row appears. */
  showRefinement?: boolean
  /** Find-in-conversation: when set, occurrences of this (case-insensitive) query
   * are <mark>-highlighted — in a USER turn's plain text directly, and in
   * ASSISTANT prose via a rehype HAST pass (skipping code/KaTeX/links). */
  highlightQuery?: string
  /** Whether THIS turn carries the active find match (its marks read as active). */
  highlightActive?: boolean
  /** Server-derived period billing mode (the Usage summary's `billingMode`),
   * threaded down for the per-run receipt line's billing segment. Absent /
   * unresolved → the receipt renders tokens only (never implies "free"). */
  receiptBillingMode?: string
}

function MessageImpl({
  turn,
  onRetry,
  onEdit,
  onSend,
  onFork,
  actionsDisabled = false,
  agent,
  showAvatar = false,
  showRefinement = false,
  highlightQuery,
  highlightActive = false,
  receiptBillingMode,
}: MessageProps) {
  if (turn.role === 'user') {
    return (
      <UserMessage
        turn={turn}
        onEdit={onEdit}
        onFork={onFork}
        actionsDisabled={actionsDisabled}
        highlightQuery={highlightQuery}
        highlightActive={highlightActive}
      />
    )
  }
  return (
    <AssistantMessage
      turn={turn}
      onRetry={onRetry}
      onSend={onSend}
      onFork={onFork}
      actionsDisabled={actionsDisabled}
      agent={agent}
      showAvatar={showAvatar}
      showRefinement={showRefinement}
      highlightQuery={highlightQuery}
      highlightActive={highlightActive}
      receiptBillingMode={receiptBillingMode}
    />
  )
}

/**
 * One conversation turn, MEMOIZED. Every row of the transcript is a <Message>, so
 * an unmemoized export would re-render ALL visible rows on each streaming token
 * (the parent re-renders on every store update). React.memo with this comparator
 * keeps settled rows static while the ONE actively-streaming turn still re-renders
 * per token — because:
 *  - The store appends tokens IMMUTABLY (`{ ...turn, content: turn.content + delta }`),
 *    so the streaming turn gets a NEW `turn` object each token; a reference check on
 *    `turn` re-renders it (and only it) every token. Settled rows keep their object
 *    identity, so they skip.
 *  - We compare every DISPLAY-affecting prop (the highlight pair, agent identity,
 *    avatar/refinement flags, actionsDisabled) by value.
 *  - We deliberately IGNORE the IDENTITY of the action callbacks (onRetry/onEdit/
 *    onSend/onFork) — the parent's handlers are useCallback'd but their identity
 *    still flips when the model selection changes, which must NOT re-render the
 *    whole transcript. We DO compare callback PRESENCE (handler ⇄ undefined), since
 *    that toggles whether the Retry/Edit/Fork/refinement affordances render.
 */
export const Message = memo(MessageImpl, areMessagePropsEqual)

/** True ⇒ props are equivalent ⇒ React.memo skips the re-render. See {@link Message}. */
function areMessagePropsEqual(prev: MessageProps, next: MessageProps): boolean {
  return (
    // `turn` identity changes immutably on every streaming token + any edit, so a
    // reference check is the live-update signal (the active turn re-renders; the
    // rest stay put).
    prev.turn === next.turn &&
    prev.actionsDisabled === next.actionsDisabled &&
    prev.agent === next.agent &&
    prev.showAvatar === next.showAvatar &&
    prev.showRefinement === next.showRefinement &&
    prev.highlightQuery === next.highlightQuery &&
    prev.highlightActive === next.highlightActive &&
    prev.receiptBillingMode === next.receiptBillingMode &&
    // Callback PRESENCE (not identity): a handler appearing/disappearing changes
    // which actions render, but a stable-purpose handler's changing identity must
    // not re-render the whole list.
    Boolean(prev.onRetry) === Boolean(next.onRetry) &&
    Boolean(prev.onEdit) === Boolean(next.onEdit) &&
    Boolean(prev.onSend) === Boolean(next.onSend) &&
    Boolean(prev.onFork) === Boolean(next.onFork)
  )
}

/** The shared "Fork from here" action — offered only on settled turns. A new
 * local branch is rooted here; the original continuation stays reachable. */
function ForkButton({
  turnId,
  onFork,
  disabled,
}: {
  turnId: string
  onFork: (turnId: string) => void
  disabled?: boolean
}) {
  return (
    <ActionButton
      onClick={() => onFork(turnId)}
      label="Fork from here"
      // Fork and Edit sit side by side and read alike, so newcomers click Fork
      // expecting Edit. This tooltip makes the difference explicit: forking
      // branches off to try a different direction and KEEPS the original intact
      // (unlike Edit, which rewrites this message in place). The accessible name
      // stays "Fork from here" (the branching e2e finds the button by it).
      title="Branch off to try a different direction from here; your original chat is kept"
      disabled={disabled}
    >
      <GitBranch className="size-3.5" />
      Fork
    </ActionButton>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onClick = async () => {
    try {
      await navigator.clipboard?.writeText(text)
      toast.success('Copied to clipboard')
    } catch {
      // clipboard may be unavailable; still flash feedback
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  return (
    <ActionButton onClick={onClick} label={copied ? 'Copied' : 'Copy message'}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </ActionButton>
  )
}

/**
 * "Speak" affordance for an assistant turn (spec, voice feature 2: voice
 * output / TTS). Reads the message text aloud via the browser's speech
 * synthesis; toggles to "Stop" while speaking. Renders nothing when the
 * platform has no synthesis support so the action row stays clean.
 */
function SpeakButton({ text }: { text: string }) {
  const { supported, speaking, speak, cancel } = useSpeechSynthesis()
  if (!supported) return null
  return (
    <ActionButton
      onClick={() => (speaking ? cancel() : speak(text))}
      label={speaking ? 'Stop speaking' : 'Speak message'}
    >
      {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
      {speaking ? 'Stop' : 'Speak'}
    </ActionButton>
  )
}

/** A small hover-revealed action button (Copy / Retry / Edit / Fork) — uniform
 * face. An optional `title` supplies a sighted-only tooltip (e.g. to explain how
 * Fork differs from Edit); the accessible name stays `label`. */
function ActionButton({
  onClick,
  label,
  title,
  disabled,
  children,
}: {
  onClick: () => void
  label: string
  /** Optional hover tooltip for sighted users; does not affect the a11y name. */
  title?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-foreground-tertiary transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-40 sm:min-h-10 sm:px-1.5"
    >
      {children}
    </button>
  )
}

/** The hover-revealed meta row: timestamp + actions. Revealed on turn hover/
 * focus-within so the conversation stays calm (T3.5). */
function MetaRow({ createdAt, children }: { createdAt?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover/turn:opacity-100 group-focus-within/turn:opacity-100">
      {children}
      <Timestamp createdAt={createdAt} />
    </div>
  )
}

/** A quiet relative timestamp ("just now", "5m ago", or an absolute date for
 * older turns). Renders nothing when the time is unknown — never fabricated. */
function Timestamp({ createdAt }: { createdAt?: number }) {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  const label = formatRelative(createdAt)
  return (
    <time
      dateTime={new Date(createdAt).toISOString()}
      title={new Date(createdAt).toLocaleString()}
      className="text-xs text-foreground-tertiary tabular-nums"
    >
      {label}
    </time>
  )
}

function UserMessage({
  turn,
  onEdit,
  onFork,
  actionsDisabled,
  highlightQuery,
  highlightActive = false,
}: {
  turn: Extract<Turn, { role: 'user' }>
  onEdit?: (userTurnId: string, newText: string) => void
  onFork?: (turnId: string) => void
  actionsDisabled: boolean
  highlightQuery?: string
  highlightActive?: boolean
}) {
  const [editing, setEditing] = useState(false)

  if (editing && onEdit) {
    return (
      <UserEditor
        turn={turn}
        onCancel={() => setEditing(false)}
        onSubmit={(text) => {
          setEditing(false)
          onEdit(turn.id, text)
          toast.success('Resending edited message')
        }}
      />
    )
  }

  const attachments = userAttachments(turn)

  return (
    <div className="group/turn flex flex-col items-end gap-1 py-1.5">
      {attachments.length > 0 && <UserAttachments attachments={attachments} />}
      {/* An image-only turn (text empty + an image attached) shows just the
          image — no empty text bubble. Any other turn (prose, or a degenerate
          empty turn with no image) keeps its bubble exactly as before. */}
      {(turn.content.length > 0 || attachments.length === 0) && (
        <div className="ad-surface max-w-[85%] rounded-xl rounded-tr-md bg-surface-2 px-3.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
          <HighlightText text={turn.content} query={highlightQuery} active={highlightActive} />
        </div>
      )}
      <MetaRow createdAt={turn.createdAt}>
        <CopyButton text={turn.content} />
        {onEdit && (
          <ActionButton
            onClick={() => setEditing(true)}
            label="Edit and resend"
            // Contrast with Fork: Edit REWRITES this message in place and re-runs
            // from here, dropping the replies that followed it.
            title="Rewrite this message and resend; replaces what came after it"
            disabled={actionsDisabled}
          >
            <Pencil className="size-3.5" />
            Edit
          </ActionButton>
        )}
        {onFork && <ForkButton turnId={turn.id} onFork={onFork} disabled={actionsDisabled} />}
      </MetaRow>
    </div>
  )
}

/**
 * The image attachments the user sent on this turn, if any. The transport carries
 * them as protocol {@link RunAttachment}s; we read them defensively (the field is
 * optional on a user turn) so a turn without attachments renders exactly as before
 * — no fabricated state. Each `data_url` is re-validated here against the same safe
 * raster-image allow-list the gateway enforces, so only a `data:image/<raster>`
 * source ever reaches an `<img>` — a future history/wire path that seeds
 * attachments without re-validating can't smuggle an unsafe scheme through.
 */
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|avif|bmp|tiff);/i
function userAttachments(turn: Extract<Turn, { role: 'user' }>): RunAttachment[] {
  const raw = (turn as { attachments?: unknown }).attachments
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (a): a is RunAttachment =>
      a != null &&
      typeof a === 'object' &&
      typeof (a as RunAttachment).data_url === 'string' &&
      SAFE_IMAGE_DATA_URL.test((a as RunAttachment).data_url),
  )
}

/**
 * The user's sent image(s), shown in their bubble so a sent image stays visible
 * after send (not just a "Sent an image" label). One image renders as a single
 * constrained thumbnail; several lay out in a compact two-up grid. Each enlarges
 * in the lightbox; the accessible alt comes from the attachment's name.
 */
function UserAttachments({ attachments }: { attachments: RunAttachment[] }) {
  return (
    <div
      className={cn(
        'grid max-w-[85%] gap-1.5',
        attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
      )}
    >
      {attachments.map((att, i) => (
        <ChatImage
          // data_url is stable for the turn's lifetime; index disambiguates repeats.
          key={`${att.name}-${i}`}
          src={att.data_url}
          alt={att.name || 'Sent image'}
          className="max-h-60"
        />
      ))}
    </div>
  )
}

/** Inline edit-and-resend editor for a user turn. */
function UserEditor({
  turn,
  onCancel,
  onSubmit,
}: {
  turn: Extract<Turn, { role: 'user' }>
  onCancel: () => void
  onSubmit: (text: string) => void
}) {
  const [value, setValue] = useState(turn.content)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Focus + place the caret at the end when the editor opens.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // Auto-grow to fit the edited content.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  const canSubmit = value.trim().length > 0
  const submit = () => {
    if (canSubmit) onSubmit(value)
  }

  return (
    <div className="group/turn flex flex-col items-end gap-1.5 py-1.5">
      <div className="ad-surface flex w-full max-w-[85%] flex-col gap-2 rounded-xl rounded-tr-md bg-surface-2 p-2.5">
        <textarea
          ref={ref}
          value={value}
          aria-label="Edit message"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-[240px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-foreground outline-none"
        />
        <div className="flex items-center justify-end gap-1.5">
          <ActionButton onClick={onCancel} label="Cancel edit">
            <X className="size-3.5" />
            Cancel
          </ActionButton>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'inline-flex h-11 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:ad-focus sm:h-10 sm:px-2.5',
              'disabled:cursor-not-allowed disabled:bg-primary/15 disabled:text-primary/60',
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({
  turn,
  onRetry,
  onSend,
  onFork,
  actionsDisabled,
  agent,
  showAvatar,
  showRefinement,
  highlightQuery,
  highlightActive = false,
  receiptBillingMode,
}: {
  turn: Extract<Turn, { role: 'assistant' }>
  onRetry?: (assistantTurnId: string) => void
  onSend?: (text: string) => void
  onFork?: (turnId: string) => void
  actionsDisabled: boolean
  agent?: ChatAgentIdentity | null
  showAvatar?: boolean
  showRefinement?: boolean
  /** Find-in-conversation query; <mark>-highlighted in the rendered prose. */
  highlightQuery?: string
  /** Whether THIS turn carries the active find match (marks read as accent). */
  highlightActive?: boolean
  /** Period billing mode for the receipt line's billing segment. */
  receiptBillingMode?: string
}) {
  const hasText = turn.content.length > 0
  const { verbosity } = useReasoningVerbosity()
  const detailed = verbosity === 'detailed'
  const hasTools = turn.toolCalls.length > 0
  // The agent's face rides the gutter only at a GROUP start (showAvatar) and only
  // when an identity is resolved. A reserved 24px gutter keeps every assistant
  // turn — face or continuation — on one consistent left margin.
  const gutterAgent = agent ?? null

  // The live running tool (if any) — first running call in this turn.
  const runningTool = turn.toolCalls.find((c) => c.status === 'running')
  // Step number = count of all tool calls so far (including the running one).
  // This is real data from the wire, never fabricated.
  const runningToolStep = runningTool
    ? turn.toolCalls.findIndex((c) => c === runningTool) + 1
    : undefined

  useAutoSpeak(turn)

  // The always-visible RefinementRow (Retry / Shorter / More detail / Copy) shows
  // on the last completed turn when its handlers are wired. When it does, Retry +
  // Copy live there — so the hover MetaRow drops those two to avoid a duplicate
  // Retry/Copy on the same turn, keeping only Speak + Fork (which the row lacks).
  // Every action stays reachable exactly once.
  const refinementShown =
    showRefinement && !turn.streaming && hasText && Boolean(onSend) && Boolean(onRetry)

  return (
    <div className="group/turn flex gap-2.5 py-1.5">
      {/* Identity gutter (A1): the agent's face, once per consecutive group. The
          face is IDENTITY — never the sky-blue accent (the Avatar primitive enforces
          the `--border-strong` ring + neutral fallback). aria-hidden via the
          decorative Avatar; the live region still narrates "Assistant replied". */}
      {gutterAgent ? (
        <div className="w-6 shrink-0 pt-0.5" aria-hidden>
          {showAvatar ? (
            <span data-testid="assistant-avatar">
              <Avatar avatarId={gutterAgent.avatarId} name={gutterAgent.name} size={24} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Item 4: PlanCard — only when a reasoning block exists (real wire data).
            Shown BEFORE tool calls, as a proposed plan the agent is about to execute. */}
        {turn.reasoning.length > 0 && turn.streaming && !hasText && (
          <PlanCard segments={turn.reasoning} />
        )}

        {/* Item 5 (streaming dots ORDER fix): the live status indicator comes FIRST
            in the DOM so a streaming turn reads as "in-progress", not "done, now idle".
            The ToolStatusChip is visible only while a tool is running (status check
            inside the component). The ad-dots/ad-caret renders directly below it when
            there is no tool chip (streaming with no tools yet). */}
        {turn.streaming && runningTool && (
          <ToolStatusChip
            tool={runningTool.tool}
            status={runningTool.status}
            stepNumber={runningToolStep}
          />
        )}
        {turn.streaming && !hasText && !runningTool && (
          // No tokens, no running tool — pulsing dots while we wait for first
          // content. A NAMED agent names the wait ("<name> is thinking…") in both
          // the accessible label AND a visible caption, so the face is felt even
          // before the first token; the unnamed default stays the generic
          // "Thinking" (never a fabricated name). The dots motion is the live
          // accent (allowed); the caption text is neutral identity, not the accent.
          <span className="flex items-center gap-2" role="status">
            <span
              className="ad-dots"
              data-testid="stream-caret"
              aria-label={agent?.isNamed ? `${agent.friendlyName} is thinking…` : 'Thinking'}
            >
              <span />
              <span />
              <span />
            </span>
            {agent?.isNamed && (
              <span aria-hidden className="text-xs text-foreground-tertiary">
                {agent.friendlyName} is thinking…
              </span>
            )}
          </span>
        )}

        {/* Reasoning block (collapsed by default, expandable) — shown after the live
            indicator so the plan context is established first. */}
        {turn.reasoning.length > 0 && !(turn.streaming && !hasText) && (
          <ReasoningBlock segments={turn.reasoning} defaultOpen={detailed} />
        )}

        {hasTools && <FirstToolCaption />}
        <ToolCardGroup calls={turn.toolCalls} defaultOpen={detailed} />

        {hasText && (
          // aria-live="polite" aria-atomic="false" while streaming so screen readers
          // announce content updates without spamming per-token. The data-streaming
          // attribute gates the live region — only present while actively streaming
          // so finished turns don't keep re-announcing on re-renders.
          <div
            className="relative"
            {...(turn.streaming
              ? { 'aria-live': 'polite', 'aria-atomic': 'false', 'data-streaming': '' }
              : {})}
          >
            <Markdown highlightQuery={highlightQuery} highlightActive={highlightActive}>
              {turn.content}
            </Markdown>
            {turn.streaming && <span className="ad-caret" data-testid="stream-caret" aria-hidden />}
          </div>
        )}

        {/* The per-run receipt: what this completed run cost, honestly. Renders
            only when the run's terminal frame carried usage (exact per-run
            tokens from the gateway); a turn without usage — e.g. one seeded
            from history, where hermes persists no per-run numbers — simply has
            no receipt. Part of the turn footer, so no live region. */}
        {!turn.streaming && (
          <RunReceiptLine
            usage={turn.usage}
            billingMode={receiptBillingMode}
            duration={turn.duration}
          />
        )}

        {!turn.streaming && hasText && (
          <MetaRow createdAt={turn.createdAt}>
            {/* When the RefinementRow is shown it already carries Copy + Retry, so
                the hover MetaRow omits both here and keeps only Speak + Fork — each
                action reachable exactly once. */}
            {!refinementShown && <CopyButton text={turn.content} />}
            <SpeakButton text={turn.content} />
            {!refinementShown && onRetry && (
              <ActionButton
                onClick={() => {
                  onRetry(turn.id)
                  toast.success('Regenerating response')
                }}
                label="Regenerate response"
                disabled={actionsDisabled}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </ActionButton>
            )}
            {onFork && <ForkButton turnId={turn.id} onFork={onFork} disabled={actionsDisabled} />}
          </MetaRow>
        )}

        {/* Item 3: Refinement row — VISIBLE (not hover-only) on the last completed
            assistant turn. Each action composes a real follow-up and sends via the
            normal run path. Suppressed while streaming, or when no handlers are wired. */}
        {showRefinement && !turn.streaming && hasText && onSend && onRetry && (
          <RefinementRow
            messageText={turn.content}
            onSend={onSend}
            onRetry={() => onRetry(turn.id)}
            disabled={actionsDisabled}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Render plain text with every case-insensitive occurrence of `query` wrapped in
 * a <mark> (find-in-conversation, T-find). With no query (or an empty one) the
 * text renders verbatim — byte-identical to a bare string — so a non-find render
 * is unchanged. The marks on the turn carrying the ACTIVE match read with the
 * accent (an active marker is an allowed accent use); other matched turns use a
 * neutral tint so the column stays calm. <mark> is itself a semantic landmark a
 * screen reader can expose.
 */
function HighlightText({
  text,
  query,
  active = false,
}: {
  text: string
  query?: string
  active?: boolean
}) {
  const needle = query?.trim().toLowerCase() ?? ''
  if (needle.length === 0) return <>{text}</>
  const hay = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let key = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) {
      parts.push(text.slice(from))
      break
    }
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark
        key={key++}
        className={cn(
          'rounded-[3px] text-foreground',
          active ? 'bg-primary/30' : 'bg-foreground/15',
        )}
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
  }
  // No occurrence found (the active turn may match in assistant prose only) —
  // fall back to the verbatim text so we never render an empty fragment.
  if (parts.length === 0) return <>{text}</>
  return <>{parts}</>
}

/** sessionStorage key gating the one-time first-tool teaching caption. */
const FIRST_TOOL_CAPTION_KEY = 'agent-deck-first-tool-caption-seen'

/**
 * A single, calm teaching moment shown above the FIRST turn that uses tools in a
 * session: it tells a newcomer the chips below are the tools the agent ran. It
 * is sessionStorage-gated so it appears exactly once and never nags afterwards.
 * The caption claims the gate on mount, so a later tool-bearing turn stays quiet.
 */
function FirstToolCaption() {
  const [show] = useState(() => {
    if (typeof sessionStorage === 'undefined') return true
    if (sessionStorage.getItem(FIRST_TOOL_CAPTION_KEY)) return false
    try {
      sessionStorage.setItem(FIRST_TOOL_CAPTION_KEY, '1')
    } catch {
      // Storage may throw (private mode / quota); still show it this once.
    }
    return true
  })
  if (!show) return null
  return (
    <p className="text-[11px] text-foreground-tertiary">Tools used to complete your request:</p>
  )
}

/**
 * Auto-speak a freshly-COMPLETED assistant turn once when the `autoSpeak` voice
 * pref is on (spec, voice feature 2). Fires only on the streaming→done
 * transition observed by this live component — never on mount/history replay
 * (where the turn is already `streaming: false`), never mid-stream, and exactly
 * once per completion. The pref is read at the moment of completion (not on
 * mount), so toggling it later won't retroactively replay finished turns.
 */
function useAutoSpeak(turn: Extract<Turn, { role: 'assistant' }>) {
  const { supported, speak } = useSpeechSynthesis()
  const { autoSpeak } = useVoicePrefs()

  // Whether we've ever seen THIS turn actively streaming. A turn that mounts
  // already-finished (history replay) never set this, so it must not speak.
  const sawStreamingRef = useRef(false)
  // Guard so a single completion speaks at most once even across re-renders.
  const spokeRef = useRef(false)

  // Keep the latest speak/pref/supported readable from the effect without
  // widening its dependency list (which would re-run on unrelated changes).
  const latest = useRef({ supported, speak, autoSpeak })
  useEffect(() => {
    latest.current = { supported, speak, autoSpeak }
  })

  useEffect(() => {
    if (turn.streaming) {
      sawStreamingRef.current = true
      return
    }
    // Reached the finished state. Speak iff we watched this very turn stream to
    // completion (so mount-with-finished-history is excluded) and haven't yet.
    if (!sawStreamingRef.current || spokeRef.current) return
    spokeRef.current = true
    const { supported: sup, speak: say, autoSpeak: on } = latest.current
    if (on && sup && turn.content) say(turn.content)
  }, [turn.streaming, turn.content])
}

/** Relative time for the hover timestamp: "just now" → "Nm ago" → "Nh ago" →
 * absolute date for anything older than a day. */
function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

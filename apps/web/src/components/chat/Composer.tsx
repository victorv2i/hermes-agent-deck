import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from 'lucide-react'
import type { RunAttachment } from '@agent-deck/protocol'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// The Send/Stop morph is the composer's ONLY framer-motion user. Lazy-load it so
// framer-motion ships in a deferred chunk instead of the eager entry bundle (the
// composer is reachable on first paint via the non-lazy ChatRoute). The Suspense
// fallback below renders the same button without animation until it loads.
const SendStopButton = lazy(() =>
  import('./ComposerMotion').then((m) => ({ default: m.SendStopButton })),
)
import { ContextRing } from './ContextRing'
import { ModelPicker } from './ModelPicker'
import {
  filterSlashCommands,
  slashQuery,
  SLASH_COMMANDS,
  type SlashActionId,
  type SlashCommand,
} from '@/components/command/slashCommands'
import type { ModelEntry } from '@/features/models/types'
import { useDictation } from '@/features/voice'
import { useDraft } from '@/features/chat-input/draftStore'
import { useSendKeyPref, shouldSend } from '@/features/chat-input/sendKeyPref'
import { useMessageQueue } from '@/features/chat-input/messageQueue'
import { MentionPicker } from '@/features/chat-input/MentionPicker'
import { useFileMentions } from '@/features/chat-input/useFileMentions'
import {
  fileToAttachment,
  imageFilesFromClipboard,
  imageFilesFromDrop,
  toRunAttachment,
  type PendingAttachment,
} from '@/features/chat-input/imageAttachments'
import { toast } from '@/lib/toast'

const MAX_TEXTAREA_PX = 200

/**
 * The single, honest message for the "active model has no vision" case. Used for
 * BOTH the disabled attach button's tooltip/accessible name AND the paste/drop
 * toast, so the same situation never speaks two different ways. Keeps the
 * `can’t see images` phrase the tests key on.
 */
const NO_VISION_MESSAGE = 'This model can’t see images. Switch to a vision-capable model to attach.'

/**
 * The single, honest message for "a run is in flight" image handling. Text typed
 * mid-run queues (C2), but image turns are deliberately NOT queued - so instead
 * of silently firing an overlapping run (the old behavior) or silently dropping
 * the image, attach/paste/drop are disabled mid-run with this one message on
 * the tooltip AND the paste/drop toast.
 */
const RUNNING_ATTACH_MESSAGE =
  'A reply is still streaming. Image messages can’t be queued; send the image when it finishes.'

/**
 * Detect an in-progress `@`-mention at the caret. Returns the token's start
 * index and the query text (after the `@`), or null when the caret is not inside
 * a mention token. A mention starts at `@` that is either at the very start of
 * the text or preceded by whitespace, and runs up to the caret with no
 * intervening whitespace - so an email address (`a@b`) or a settled reference
 * never re-opens the picker.
 */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  // Scan back from the caret to the nearest `@`; bail on whitespace (token end).
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') {
      const before = i === 0 ? '' : value[i - 1]
      if (i === 0 || /\s/.test(before ?? '')) {
        return { start: i, query: value.slice(i + 1, caret) }
      }
      return null
    }
    if (ch && /\s/.test(ch)) return null
  }
  return null
}

export function Composer({
  onSend,
  onStop,
  running = false,
  models = [],
  model = null,
  onModelChange,
  contextTokens = 0,
  contextLimit,
  disabled = false,
  canFlushQueue = true,
  canAttachImages = false,
  floating = true,
  autoFocus = false,
  sessionKey,
  onNewChat,
  onClearChat,
  onToggleTheme,
  onOpenUsage,
}: {
  /** Submit the trimmed message plus any image attachments. The composer clears
   * itself (text + attachments) on success. `attachments` is omitted when none
   * are present, so a plain text send is byte-identical to before. */
  onSend: (text: string, attachments?: RunAttachment[]) => void
  /** Abort the in-flight run (the send button becomes Stop while running). */
  onStop: () => void
  /** True while a run is streaming - flips Send → Stop. */
  running?: boolean
  /** The gateway's model list for the picker (omit/empty hides the picker). */
  models?: ModelEntry[]
  /** The currently-selected model id (drives the picker chip + the run model). */
  model?: string | null
  /** Commit a model selection (persisted + sent with the next run by the host). */
  onModelChange?: (id: string) => void
  /** Tokens consumed so far, for the context ring. */
  contextTokens?: number
  /** The model's real context window, when known (else the ring is honest /
   * approximate - see {@link ContextRing}). */
  contextLimit?: number
  /** Disable input entirely (e.g. socket disconnected). */
  disabled?: boolean
  /**
   * Whether it is honest to auto-flush a queued message right now. False when the
   * connection is down OR the last run ended in error/cancellation - flushing then
   * would fire the queued message into a dead or just-failed channel. The queue
   * holds the message instead, and flushes once this turns true again (reconnect /
   * a clean run). Defaults to true (always-flush).
   */
  canFlushQueue?: boolean
  /**
   * Whether the active model can accept images (vision). When false the attach
   * button is shown DISABLED with an honest tooltip and paste/drop are ignored -
   * we never silently swallow an image the agent can't see (HONEST UI). Defaults
   * to false so a host that doesn't know the capability shows no false promise.
   */
  canAttachImages?: boolean
  /** Pinned to the conversation floor (sticky + shadow). The empty hero renders
   *  it inline (false) so it composes with the prompt cards above it. */
  floating?: boolean
  /**
   * Move keyboard focus into the message input once, on first mount. Used by the
   * first-run hand-off from Home (a starter prompt lands the cursor in the
   * composer ready to send/edit). Honors the textarea's own disabled state.
   */
  autoFocus?: boolean
  /**
   * The active session id, used to key the persisted draft (see {@link useDraft}).
   * Null/undefined (the unsent "new chat" composer) maps to the `:new` sentinel,
   * so a typed-but-unsent message survives a reload there too.
   */
  sessionKey?: string | null
  /**
   * Slash-command UI actions. The composer's `/` menu offers a command ONLY
   * when its handler is wired here, so the menu never shows an inert row.
   * `/model` is self-contained (opens the picker), so it needs no handler - only
   * models + onModelChange.
   */
  onNewChat?: () => void
  onClearChat?: () => void
  onToggleTheme?: () => void
  /** Open the Usage view (for `/usage`). Wired by the host to its router. */
  onOpenUsage?: () => void
}) {
  // The composer text is the per-session DRAFT: seeded from storage on mount,
  // persisted (debounced) on change, cleared on send. `value`/`setValue` below
  // wrap it so the rest of the component reads exactly as before.
  const { draft: value, setDraft: setDraftValue, clear: clearDraft } = useDraft(sessionKey)
  const setValue = setDraftValue
  const ref = useRef<HTMLTextAreaElement>(null)

  // Send-while-busy queue (C2): while a run is in flight the composer holds the
  // message in a FIFO queue (shown as "Queued" pills) instead of blocking, and the
  // queue auto-flushes the head - one at a time - via onSend when the run
  // completes. A thin layer over the run pump: it only observes `running` and
  // fires the existing onSend (text-only; queuing image turns is out of scope).
  const queue = useMessageQueue({
    running,
    send: onSend,
    canFlush: canFlushQueue,
    // Key the queue to the conversation so a message queued in one chat can never
    // flush into another after a New chat / session switch (see useMessageQueue).
    conversationId: sessionKey,
  })
  // Programmatic open of the ModelPicker (for `/model`): we click its trigger.
  const modelPickerWrapRef = useRef<HTMLDivElement>(null)
  // The slash menu's highlighted row index, and a one-shot dismissal so Esc
  // closes the menu without clearing the text (it can then be sent verbatim).
  const [slashHighlight, setSlashHighlight] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)

  // The user's Enter-vs-⌘Enter send preference (module store; shared with Settings).
  const { pref: sendKeyPref } = useSendKeyPref()

  // --- Voice DICTATION (Web Speech) ---------------------------------------------
  // Dictation fills the composer text from the user's speech (they still review +
  // send). The mic is always RENDERED; when dictation can't run (no Web Speech
  // API, or an insecure origin) it is shown DISABLED with an honest tooltip
  // (`unavailableReason`) rather than hidden, so the user understands why. Each
  // result chunk delivers the FULL running transcript, so we append the latest
  // chunk's text to the value present when recording began (tracked in a ref so
  // the interim stream replaces, rather than duplicates, the prior interim).
  const recordBaseRef = useRef('')
  const speech = useDictation({
    onResult: ({ transcript }) => {
      const base = recordBaseRef.current
      const joiner = base.length > 0 && !/\s$/.test(base) ? ' ' : ''
      setValue(base + joiner + transcript)
    },
    // Surface a failed mic so dictation never fails silently. Benign codes
    // (no-speech / aborted on stop) are ignored. A permission denial toasts, and a
    // server-side transcription failure (Web Speech absent → recorded clip path)
    // toasts honestly too.
    onError: (err) => {
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        toast.error('Microphone access is blocked. Allow it in your browser to dictate.')
      } else if (err === 'transcribe-failed') {
        toast.error('Couldn’t transcribe that recording. Check the agent’s speech-to-text setup.')
      } else if (err === 'no-recorder') {
        toast.error('This browser can’t record audio for voice input.')
      }
    },
  })

  const toggleRecording = () => {
    // While a recorded clip is being transcribed (server path), the toggle is a
    // no-op - the cycle finishes on its own and fills the text.
    if (speech.transcribing) return
    if (speech.recording) {
      speech.stop()
      return
    }
    recordBaseRef.current = value
    speech.start()
    ref.current?.focus()
  }

  // --- Image attachments (attach / paste / drag-drop) ---------------------------
  // Pending image attachments shown as removable pills above the input and carried
  // on the next send as native multimodal content. Stock hermes routes vision
  // inline (data:image/... URLs) - there is NO upload endpoint, so an attachment
  // is just the base64 data URL. Gated on `canAttachImages`: when the active model
  // can't see, attach is disabled (honest) and paste/drop are ignored.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)
  // A hidden native file input behind the attach button (multiple image files).
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Nested dragenter/dragleave fire as the pointer crosses children; a depth
  // counter keeps the drop zone highlighted until the drag truly leaves.
  const dragDepth = useRef(0)

  // Read each File into a pending attachment, surfacing an honest toast for any
  // rejected file (non-image / too-large / unreadable) rather than swallowing it.
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return
    const results = await Promise.all(files.map(fileToAttachment))
    const accepted: PendingAttachment[] = []
    let rejectedNotImage = 0
    let rejectedTooLarge = 0
    let rejectedRead = 0
    for (const r of results) {
      if (r.attachment) accepted.push(r.attachment)
      else if (r.reject === 'not-image') rejectedNotImage += 1
      else if (r.reject === 'too-large') rejectedTooLarge += 1
      else rejectedRead += 1
    }
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted])
    if (rejectedNotImage > 0) toast.error('Only image attachments are supported.')
    if (rejectedTooLarge > 0) toast.error('That image is too large to attach.')
    if (rejectedRead > 0) toast.error('Couldn’t read that image.')
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // Whether attaching is possible RIGHT NOW. Mid-run attaching is disabled
  // (image turns can't queue - sending one would overlap the in-flight run), with
  // {@link RUNNING_ATTACH_MESSAGE} explaining why.
  const canAttachNow = canAttachImages && !running

  const openFilePicker = () => {
    if (disabled || !canAttachNow) return
    fileInputRef.current?.click()
  }

  // Honest feedback when an image was paste/dropped but can't be attached right
  // now: we keep the early-return but never silently swallow it. Uses the SAME
  // message as the disabled attach button (no-vision, or run-in-flight) so the
  // situation reads consistently however the user hit it.
  const notifyImageIgnored = () => {
    toast.info(!canAttachImages ? NO_VISION_MESSAGE : RUNNING_ATTACH_MESSAGE)
  }

  // ⌘V of a screenshot → attachment (the highest-frequency attach path). Only
  // intercept when an image is actually on the clipboard AND attaching is possible
  // right now; otherwise let the paste fall through to the textarea (normal text
  // paste). When an image WAS pasted but can't attach, surface an honest toast.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    const images = imageFilesFromClipboard(e.clipboardData)
    if (images.length === 0) return
    if (!canAttachNow) {
      notifyImageIgnored()
      return
    }
    e.preventDefault()
    void addFiles(images)
  }

  // Drag-and-drop image files onto the composer surface.
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !canAttachNow) return
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !canAttachNow) return
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
  }
  const onDragLeave = () => {
    if (disabled || !canAttachNow) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) return
    const images = imageFilesFromDrop(e.dataTransfer)
    if (!canAttachNow) {
      // The drag affordances never lit up, but a drop can still land here - give
      // honest feedback rather than silently swallowing the image.
      if (images.length > 0) notifyImageIgnored()
      return
    }
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    void addFiles(images)
  }

  // --- @-mention picker ---------------------------------------------------------
  // The active mention token (start index + query) under the caret, or null. We
  // recompute it on every change/selection-affecting key so the picker tracks the
  // caret. Driven by `useFileMentions(query)` against the EXISTING files API.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const mentionOpen = mention !== null
  // The mention picker (a self-contained listbox) owns its own ↑/↓/Enter/Esc
  // handling once it has focus. The textarea keeps focus while the user types the
  // query, so we forward those keys to the picker's listbox node. The file fetch
  // (useFileMentions) is scoped to MentionMenu so it only runs while `@` is open.
  const mentionMenuRef = useRef<HTMLDivElement>(null)

  const syncMention = (text: string, caret: number | null) => {
    if (caret == null) {
      setMention(null)
      return
    }
    setMention(mentionAt(text, caret))
  }

  // Insert the chosen workspace-relative path in place of the `@`-token, leaving a
  // readable `@path ` reference the agent resolves with its own file tools.
  const insertMention = (path: string) => {
    if (!mention) return
    const el = ref.current
    const caret = el ? el.selectionStart : mention.start + 1 + mention.query.length
    const before = value.slice(0, mention.start)
    const after = value.slice(caret)
    const insert = `@${path} `
    const next = before + insert + after
    setValue(next)
    setMention(null)
    // Restore focus + place the caret just after the inserted reference.
    const nextCaret = before.length + insert.length
    requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      node.focus()
      node.setSelectionRange(nextCaret, nextCaret)
    })
  }

  // First-run focus hand-off: when asked (e.g. Home seeded a starter prompt),
  // land the cursor in the input once on mount so the user can send/edit right
  // away. Mount-only by design - a later prop flip never steals focus.
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-grow: reset height then snap to scrollHeight, capped.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`
  }, [value])

  // A send is allowed with prose OR with at least one image (an image-only turn
  // is valid - the agent sees the image). Disabled gates everything.
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled
  // Threaded into the lazy Send/Stop morph + the mic pulse so reduced-motion is
  // honored without framer-motion's hook (which would re-eager the chunk).
  const reduce = usePrefersReducedMotion()

  // Which slash commands the host actually wired (so we never offer an inert
  // row). `/model` is offered when the picker exists (models + onModelChange);
  // each of the rest gates on its own handler being passed.
  const canRun: Record<SlashActionId, boolean> = {
    model: models.length > 0 && !!onModelChange,
    new: !!onNewChat,
    clear: !!onClearChat,
    theme: !!onToggleTheme,
    usage: !!onOpenUsage,
  }
  const wiredCommands = SLASH_COMMANDS.filter((c) => canRun[c.id])

  // The menu opens when the value is a single leading-`/` token AND there's at
  // least one wired command AND the user hasn't dismissed it (Esc). A real
  // message with a space never matches (slashQuery returns null), so prose that
  // merely starts with `/` is sent verbatim.
  const query = slashQuery(value)
  const slashMatches =
    query !== null && wiredCommands.length > 0 ? filterSlashCommands(query, wiredCommands) : []
  const slashOpen = !slashDismissed && slashMatches.length > 0

  // Keep the highlight in range as the filtered list shrinks/grows.
  const highlight = slashOpen ? Math.min(slashHighlight, slashMatches.length - 1) : 0

  const setText = (next: string, caret: number | null = next.length) => {
    setValue(next)
    // Any edit re-arms the menu (a prior Esc only suppressed the current token).
    setSlashDismissed(false)
    setSlashHighlight(0)
    syncMention(next, caret)
  }

  const submit = () => {
    const text = value.trim()
    const hasImages = attachments.length > 0
    if ((!text && !hasImages) || disabled) return
    // Send-while-busy (C2): while a run is in flight, a text submit is QUEUED (FIFO)
    // rather than blocked - it flushes when the run completes. Image turns are NOT
    // queued: submitting one mid-run would start an OVERLAPPING run, so we hold the
    // composer as-is (text + pills intact) and say so honestly. The user sends it
    // once the reply finishes (or after Stop).
    if (running) {
      if (hasImages) {
        toast.info(RUNNING_ATTACH_MESSAGE)
        return
      }
      queue.enqueue(text)
      resetInput()
      return
    }
    // Only attach the second arg when images are present, so a plain text send is
    // byte-identical to before (onSend(text) - keeps existing call sites/tests).
    if (hasImages) onSend(text, attachments.map(toRunAttachment))
    else onSend(text)
    resetInput()
  }

  const resetInput = () => {
    clearDraft()
    setSlashDismissed(false)
    setSlashHighlight(0)
    setMention(null)
    setAttachments([])
  }

  const runSlash = (cmd: SlashCommand) => {
    // Clear the command text first so the composer is clean for the next message.
    resetInput()
    // Every command is a local UI action the deck performs itself (the menu
    // carries no agent-passthrough commands; see slashCommands.ts).
    switch (cmd.id) {
      case 'model':
        // Open the existing picker by clicking its trigger (Radix opens on click).
        modelPickerWrapRef.current
          ?.querySelector<HTMLButtonElement>('[data-testid="model-picker-trigger"]')
          ?.click()
        break
      case 'new':
        onNewChat?.()
        break
      case 'clear':
        onClearChat?.()
        break
      case 'theme':
        onToggleTheme?.()
        break
      case 'usage':
        onOpenUsage?.()
        break
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the @-mention picker is open, it owns ↑/↓/Enter/Esc. The picker is a
    // self-contained listbox; the textarea keeps focus (so the user can keep
    // typing the query), so we forward those keys to the picker's node, where its
    // own handler navigates (↑/↓), commits (Enter → onSelect → insertMention), or
    // dismisses (Esc → onClose). Other keys fall through to edit the query.
    if (mentionOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      const listbox = mentionMenuRef.current?.querySelector<HTMLElement>('[role="listbox"]')
      if (listbox) {
        e.preventDefault()
        e.stopPropagation()
        listbox.dispatchEvent(
          new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }),
        )
        return
      }
    }

    // While the slash menu is open, the menu owns navigation/commit/dismiss keys.
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashHighlight((h) => (h + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashHighlight((h) => (h - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter runs the highlighted command - it does NOT send the message.
        e.preventDefault()
        const cmd = slashMatches[highlight]
        if (cmd) runSlash(cmd)
        return
      }
      if (e.key === 'Escape') {
        // Close the menu but keep the text; the next Enter sends it verbatim.
        e.preventDefault()
        e.stopPropagation()
        setSlashDismissed(true)
        return
      }
      if (e.key === 'Tab') {
        // Tab completes to the highlighted command's literal text.
        const cmd = slashMatches[highlight]
        if (cmd) {
          e.preventDefault()
          setValue(cmd.command)
          setSlashDismissed(true)
        }
        return
      }
    }

    // Cmd/Ctrl+M: open the ModelPicker focused (keyboard-premium, Wave 5 a11y).
    // Only fires when models are available; silently no-ops otherwise.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'm' || e.key === 'M')) {
      if (models.length > 0 && onModelChange) {
        e.preventDefault()
        modelPickerWrapRef.current
          ?.querySelector<HTMLButtonElement>('[data-testid="model-picker-trigger"]')
          ?.click()
      }
      return
    }

    // The send-key preference decides whether Enter sends or inserts a newline
    // (Shift+Enter is always a newline; an IME composition never sends). When it
    // returns false we let the textarea insert the newline natively.
    if (shouldSend(e, sendKeyPref)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      className={cn(
        floating &&
          'pointer-events-none sticky bottom-0 z-10 px-1 pb-[max(1rem,env(safe-area-inset-bottom))]',
      )}
    >
      {/* Send-while-busy queue (C2): pending messages typed while a run is in
          flight, shown as subtle "Queued" pills above the composer. Queued is a
          PENDING state, not an action or a live accent - so the pill is neutral
          (border + muted text), never the action accent. Each pill's × cancels that message
          before it can send (honest: cancel really removes it from the queue). */}
      {queue.queue.length > 0 && (
        <ul
          data-testid="composer-queue"
          aria-label="Queued messages"
          className={cn('mb-1.5 flex flex-col gap-1 px-1', floating && 'pointer-events-auto')}
        >
          {queue.queue.map((item) => (
            <li
              key={item.id}
              data-testid="composer-queued-pill"
              className="ad-surface flex items-center gap-2 rounded-lg border-border bg-surface-1 py-1 pr-1 pl-2 text-[12px] text-muted-foreground"
            >
              <span className="shrink-0 text-[11px] font-medium tracking-wide text-foreground-tertiary uppercase">
                Queued
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground" title={item.text}>
                {item.text.trim()}
              </span>
              <button
                type="button"
                onClick={() => queue.cancel(item.id)}
                aria-label={`Cancel queued message: ${item.text.trim()}`}
                data-testid="composer-queued-cancel"
                className="grid size-11 shrink-0 place-items-center rounded-lg text-foreground-tertiary transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] sm:size-10"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        data-testid="composer"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          // Border + focus box-shadow ease at 180ms; height is in the same
          // transition so the composer eases (no abrupt jump) when an attachment
          // pill is added/removed.
          'group/composer ad-surface relative flex flex-col gap-1.5 rounded-xl bg-surface-elevated p-2 transition-[border-color,box-shadow,height] duration-[180ms]',
          floating && 'pointer-events-auto shadow-[0_8px_28px_-12px_rgba(0,0,0,0.55)]',
          'focus-within:border-primary/45 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_20%,transparent)]',
          dragActive && 'border-primary/60',
        )}
      >
        {/* Drag-drop overlay: a calm, dashed dropzone hint while an image drag is
            over the composer. Identity/selection uses border-strong; this is an
            ACTION affordance (dropping attaches), so the sky-blue accent is appropriate. */}
        {dragActive && (
          <div
            data-testid="composer-drop-overlay"
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 text-13 font-medium text-primary"
          >
            Drop image to attach
          </div>
        )}

        {/* Removable attachment preview pills above the input. Each is a small
            chip with a thumbnail, the filename, and a remove (×) button. */}
        {attachments.length > 0 && (
          <ul
            data-testid="composer-attachments"
            aria-label="Attachments"
            className="flex flex-wrap gap-1.5 px-1 pt-1"
          >
            {attachments.map((att) => (
              <li
                key={att.id}
                data-testid="composer-attachment-pill"
                className="ad-surface flex items-center gap-2 rounded-lg bg-surface-1 py-1 pr-1 pl-1.5 text-[12px] text-foreground"
              >
                <img
                  src={att.data_url}
                  alt=""
                  aria-hidden
                  className="size-7 shrink-0 rounded object-cover"
                />
                <span className="max-w-[140px] truncate" title={att.name}>
                  {att.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  data-testid="composer-attachment-remove"
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-foreground-tertiary transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] sm:size-9"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* The hidden native file input the attach button proxies. Accepts images
            only (the gateway carries images, not documents). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          data-testid="composer-file-input"
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []))
            // Reset so re-picking the same file fires change again.
            e.target.value = ''
          }}
        />

        {slashOpen && <SlashMenu commands={slashMatches} highlight={highlight} onRun={runSlash} />}

        {mentionOpen && (
          <div
            ref={mentionMenuRef}
            id="composer-mention-menu"
            className="absolute bottom-full left-0 z-50 mb-2 w-[min(360px,calc(100%-0.5rem))]"
          >
            <MentionMenu
              query={mention.query}
              onSelect={insertMention}
              onClose={() => {
                setMention(null)
                ref.current?.focus()
              }}
            />
          </div>
        )}

        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setText(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // Clicking/arrowing within the text can move the caret out of (or into)
          // a mention token - re-sync on selection changes.
          onSelect={(e) => syncMention(value, e.currentTarget.selectionStart)}
          placeholder="Message your agent..."
          aria-label="Message your agent"
          // While a menu is open, announce the listbox relationship for AT.
          aria-expanded={slashOpen || mentionOpen || undefined}
          aria-controls={
            slashOpen ? 'composer-slash-menu' : mentionOpen ? 'composer-mention-menu' : undefined
          }
          aria-activedescendant={
            slashOpen ? `composer-slash-${slashMatches[highlight]?.id}` : undefined
          }
          className="max-h-[200px] min-h-11 w-full resize-none bg-transparent px-2 pt-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-foreground-tertiary disabled:opacity-60"
        />

        <div className="flex items-center gap-2 pl-1">
          {/* A calm, hover-revealed keyboard + slash hint on the left, so the
              composer reads as an instrument without always-on noise. */}
          <span
            data-testid="composer-hint"
            className="hidden min-w-0 truncate text-[11px] text-foreground-tertiary opacity-0 transition-opacity duration-150 group-focus-within/composer:opacity-100 sm:inline"
          >
            {slashOpen ? (
              <>
                <kbd className="font-sans">↑↓</kbd> to choose · <kbd className="font-sans">↵</kbd>{' '}
                to run · <kbd className="font-sans">Esc</kbd> to send as text
              </>
            ) : (
              <>
                <kbd className="font-sans">{sendKeyPref === 'mod-enter' ? '⌘↵' : '↵'}</kbd> to send
              </>
            )}
          </span>
          <div className="flex-1" />

          {/* Attach image: a small footer icon button. Shown DISABLED with an
              honest tooltip when the active model can't see images (vision) OR a
              run is in flight (image turns can't queue), so the user understands
              why rather than silently losing a paste/drop. */}
          <AttachButton
            onClick={openFilePicker}
            disabled={disabled || !canAttachNow}
            canAttachImages={canAttachImages}
            running={running}
          />

          {/* Voice dictation: a small footer icon button next to the model chip.
              Always rendered; when dictation can't run (no capture API or an
              insecure origin) it is DISABLED with an honest tooltip
              (`unavailableReason` + `unavailableHint`) so the user understands why,
              rather than silently disappearing. While a recorded clip is being
              transcribed (server path) it shows a brief "Transcribing…" state. */}
          <MicButton
            recording={speech.recording}
            transcribing={speech.transcribing}
            onClick={toggleRecording}
            disabled={disabled || !speech.available}
            available={speech.available}
            unavailableReason={speech.unavailableReason}
            unavailableHint={speech.unavailableHint}
          />

          {models.length > 0 && onModelChange && (
            <div ref={modelPickerWrapRef}>
              <ModelPicker models={models} value={model} onSelect={onModelChange} />
            </div>
          )}

          <ContextRing tokens={contextTokens} limit={contextLimit} />

          <Suspense
            fallback={
              <SendStopButtonStatic
                running={running}
                canSend={canSend}
                onSend={submit}
                onStop={onStop}
              />
            }
          >
            <SendStopButton
              running={running}
              canSend={canSend}
              onSend={submit}
              onStop={onStop}
              reduce={reduce}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

/**
 * The composer's `@`-mention dropdown. A thin wrapper that calls
 * {@link useFileMentions} (the EXISTING `/api/agent-deck/files` search) and renders
 * the Foundation {@link MentionPicker}. Kept as a child so the file fetch is
 * mounted ONLY while a mention is active (not on every composer render). The
 * Composer forwards ↑/↓/Enter/Esc to the picker's listbox; mouse hover/click work
 * directly.
 */
function MentionMenu({
  query,
  onSelect,
  onClose,
}: {
  query: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const { results, loading } = useFileMentions(query)
  return (
    <MentionPicker
      query={query}
      results={results}
      loading={loading}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}

/**
 * The composer's mic button (voice DICTATION). Reserved-for-action sky-blue marks
 * the RECORDING state only; idle it's a quiet tertiary glyph. While recording it
 * pulses (suppressed under prefers-reduced-motion) and carries `aria-pressed` +
 * a polite `aria-live` "Listening…" cue so AT announces the live state. Sits as a
 * small icon button beside the model chip per the spec.
 *
 * HONEST unavailable state: when dictation can't run (no capture API or an
 * insecure origin), the button is DISABLED and its tooltip + accessible name
 * carry the `unavailableReason` (+ `unavailableHint`) so the user understands why -
 * never hidden. While a recorded clip is uploading + being transcribed (the
 * server-STT path), it shows a brief spinner + "Transcribing…" and ignores clicks.
 */
function MicButton({
  recording,
  transcribing,
  onClick,
  disabled,
  available,
  unavailableReason,
  unavailableHint,
}: {
  recording: boolean
  transcribing: boolean
  onClick: () => void
  disabled: boolean
  available: boolean
  unavailableReason: string | null
  unavailableHint: string | null
}) {
  const reduce = usePrefersReducedMotion()
  // The accessible name + tooltip: the honest reason (+ hint) when unavailable,
  // else the live/toggle action. (`unavailableReason` is non-null exactly when
  // `!available`.)
  const unavailableLabel = unavailableHint
    ? `${unavailableReason ?? 'Voice input is unavailable'}. ${unavailableHint}`
    : (unavailableReason ?? 'Voice input is unavailable')
  const label = !available
    ? unavailableLabel
    : transcribing
      ? 'Transcribing your voice…'
      : recording
        ? 'Stop voice input'
        : 'Start voice input'
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        // Ignore clicks while transcribing (the cycle completes on its own).
        disabled={disabled || transcribing}
        aria-pressed={recording}
        aria-label={label}
        title={!available ? label : undefined}
        data-testid="composer-mic"
        data-recording={recording || undefined}
        data-transcribing={transcribing || undefined}
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-lg transition-[transform,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:size-10',
          recording || transcribing
            ? 'bg-primary/15 text-primary'
            : 'text-foreground-tertiary hover:bg-foreground/10 hover:text-foreground',
          recording && !reduce && 'motion-safe:animate-pulse',
        )}
      >
        {transcribing ? (
          <Loader2 className={cn('size-4', !reduce && 'motion-safe:animate-spin')} aria-hidden />
        ) : (
          <Mic className="size-4" aria-hidden />
        )}
      </button>
      {/* A polite live region so AT announces the recording / transcribing state. */}
      <span className="sr-only" role="status" aria-live="polite">
        {recording ? 'Listening…' : transcribing ? 'Transcribing…' : ''}
      </span>
    </>
  )
}

/**
 * The composer's attach-image button. A quiet tertiary glyph (a paperclip) that
 * opens the file picker. When the active model can't see images - or a run is in
 * flight (image turns can't queue) - it renders DISABLED with an honest tooltip +
 * an `aria-label` that says why (HONEST UI). Sits beside the mic.
 */
function AttachButton({
  onClick,
  disabled,
  canAttachImages,
  running,
}: {
  onClick: () => void
  disabled: boolean
  canAttachImages: boolean
  running: boolean
}) {
  const label = !canAttachImages
    ? NO_VISION_MESSAGE
    : running
      ? RUNNING_ATTACH_MESSAGE
      : 'Attach image'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid="composer-attach"
      className="grid size-11 shrink-0 place-items-center rounded-lg text-foreground-tertiary transition-[transform,background-color,color] hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground-tertiary sm:size-10"
    >
      <Paperclip className="size-4" aria-hidden />
    </button>
  )
}

/**
 * The Suspense fallback for the composer's primary control while the lazy
 * {@link SendStopButton} (framer-motion) loads: the SAME Send/Stop button without
 * the crossfade. Identical markup, ids, and handlers, so the send control is
 * present and interactive on first paint and the swap to the animated version is
 * seamless. Carries `active:scale-95` for press tactility like the animated one.
 */
function SendStopButtonStatic({
  running,
  canSend,
  onSend,
  onStop,
}: {
  running: boolean
  canSend: boolean
  onSend: () => void
  onStop: () => void
}) {
  return running ? (
    <button
      type="button"
      onClick={onStop}
      aria-label="Stop"
      data-testid="composer-stop"
      className="grid size-11 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground transition-[transform,background-color] hover:bg-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] active:scale-95 sm:size-10"
    >
      <Square className="size-3.5 fill-current" aria-hidden />
    </button>
  ) : (
    <button
      type="button"
      onClick={onSend}
      disabled={!canSend}
      aria-label="Send"
      data-testid="composer-send"
      className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-[transform,background-color] hover:bg-primary-hover focus-visible:ad-focus active:scale-95 disabled:cursor-not-allowed disabled:bg-primary/15 disabled:text-primary/60 disabled:opacity-100 sm:size-10"
    >
      <ArrowUp className="size-4" aria-hidden />
    </button>
  )
}

/**
 * The composer's client-side slash-command popover. A calm, keyboard-navigable
 * listbox (UI-only commands - see {@link SLASH_COMMANDS}) anchored above the
 * input. Mouse hover + click also run a command. The governed sky-blue accent marks only the
 * highlighted row (the one Enter will run), per the design language.
 */
function SlashMenu({
  commands,
  highlight,
  onRun,
}: {
  commands: SlashCommand[]
  highlight: number
  onRun: (cmd: SlashCommand) => void
}) {
  return (
    <div
      id="composer-slash-menu"
      role="listbox"
      aria-label="Commands"
      className="ad-surface absolute bottom-full left-0 z-50 mb-2 w-[min(320px,calc(100%-0.5rem))] overflow-hidden rounded-xl bg-popover p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]"
    >
      {/* A small section label orients the user. Every command runs locally in
          the deck (each row's hint says what it does). aria-hidden - the listbox
          already carries the "Commands" accessible name, so this is sighted-only
          chrome and never a focusable/selectable option. */}
      <p
        aria-hidden
        className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-foreground-tertiary uppercase"
      >
        Commands
      </p>
      <div className="flex flex-col gap-0.5">
        {commands.map((cmd, i) => {
          const Icon = cmd.icon
          const active = i === highlight
          return (
            <button
              key={cmd.id}
              id={`composer-slash-${cmd.id}`}
              type="button"
              role="option"
              aria-selected={active}
              // Run on mousedown so the textarea doesn't lose focus first (which
              // would tear the menu down before the click lands).
              onMouseDown={(e) => {
                e.preventDefault()
                onRun(cmd)
              }}
              className={cn(
                'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors sm:min-h-10',
                active
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  active ? 'text-primary' : 'text-foreground-tertiary',
                )}
                aria-hidden
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="text-13 font-medium">{cmd.label}</span>
                  <span className="font-mono text-[11px] text-foreground-tertiary">
                    {cmd.command}
                  </span>
                </span>
                {/* The one-line description is the point of the menu (a newcomer
                    learns what each command does before running it), so it reads
                    legibly rather than as faint chrome. */}
                <span className="truncate text-[11px] text-muted-foreground">{cmd.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

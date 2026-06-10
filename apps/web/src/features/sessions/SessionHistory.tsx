import { useMemo, useState } from 'react'
import {
  ArrowRight,
  ChevronRight,
  FileDown,
  GitBranch,
  MessageSquare,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Message } from '@/components/chat/Message'
import { VirtualMessageList } from '@/components/chat/VirtualMessageList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { cn } from '@/lib/utils'
import { formatCost, formatTokens } from '@/lib/format'
import { ProviderBrandIcon } from '@/features/models/providerBrandIcons'
import { transcriptToTurns } from './transcript'
import { TranscriptExportMenu } from './TranscriptExportMenu'
import { TranscriptImportMenu } from './TranscriptImportMenu'
import { sessionStateIndicator } from './sessionStatus'
import { useSessionLabels } from './sessionLabels'
import { sanitizeSessionPreview } from './sessionPreview'
import type { SessionDetail, SessionMessage } from './types'

/** A locally-imported transcript: a read-only view, NEVER persisted to hermes. */
type ImportedTranscript = { session: SessionDetail | null; messages: SessionMessage[] }

/**
 * The History (opened-session) view. Renders a persisted transcript as read-only
 * conversation history using the EXACT M1b chat vocabulary (Message → Markdown /
 * ToolCard / ReasoningBlock), under a calm sticky header (title · model ·
 * cost/tokens). A prominent amber "Continue" resumes the conversation: it calls
 * `onContinue(sessionId)`, which the integrator wires to a `/chat-run` run that
 * carries `session_id` so the gateway resumes IN THE SAME hermes session — that
 * is how you sprint across sessions.
 *
 * The model is shown as a plain muted Badge (matching the live ChatHeader's
 * model chip), NOT a switch control: the confirmed dashboard build has no
 * session-mutation route, so we show the model honestly rather than advertise a
 * dropdown affordance that never opens.
 */

export interface SessionHistoryViewProps {
  detail: SessionDetail | null
  messages: SessionMessage[]
  isLoading: boolean
  error?: string | null
  /** Resume this session via /chat-run (run carries session_id). */
  onContinue: (sessionId: string) => void
  /**
   * Return to the History browser. When provided, the view renders a "History ›
   * <title>" breadcrumb whose first crumb is this Back affordance — so this hidden
   * detail route reads as a child of History, not an orphan. The route wires it to
   * navigate back to the History surface.
   */
  onBack?: () => void
}

export function SessionHistoryView({
  detail,
  messages,
  isLoading,
  error = null,
  onContinue,
  onBack,
}: SessionHistoryViewProps) {
  // A locally-imported transcript replaces the live session view while active.
  // It's a read-only mirror of an exported file — NEVER written back to hermes.
  const [imported, setImported] = useState<ImportedTranscript | null>(null)

  // The active view's data: the imported transcript when one is loaded, else the
  // live session passed in by the route.
  const activeDetail = imported ? imported.session : detail
  const activeMessages = imported ? imported.messages : messages
  const turns = useMemo(() => transcriptToTurns(activeMessages), [activeMessages])
  const localLabels = useSessionLabels()

  if (error && !imported) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p role="alert" className="text-sm text-destructive">
          Couldn't load this session.
        </p>
      </div>
    )
  }

  const hermesTitle =
    sanitizeSessionPreview(detail?.title) ||
    sanitizeSessionPreview(detail?.preview) ||
    'Untitled session'
  const localLabel = !imported && detail ? localLabels[detail.id]?.trim() : undefined
  const title = imported
    ? sanitizeSessionPreview(activeDetail?.title) || 'Imported transcript'
    : localLabel || hermesTitle

  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack ? <Breadcrumb title={title} onBack={onBack} /> : null}
      <Header
        detail={activeDetail}
        title={title}
        messages={activeMessages}
        imported={imported !== null}
        localLabel={localLabel}
        hermesTitle={hermesTitle}
        onImport={(session, msgs) => setImported({ session, messages: msgs })}
      />

      {imported && <ImportedBanner onExit={() => setImported(null)} />}

      {!imported && isLoading ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-6 py-6">
            <TranscriptSkeleton />
          </div>
        </div>
      ) : turns.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-6 py-6">
            <p className="py-12 text-center text-sm text-foreground-tertiary">
              {imported
                ? 'This imported transcript has no visible messages.'
                : 'This session has no visible messages.'}
            </p>
          </div>
        </div>
      ) : (
        // The transcript is windowed (VirtualMessageList): only the visible slice
        // of a long session is in the DOM, so a 10k-turn history no longer janks
        // or OOMs. Read-only — no stick-to-bottom; rows are measured, so a mixed
        // prose/tool transcript places correctly. The 720px reading column and the
        // per-turn vertical rhythm are preserved via the inner/footer wrappers.
        <VirtualMessageList
          turns={turns}
          ariaLabel={imported ? 'Imported transcript' : 'Session transcript'}
          estimateSize={140}
          className="px-6"
          innerClassName="py-6"
          renderTurn={(turn) => (
            <div className="pb-1">
              <Message turn={turn} />
            </div>
          )}
        />
      )}

      {/* An imported transcript is a LOCAL read-only view — it has no hermes
          session to resume, so the Continue bar is hidden (never fake a resume). */}
      {!imported && <ContinueBar detail={detail} onContinue={onContinue} />}
    </div>
  )
}

/**
 * A quiet "History › <title>" breadcrumb above the header for this hidden
 * `/sessions/:id` detail route — so it reads as a child of History, not an
 * orphan. The first crumb is the Back affordance (a real button → the History
 * browser); the current session title is the inert trailing crumb. Neutral, never
 * amber; the amber accent stays on the page's one action (Continue).
 */
function Breadcrumb({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex shrink-0 items-center gap-1 border-b border-border px-6 py-2 text-xs text-foreground-tertiary"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to History"
        className="rounded-md px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus"
      >
        History
      </button>
      <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-foreground-tertiary" aria-current="page" title={title}>
        {title}
      </span>
    </nav>
  )
}

function Header({
  detail,
  title,
  messages,
  imported,
  localLabel,
  hermesTitle,
  onImport,
}: {
  detail: SessionDetail | null
  title: string
  messages: SessionMessage[]
  /** True while a locally-imported transcript is being shown (read-only). */
  imported: boolean
  /** Browser-local label for this live session, when present. */
  localLabel?: string
  /** The original Hermes title/preview behind a local label. */
  hermesTitle: string
  /** Load an imported transcript as a local read-only view. */
  onImport: (session: SessionDetail | null, messages: SessionMessage[]) => void
}) {
  // T2.12: a proper SurfaceHeader (the shared amber Lucide tile + heading face)
  // instead of the previous hand-rolled bare <h2> — the History view now reads
  // as part of the two-tier header family, like Files and Terminal.
  return (
    <SurfaceHeader
      icon={imported ? FileDown : MessageSquare}
      title={title}
      className="shrink-0"
      actions={
        <>
          {/* An imported transcript is a local read-only view; the badge names
              that honestly so it's never mistaken for a live hermes session. */}
          {imported && (
            <Badge
              variant="muted"
              className="shrink-0"
              title="A locally-imported transcript: read-only, not a hermes session"
            >
              Imported · read-only
            </Badge>
          )}
          {localLabel && (
            <Badge
              variant="muted"
              className="shrink-0 italic"
              title={`Local browser label. Hermes title: ${hermesTitle}`}
            >
              Local label
            </Badge>
          )}
          {!imported && detail && <StateBadge detail={detail} />}
          {detail?.model && (
            // A plain muted model chip — matches the live ChatHeader treatment.
            // No fake dropdown chevron: this hermes build has no session-mutation
            // route, so we show the model honestly rather than advertise a switch
            // control that never opens.
            <Badge variant="muted" className="shrink-0 gap-1" title={detail.model}>
              <span className="flex size-[11px] items-center justify-center" aria-hidden>
                <ProviderBrandIcon provider={vendorFromModel(detail.model)} size={11} />
              </span>
              {shortModel(detail.model)}
            </Badge>
          )}
          {!imported && detail && <MetaTag detail={detail} />}
          {!imported && detail && <TranscriptExportMenu detail={detail} messages={messages} />}
          {/* Import is always available (you can open a transcript without a live
              session loaded); it never touches hermes. */}
          {!imported && <TranscriptImportMenu onImport={onImport} />}
        </>
      }
    />
  )
}

/**
 * A subtle header indicator for a meaningful non-normal session state. Renders
 * NOTHING for the common case (running/completed/normal). A failed/errored
 * session reads as a destructive-tinted "Failed" chip (warning-triangle glyph);
 * a handed-off session reads as a neutral "Handed off" chip (branch glyph).
 * State is conveyed by SHAPE/ICON + a TEXT label + an aria-label — governed
 * semantic color, never amber, never color alone (colorblind-safe).
 */
function StateBadge({ detail }: { detail: SessionDetail }) {
  const indicator = sessionStateIndicator(detail)
  if (!indicator) return null
  if (indicator.kind === 'failed') {
    return (
      <Badge
        variant="destructive"
        className="shrink-0"
        aria-label={indicator.label}
        title={indicator.label}
      >
        <TriangleAlert aria-hidden />
        Failed
      </Badge>
    )
  }
  return (
    <Badge
      variant="muted"
      className="shrink-0"
      aria-label={indicator.label}
      title={indicator.label}
    >
      <GitBranch aria-hidden />
      Handed off
    </Badge>
  )
}

function MetaTag({ detail }: { detail: SessionDetail }) {
  const bits: string[] = []
  if (detail.total_tokens > 0) bits.push(`${formatTokens(detail.total_tokens)} tokens`)
  const cost = formatCost(detail.cost_usd)
  if (cost) bits.push(cost)
  if (bits.length === 0) return null
  return (
    <Badge variant="muted" className="shrink-0 tabular-nums">
      {bits.join(' · ')}
    </Badge>
  )
}

function ContinueBar({
  detail,
  onContinue,
}: {
  detail: SessionDetail | null
  onContinue: (sessionId: string) => void
}) {
  return (
    <div className="shrink-0 border-t border-border px-6 py-3.5">
      <div className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-4">
        <p className="min-w-0 text-[13px] leading-relaxed text-foreground-tertiary">
          Picks up right here. Your next message continues this session.
        </p>
        <Button
          type="button"
          size="lg"
          disabled={!detail}
          onClick={() => detail && onContinue(detail.id)}
          className="shrink-0 gap-1.5"
        >
          Resume
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/**
 * A calm strip shown above an imported transcript. It states the honest boundary
 * plainly (a local read-only view, not a hermes session) and offers a way back
 * to the live session. Neutral/muted styling — this is informational, not amber.
 */
function ImportedBanner({ onExit }: { onExit: () => void }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-6 py-2"
    >
      <p className="min-w-0 text-[12px] leading-relaxed text-foreground-tertiary">
        Viewing an imported transcript: a local, read-only copy. Nothing is saved to your agent.
      </p>
      <button
        type="button"
        onClick={onExit}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus"
      >
        <X className="size-3.5" aria-hidden />
        Close
      </button>
    </div>
  )
}

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          data-testid="transcript-skeleton"
          className={cn('flex flex-col gap-2', i % 2 === 0 ? 'items-end' : 'items-start')}
        >
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted/40 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function shortModel(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}

function vendorFromModel(model: string): string {
  const slash = model.indexOf('/')
  if (slash > 0) return model.slice(0, slash)
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'google'
  if (model.startsWith('llama') || model.startsWith('meta')) return 'meta'
  if (model.startsWith('mistral') || model.startsWith('mixtral')) return 'mistral'
  if (model.startsWith('deepseek')) return 'deepseek'
  if (model.startsWith('qwen')) return 'qwen'
  if (model.startsWith('grok')) return 'xai'
  return model
}

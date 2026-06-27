import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import type { RuntimeId, RuntimeSession, RuntimeSource } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { useUnifiedSessions } from './useUnifiedSessions'

/**
 * Unified session history across runtimes — Hermes, Claude Code, and Codex in one
 * list, with an All / per-runtime source filter driven by the server's honest
 * rollup. Read-only runtimes are clearly badged; the filter only offers runtimes
 * that actually reported data. This is the visible payoff of the multi-runtime
 * adapters: every agent you run, in one place.
 */

const RUNTIME_LABEL: Record<RuntimeId, string> = {
  hermes: 'Hermes',
  claude: 'Claude Code',
  codex: 'Codex',
}

type Filter = 'all' | RuntimeId

export function RuntimeHistory() {
  const { data, isLoading, isError } = useUnifiedSessions()
  const [filter, setFilter] = useState<Filter>('all')

  const sessions = data?.sessions ?? []
  const sources = data?.sources ?? []
  const shown = useMemo(
    () => (filter === 'all' ? sessions : sessions.filter((s) => s.runtime === filter)),
    [sessions, filter],
  )

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[920px] flex-col gap-5 py-8">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold text-foreground">All runtimes</h1>
        <span className="text-[12px] text-foreground-tertiary">
          Sessions across Hermes, Claude Code, and Codex
        </span>
      </div>

      <UsageByRuntime sessions={sessions} />

      <SourceFilter
        sources={sources}
        total={sessions.length}
        active={filter}
        onSelect={setFilter}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 px-1 text-sm text-foreground-tertiary">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
          Reading sessions…
        </div>
      ) : isError ? (
        <p className="px-1 text-sm text-foreground-tertiary">Could not read sessions right now.</p>
      ) : sessions.length === 0 ? (
        // Fresh slate: nothing across ANY runtime. Invite, don't just say "none".
        <div
          className="ad-surface rounded-md bg-surface-1 px-4 py-6 text-center"
          data-testid="runtime-history-empty"
        >
          <p className="text-sm font-medium text-foreground">No agent sessions yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Run Hermes, Claude Code, or Codex and the sessions show up here, with their model and
            token usage, all in one place.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p
          className="px-1 text-sm text-foreground-tertiary"
          data-testid="runtime-history-filter-empty"
        >
          {filter === 'all' ? 'No sessions yet.' : `No ${RUNTIME_LABEL[filter]} sessions yet.`}
        </p>
      ) : (
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
          data-testid="runtime-history-list"
        >
          {shown.map((s) => (
            <SessionRow key={`${s.runtime}:${s.id}`} session={s} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Unified usage — per-runtime token totals tallied from the SAME adapter-sourced
 * session records the history shows (so the numbers always agree with the list).
 * Renders nothing until there is real usage to report.
 */
function UsageByRuntime({ sessions }: { sessions: RuntimeSession[] }) {
  const rollup = useMemo(() => {
    const byRuntime = new Map<RuntimeId, { input: number; output: number; sessions: number }>()
    for (const s of sessions) {
      const cur = byRuntime.get(s.runtime) ?? { input: 0, output: 0, sessions: 0 }
      cur.input += s.inputTokens
      cur.output += s.outputTokens
      cur.sessions += 1
      byRuntime.set(s.runtime, cur)
    }
    return [...byRuntime.entries()]
      .map(([runtime, v]) => ({ runtime, ...v, total: v.input + v.output }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [sessions])

  if (rollup.length === 0) return null

  return (
    <div
      className="ad-surface flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-surface-1 px-3 py-2.5"
      data-testid="runtime-usage"
    >
      <span className="text-[12px] font-medium text-foreground-tertiary">Usage</span>
      {rollup.map((r) => (
        <span
          key={r.runtime}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
          data-testid={`runtime-usage-${r.runtime}`}
        >
          <span className="text-foreground">{RUNTIME_LABEL[r.runtime]}</span>
          <span className="tabular-nums">{formatTokens(r.total)} tok</span>
          <span className="text-foreground-tertiary">
            ({formatTokens(r.input)} in · {formatTokens(r.output)} out)
          </span>
        </span>
      ))}
    </div>
  )
}

function SourceFilter({
  sources,
  total,
  active,
  onSelect,
}: {
  sources: RuntimeSource[]
  total: number
  active: Filter
  onSelect: (f: Filter) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter by runtime"
      className="flex flex-wrap items-center gap-1.5"
    >
      <FilterPill
        label="All"
        count={total}
        selected={active === 'all'}
        onClick={() => onSelect('all')}
      />
      {sources.map((src) => (
        <FilterPill
          key={src.runtime}
          label={RUNTIME_LABEL[src.runtime]}
          count={src.sessionCount}
          readOnly={!src.capabilities.chat}
          selected={active === src.runtime}
          onClick={() => onSelect(src.runtime)}
        />
      ))}
    </div>
  )
}

function FilterPill({
  label,
  count,
  selected,
  readOnly,
  onClick,
}: {
  label: string
  count: number
  selected: boolean
  readOnly?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors focus-visible:ad-focus',
        selected
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground-tertiary hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums text-foreground-tertiary">{count}</span>
      {readOnly ? (
        <span
          className="rounded-sm bg-muted px-1 py-px text-[10px] text-foreground-tertiary"
          title="Read-only: the deck reads this runtime's sessions but cannot drive it"
        >
          read-only
        </span>
      ) : null}
    </button>
  )
}

function SessionRow({ session }: { session: RuntimeSession }) {
  const navigate = useNavigate()
  const tokens = session.inputTokens + session.outputTokens
  // Hermes sessions are RESUMABLE (the deck can drive Hermes) → a row click
  // continues that conversation. Read-only runtimes (Claude Code / Codex) have no
  // deck-drivable session, so their rows stay honestly non-interactive.
  const resumable = session.runtime === 'hermes'

  const body = (
    <>
      <span
        className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-tertiary"
        data-testid="session-runtime"
      >
        {RUNTIME_LABEL[session.runtime]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm text-foreground">
          {session.title?.trim() || session.id}
        </span>
        <span className="truncate text-[11px] text-foreground-tertiary">
          {session.model ?? 'model unknown'}
          {session.cwd ? ` · ${session.cwd}` : ''}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end text-[11px] text-foreground-tertiary">
        <span className="tabular-nums">{session.messageCount} msg</span>
        {tokens > 0 ? <span className="tabular-nums">{formatTokens(tokens)} tok</span> : null}
      </div>
      <span className="shrink-0 text-[11px] text-foreground-tertiary tabular-nums">
        {relativeTime(session.lastActive)}
      </span>
    </>
  )

  if (resumable) {
    return (
      <li>
        <button
          type="button"
          onClick={() => navigate(`/chat?continue=${encodeURIComponent(session.id)}`)}
          title="Resume this conversation"
          className="ad-surface flex w-full items-center gap-3 rounded-md bg-surface-1 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:ad-focus"
        >
          {body}
        </button>
      </li>
    )
  }
  return (
    <li className="ad-surface flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2">{body}</li>
  )
}

/** Compact token count (1234 → 1.2k). */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Coarse relative time from an epoch-ms timestamp (no live clock dependency in
 * tests — it reads Date.now once per render, which is fine for a static label). */
function relativeTime(ms: number | null): string {
  if (ms === null) return ''
  const delta = Date.now() - ms
  if (delta < 0) return 'just now'
  const mins = Math.floor(delta / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

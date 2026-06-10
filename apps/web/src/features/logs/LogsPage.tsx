/**
 * LogsPage — the presentational Logs surface (full-bleed tool surface). Owns NO
 * data fetching: it takes the loaded {@link AgentDeckLogs}, the current filter
 * values, and the loading/error flags as props (mirroring UsagePage), so it is
 * trivially testable and the route ({@link LogsRoute}) wires the query.
 *
 * Layout: a slim {@link SurfaceHeader} (keeps the working panel's vertical real
 * estate) + a {@link LogFilters} control strip + a capped, monospace, scrollable
 * line list. The list is sliced to the most-recent {@link MAX_RENDERED_LINES}
 * so the DOM stays bounded (virtualization-friendly: a fixed window, newest at
 * the bottom). The keyword box ALSO filters client-side for instant feedback on
 * the already-loaded page, on top of the server-side scan.
 */
import { useMemo } from 'react'
import { ScrollText, FileWarning, Inbox } from 'lucide-react'
import type { AgentDeckLogs, LogFile } from '@agent-deck/protocol'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { Button } from '@/components/ui/button'
import { ErrorState, EmptyState } from '@/components/ui/state'
import { LogFilters } from './LogFilters'
import { LogLine } from './LogLine'
import { LOG_FILES, MAX_RENDERED_LINES, type LevelOption } from './types'

export interface LogsPageProps {
  file: LogFile
  onFileChange: (file: LogFile) => void
  level: LevelOption
  onLevelChange: (level: LevelOption) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
  autoRefresh: boolean
  onAutoRefreshChange: (on: boolean) => void
  onRefresh: () => void
  data?: AgentDeckLogs
  isLoading: boolean
  isFetching: boolean
  error?: Error | null
}

export function LogsPage({
  file,
  onFileChange,
  level,
  onLevelChange,
  keyword,
  onKeywordChange,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  data,
  isLoading,
  isFetching,
  error,
}: LogsPageProps) {
  // Keep the raw internal error (e.g. "session-token request failed: fetch
  // failed") available for diagnostics, but never render it: the user sees a
  // calm human sentence (below), the developer sees the plumbing in the console.
  if (error) {
    console.warn('[logs] failed to load:', error.message)
  }

  // Client-side keyword filter for instant feedback over the loaded page; the
  // server already scanned the whole file, this just narrows what's on screen.
  const visible = useMemo(() => {
    const entries = data?.entries ?? []
    const needle = keyword.trim().toLowerCase()
    const filtered = needle ? entries.filter((e) => e.raw.toLowerCase().includes(needle)) : entries
    // Cap to the most-recent N to keep the DOM bounded.
    return filtered.length > MAX_RENDERED_LINES ? filtered.slice(-MAX_RENDERED_LINES) : filtered
  }, [data, keyword])
  const fileLabel = LOG_FILES.find((f) => f.id === file)?.label ?? file
  const filterSummary =
    data && !error
      ? [
          `${visible.length} of ${data.entries.length} line${data.entries.length === 1 ? '' : 's'} shown`,
          fileLabel,
          level === 'ALL' ? 'all levels' : `${level} and above`,
          keyword.trim() ? `matching "${keyword.trim()}"` : null,
          autoRefresh ? 'auto-refresh on' : 'auto-refresh off',
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SurfaceHeader
        icon={ScrollText}
        title="Logs"
        subtitle={
          <span>
            Troubleshooting trail from your agent and gateway.
            {data ? (
              <span className="ml-1.5 opacity-70">
                {data.truncated ? 'last ' : ''}
                {visible.length} line{visible.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
        }
      />

      <LogFilters
        file={file}
        onFileChange={onFileChange}
        level={level}
        onLevelChange={onLevelChange}
        keyword={keyword}
        onKeywordChange={onKeywordChange}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={onAutoRefreshChange}
        onRefresh={onRefresh}
        refreshing={isFetching}
      />

      {filterSummary ? (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-border bg-surface-1/45 px-6 py-2 text-[12px] text-foreground-tertiary"
        >
          {filterSummary}
          {data?.truncated ? (
            <span className="ml-1.5 text-muted-foreground">
              Hermes returned the newest matching lines.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-6">
            <ErrorState
              icon={FileWarning}
              title="Couldn’t load logs"
              description="Logs come from Hermes. Start Hermes or retry when it is reachable again."
              onRetry={onRefresh}
            />
          </div>
        ) : isLoading ? (
          <LogsSkeleton />
        ) : visible.length === 0 ? (
          <div className="p-6">
            {keyword.trim() ? (
              <EmptyState
                icon={Inbox}
                title="No matching lines"
                description="Nothing in this log matches your search. Clear it or widen the level to see more."
                action={
                  <Button variant="outline" size="sm" onClick={() => onKeywordChange('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title="Nothing logged yet"
                description="When your agent runs, Hermes writes troubleshooting details here."
              />
            )}
          </div>
        ) : (
          <div role="table" aria-label={`${file} log`} className="divide-y divide-border/40">
            {visible.map((entry) => (
              <LogLine key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A calm shimmer of fake log rows (never a spinner-of-doom). */
function LogsSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading logs</span>
      <div className="space-y-1.5 p-4" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
            style={{ width: `${55 + ((i * 7) % 40)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The Logs surface control strip: a file segmented-control, a min-level
 * segmented-control, a keyword text filter, an auto-refresh toggle, and a manual
 * refresh. Design-language styled (hairline pills, a NEUTRAL active segment so
 * selection stays distinct from the semantic level hues beside it, amber focus
 * ring). Keyboard-friendly: each segmented group is an ARIA radiogroup
 * with roving tabindex + arrow-key traversal (matching PeriodSelector).
 */
import { RefreshCw } from 'lucide-react'
import type { LogFile } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { LEVEL_OPTIONS, LOG_FILES, type LevelOption } from './types'

export interface LogFiltersProps {
  file: LogFile
  onFileChange: (file: LogFile) => void
  level: LevelOption
  onLevelChange: (level: LevelOption) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
  autoRefresh: boolean
  onAutoRefreshChange: (on: boolean) => void
  onRefresh: () => void
  /** True while a (re)fetch is in flight — spins the refresh icon. */
  refreshing?: boolean
}

export function LogFilters({
  file,
  onFileChange,
  level,
  onLevelChange,
  keyword,
  onKeywordChange,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  refreshing,
}: LogFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-3">
      <div className="flex max-w-full min-w-0 flex-col gap-1">
        <span className="text-[11px] font-medium text-foreground-tertiary">Log</span>
        <div className="max-w-full overflow-x-auto pb-0.5">
          <SegmentedControl<LogFile>
            aria-label="Log file"
            options={LOG_FILES.map((f) => ({ value: f.id, label: f.label }))}
            value={file}
            onValueChange={onFileChange}
          />
        </div>
      </div>

      <div className="flex max-w-full min-w-0 flex-col gap-1">
        <span className="text-[11px] font-medium text-foreground-tertiary">Minimum level</span>
        <div className="max-w-full overflow-x-auto pb-0.5">
          <SegmentedControl<LevelOption>
            aria-label="Minimum level"
            options={LEVEL_OPTIONS.map((opt) => ({
              value: opt,
              label: opt === 'ALL' ? 'All' : opt,
            }))}
            value={level}
            onValueChange={onLevelChange}
          />
        </div>
      </div>

      <label className="relative flex min-w-[180px] flex-1 flex-col gap-1">
        <span className="text-[11px] font-medium text-foreground-tertiary">Search lines</span>
        <input
          type="search"
          inputMode="search"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          placeholder="Search log lines…"
          className={cn(
            'h-8 w-full rounded-md border border-border bg-surface-2/40 px-3 text-xs',
            'text-foreground placeholder:text-foreground-tertiary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
      </label>

      <label className="flex h-8 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => onAutoRefreshChange(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        Auto-refresh
      </label>

      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        aria-label="Refresh logs"
        title="Refresh logs"
      >
        <RefreshCw
          className={cn('size-3.5', refreshing && 'animate-spin motion-reduce:animate-none')}
        />
        Refresh
      </Button>
    </div>
  )
}

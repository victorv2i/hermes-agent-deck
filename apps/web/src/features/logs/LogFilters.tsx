/**
 * The Logs surface control strip: a file segmented-control, a min-level
 * segmented-control, a keyword text filter, an auto-refresh toggle, and a manual
 * refresh. Design-language styled (hairline pills, a NEUTRAL active segment so
 * selection stays distinct from the semantic level hues beside it, amber focus
 * ring). Keyboard-friendly: each segmented group is an ARIA radiogroup
 * with roving tabindex + arrow-key traversal (matching PeriodSelector).
 */
import { useRef, type KeyboardEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import type { LogFile } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LEVEL_OPTIONS, LOG_FILES, type LevelOption } from './types'

/** A generic segmented radiogroup (roving tabindex + arrow keys + wrap). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  renderLabel,
}: {
  label: string
  options: ReadonlyArray<T>
  value: T
  onChange: (next: T) => void
  renderLabel: (opt: T) => string
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const selectAt = (index: number) => {
    const next = options[((index % options.length) + options.length) % options.length]
    if (next === undefined) return
    onChange(next)
    buttonsRef.current[options.indexOf(next)]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(index - 1)
        break
    }
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-[9px] border border-border bg-surface-2/60 p-0.5"
    >
      {options.map((opt, index) => {
        const active = opt === value
        return (
          <button
            key={opt}
            ref={(el) => {
              buttonsRef.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // 44px touch target on mobile; compact on sm+ (px-2.5 py-1).
              'min-h-11 touch-manipulation rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none',
              'sm:min-h-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-foreground/10 text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {renderLabel(opt)}
          </button>
        )
      })}
    </div>
  )
}

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
          <Segmented<LogFile>
            label="Log file"
            options={LOG_FILES.map((f) => f.id)}
            value={file}
            onChange={onFileChange}
            renderLabel={(id) => LOG_FILES.find((f) => f.id === id)?.label ?? id}
          />
        </div>
      </div>

      <div className="flex max-w-full min-w-0 flex-col gap-1">
        <span className="text-[11px] font-medium text-foreground-tertiary">Minimum level</span>
        <div className="max-w-full overflow-x-auto pb-0.5">
          <Segmented<LevelOption>
            label="Minimum level"
            options={LEVEL_OPTIONS}
            value={level}
            onChange={onLevelChange}
            renderLabel={(opt) => (opt === 'ALL' ? 'All' : opt)}
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
            'h-8 w-full rounded-[9px] border border-border bg-surface-2/40 px-3 text-xs',
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

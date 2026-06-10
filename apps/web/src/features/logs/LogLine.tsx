/**
 * A single log row. Monospace, dense, with level-colored emphasis (semantic
 * tokens only — never the amber action accent). The timestamp + logger stay
 * quiet; the level token and an error/warn message body carry the color so the
 * eye lands on problems first. Continuation/`unknown` lines render as a quiet
 * full-width line (no level chip) so multi-line tracebacks read as one block.
 */
import type { AgentDeckLogEntry } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { levelTextClass } from './types'

export interface LogLineProps {
  entry: AgentDeckLogEntry
}

export function LogLine({ entry }: LogLineProps) {
  const isContinuation = entry.level === 'unknown' && entry.timestamp === null
  const levelClass = levelTextClass(entry.level)
  const emphasizeMessage = entry.level === 'ERROR' || entry.level === 'CRITICAL'

  return (
    <div
      role="row"
      data-level={entry.level}
      className={cn(
        'grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 px-4 py-[3px] font-mono text-xs leading-relaxed',
        'border-l-2 border-transparent hover:bg-foreground/[0.03]',
        emphasizeMessage && 'border-l-destructive/40 bg-destructive/[0.04]',
        entry.level === 'WARNING' && 'border-l-warning/40',
      )}
    >
      {isContinuation ? (
        // A wrapped/traceback line: span the row, quiet, preserve whitespace.
        <span
          role="cell"
          className="col-span-3 whitespace-pre-wrap break-all text-muted-foreground/80"
        >
          {entry.raw}
        </span>
      ) : (
        <>
          <time role="cell" className="shrink-0 tabular-nums text-foreground-tertiary">
            {entry.timestamp ?? '—'}
          </time>
          <span role="cell" className={cn('shrink-0 font-medium uppercase', levelClass)}>
            {entry.level === 'unknown' ? '·' : entry.level}
          </span>
          <span role="cell" className="min-w-0 break-words">
            {entry.logger ? (
              <span className="mr-2 text-foreground-tertiary">{entry.logger}</span>
            ) : null}
            <span className={cn(emphasizeMessage ? 'text-destructive' : 'text-foreground/90')}>
              {entry.message}
            </span>
          </span>
        </>
      )}
    </div>
  )
}

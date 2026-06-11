import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'

/**
 * The touch-keyboard accessory row for the terminal: the keys a phone keyboard
 * doesn't have but every agent CLI needs (Esc to interrupt, Tab/⇧Tab to cycle,
 * arrows for menus and history, a sticky Ctrl, and ^C). Rendered by
 * {@link TerminalView} below the xterm host, only on coarse-pointer devices.
 *
 * Every key uses `onPointerDown={preventDefault}` so a tap NEVER steals focus
 * from xterm's hidden textarea — the on-screen keyboard stays up while you mash
 * Esc/arrows, which is the whole point.
 */

/** Escape sequences for the keys the soft keyboard lacks. */
const KEY_SEQUENCES = {
  esc: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  ctrlC: '\x03',
} as const

export interface MobileKeyBarProps {
  /** Send raw bytes to the shell (the same path as typed keystrokes). */
  onKey: (data: string) => void
  /** The sticky-Ctrl modifier is armed (the next typed character is Ctrl'd). */
  ctrlArmed: boolean
  /** Toggle the sticky Ctrl modifier. */
  onCtrlToggle: () => void
  className?: string
}

export function MobileKeyBar({ onKey, ctrlArmed, onCtrlToggle, className }: MobileKeyBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Terminal touch keys"
      className={`items-center gap-1 overflow-x-auto border-t border-border bg-surface-2/60 px-1.5 py-1 ${className ?? ''}`}
    >
      <Key label="esc" onKey={onKey} data={KEY_SEQUENCES.esc} aria="Escape" />
      <Key label="tab" onKey={onKey} data={KEY_SEQUENCES.tab} aria="Tab" />
      <Key label="⇧tab" onKey={onKey} data={KEY_SEQUENCES.shiftTab} aria="Shift Tab" />
      <button
        type="button"
        aria-label="Control modifier"
        aria-pressed={ctrlArmed}
        title="Hold Ctrl for the next key"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onCtrlToggle}
        className={`flex h-9 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-mono text-xs transition-colors duration-100 focus-visible:ad-focus ${
          ctrlArmed
            ? 'bg-primary/15 text-primary'
            : 'text-foreground-tertiary hover:bg-muted hover:text-foreground'
        }`}
      >
        ctrl
      </button>
      <Key onKey={onKey} data={KEY_SEQUENCES.up} aria="Arrow up">
        <ArrowUp className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.down} aria="Arrow down">
        <ArrowDown className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.left} aria="Arrow left">
        <ArrowLeft className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.right} aria="Arrow right">
        <ArrowRight className="size-4" />
      </Key>
      <Key label="^C" onKey={onKey} data={KEY_SEQUENCES.ctrlC} aria="Control C" />
    </div>
  )
}

function Key({
  label,
  children,
  data,
  aria,
  onKey,
}: {
  label?: string
  children?: React.ReactNode
  data: string
  aria: string
  onKey: (data: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onKey(data)}
      className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-mono text-xs text-foreground-tertiary transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:ad-focus"
    >
      {children ?? label}
    </button>
  )
}

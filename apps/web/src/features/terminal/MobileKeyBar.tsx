import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste } from 'lucide-react'

/**
 * The touch-keyboard accessory row for the terminal: the keys a phone keyboard
 * doesn't have but every agent CLI needs (Esc to interrupt, Tab/⇧Tab to cycle,
 * arrows for menus and history, a sticky Ctrl, ^C, and Paste). Rendered by
 * {@link TerminalView} below the xterm host on touch-input devices.
 *
 * Every key uses `onPointerDown={preventDefault}` so a tap NEVER steals focus
 * from xterm's hidden textarea — the on-screen keyboard stays up while you mash
 * Esc/arrows, which is the whole point.
 *
 * Arrows and Tab HOLD-REPEAT like a hardware key: holding starts repeating after
 * {@link HOLD_REPEAT_DELAY_MS}, then fires every {@link HOLD_REPEAT_INTERVAL_MS}
 * until the pointer lifts or leaves. A single tap emits exactly once (the
 * pointer-down emit; the synthetic click after it is swallowed).
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

/** How long a key must be held before it starts repeating. */
export const HOLD_REPEAT_DELAY_MS = 350
/** The interval between repeats once a held key starts repeating. */
export const HOLD_REPEAT_INTERVAL_MS = 60

/** How long the quiet inline notice (e.g. "Clipboard unavailable") stays up. */
const NOTICE_MS = 2500

export interface MobileKeyBarProps {
  /** Send raw bytes to the shell (the same path as typed keystrokes). */
  onKey: (data: string) => void
  /** Send PASTED clipboard text to the shell (bypasses the sticky-Ctrl transform). */
  onPaste: (text: string) => void
  /** The sticky-Ctrl modifier is armed (the next typed character is Ctrl'd). */
  ctrlArmed: boolean
  /** Toggle the sticky Ctrl modifier. */
  onCtrlToggle: () => void
  /** Inject the clipboard read (tests). Defaults to navigator.clipboard.readText. */
  readClipboardText?: () => Promise<string>
  className?: string
}

export function MobileKeyBar({
  onKey,
  onPaste,
  ctrlArmed,
  onCtrlToggle,
  readClipboardText,
  className,
}: MobileKeyBarProps) {
  // A quiet inline notice for the paste denial path; auto-clears.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    },
    [],
  )
  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }

  // Paste: read the clipboard and feed it to the shell verbatim. readText can
  // reject (permission denied) or throw synchronously (no clipboard API on an
  // insecure context) — both land in the same quiet notice, never a crash.
  const paste = async () => {
    try {
      const read = readClipboardText ?? (() => navigator.clipboard.readText())
      const text = await read()
      if (text) onPaste(text)
    } catch {
      showNotice('Clipboard unavailable')
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Terminal touch keys"
      className={`flex items-center gap-1 overflow-x-auto border-t border-border bg-surface-2/60 px-1.5 py-1 ${className ?? ''}`}
    >
      <Key label="esc" onKey={onKey} data={KEY_SEQUENCES.esc} aria="Escape" />
      <Key label="tab" onKey={onKey} data={KEY_SEQUENCES.tab} aria="Tab" repeat />
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
      <Key onKey={onKey} data={KEY_SEQUENCES.up} aria="Arrow up" repeat>
        <ArrowUp className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.down} aria="Arrow down" repeat>
        <ArrowDown className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.left} aria="Arrow left" repeat>
        <ArrowLeft className="size-4" />
      </Key>
      <Key onKey={onKey} data={KEY_SEQUENCES.right} aria="Arrow right" repeat>
        <ArrowRight className="size-4" />
      </Key>
      <Key label="^C" onKey={onKey} data={KEY_SEQUENCES.ctrlC} aria="Control C" />
      <button
        type="button"
        aria-label="Paste"
        title="Paste from the clipboard"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void paste()}
        className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-md px-2 text-foreground-tertiary transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:ad-focus"
      >
        <ClipboardPaste className="size-4" />
      </button>
      {notice ? (
        <span role="status" className="shrink-0 px-1.5 text-xs text-foreground-tertiary">
          {notice}
        </span>
      ) : null}
    </div>
  )
}

function Key({
  label,
  children,
  data,
  aria,
  onKey,
  repeat,
}: {
  label?: string
  children?: React.ReactNode
  data: string
  aria: string
  onKey: (data: string) => void
  /** Hold-repeat like a hardware key (arrows/Tab). */
  repeat?: boolean
}) {
  // Hold-repeat timers + the tap/click double-fire guard. A repeat key emits on
  // POINTER DOWN (so holding feels immediate); the browser still fires a click
  // on release, which `firedByPointer` swallows so a single tap emits exactly
  // once. Keyboard activation (Enter/Space) fires click WITHOUT a pointerdown,
  // so it still emits — the bar stays keyboard-accessible.
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const firedByPointer = useRef(false)

  const stopRepeat = () => {
    if (delayTimer.current !== null) {
      clearTimeout(delayTimer.current)
      delayTimer.current = null
    }
    if (intervalTimer.current !== null) {
      clearInterval(intervalTimer.current)
      intervalTimer.current = null
    }
  }
  // Never leave a repeat ticking after unmount.
  useEffect(
    () => () => {
      if (delayTimer.current !== null) clearTimeout(delayTimer.current)
      if (intervalTimer.current !== null) clearInterval(intervalTimer.current)
    },
    [],
  )

  const pointerDown = (e: React.PointerEvent) => {
    // Focus-safe: never steal xterm's hidden-textarea focus (keyboard stays up).
    e.preventDefault()
    if (!repeat) return
    firedByPointer.current = true
    onKey(data)
    stopRepeat()
    delayTimer.current = setTimeout(() => {
      intervalTimer.current = setInterval(() => onKey(data), HOLD_REPEAT_INTERVAL_MS)
    }, HOLD_REPEAT_DELAY_MS)
  }

  const onClick = () => {
    if (firedByPointer.current) {
      // The synthetic click after a pointer tap: already emitted on pointerdown.
      firedByPointer.current = false
      return
    }
    onKey(data)
  }

  return (
    <button
      type="button"
      aria-label={aria}
      onPointerDown={pointerDown}
      onPointerUp={repeat ? stopRepeat : undefined}
      onPointerLeave={repeat ? stopRepeat : undefined}
      onPointerCancel={repeat ? stopRepeat : undefined}
      onClick={onClick}
      className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-mono text-xs text-foreground-tertiary transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:ad-focus"
    >
      {children ?? label}
    </button>
  )
}

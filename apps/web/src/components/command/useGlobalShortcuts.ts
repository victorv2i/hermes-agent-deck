import { useEffect } from 'react'

/**
 * App-wide keyboard map (design-language §8). Bindings:
 *  - ⌘K / Ctrl+K → open the command palette (works even while a field is focused)
 *  - ⌘B / Ctrl+B → toggle the sessions pane (the split-rail second column; works
 *    even while a field is focused — reclaiming space is wanted from anywhere)
 *  - ⌘⇧V / Ctrl+⇧V → toggle the Preview panel, the in-app iframe browser (#116;
 *    works even while a field is focused, like the other panel toggles)
 *  - ⌘N / Ctrl+N → New chat (suppressed while a field is focused, so native
 *    field behavior + the browser's own ⌘N aren't hijacked mid-typing)
 *  - j / ↓       → move the focused session DOWN the rail (suppressed while typing)
 *  - k / ↑       → move the focused session UP the rail (suppressed while typing)
 *  - ↵ (Enter)   → open the focused session (suppressed while typing; only when a
 *                  session is actually focused, so it never swallows a normal
 *                  Enter on a button/link)
 *  - ?           → open the shortcuts overlay (suppressed while a field is focused)
 *
 * Esc (abort run / close overlays / dismiss the mobile rail) is owned by the
 * components that hold that state (AppShell, ChatView, the dialogs) so it stays
 * local.
 *
 * "While a field is focused" = the active element is an input, textarea, select,
 * or contenteditable — i.e. the user is typing and global single-key shortcuts
 * must not steal the keystroke.
 */

/** Which way `onSessionNav` walks the rail. */
export type SessionNavDirection = 'next' | 'prev'

export interface GlobalShortcutHandlers {
  onOpenPalette: () => void
  onNewChat: () => void
  onShowShortcuts: () => void
  /** Toggle the sessions pane (⌘B), the split-rail second column. Optional;
   * surfaces without the pane (or callers that don't render it) omit it and the
   * binding is inert. */
  onToggleSessions?: () => void
  /** Toggle the Preview panel (⌘⇧V), the in-app iframe browser (#116). Optional;
   * when absent the binding is inert. Always available (even mid-typing), like
   * the other from-anywhere panel toggles. */
  onTogglePreview?: () => void
  /**
   * Walk the focused-session highlight through the rail (`j`/`↓` = next,
   * `k`/`↑` = prev). Optional; when absent the bindings are inert (no rail to
   * drive). The host owns the focused index + the visible highlight.
   */
  onSessionNav?: (direction: SessionNavDirection) => void
  /**
   * Open the currently-focused rail session (Enter). Returns `true` if a session
   * was focused and opened, so the hook only consumes the Enter event when it
   * actually did something — a plain Enter on a button/link is never swallowed.
   * Optional; when absent the binding is inert.
   */
  onOpenFocusedSession?: () => boolean
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable
}

export function useGlobalShortcuts({
  onOpenPalette,
  onNewChat,
  onShowShortcuts,
  onToggleSessions,
  onTogglePreview,
  onSessionNav,
  onOpenFocusedSession,
}: GlobalShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const editing = isEditableTarget(e.target)

      // ⌘K / Ctrl+K — palette. Always available, even mid-typing.
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        onOpenPalette()
        return
      }

      // ⌘B / Ctrl+B — toggle the sessions pane (split-rail second column).
      // Always available, even mid-typing (reclaiming horizontal space is a
      // from-anywhere action, like ⌘K / ⌘.).
      if (mod && (e.key === 'b' || e.key === 'B')) {
        if (!onToggleSessions) return
        e.preventDefault()
        onToggleSessions()
        return
      }

      // ⌘⇧V / Ctrl+⇧V — toggle the Preview panel (the in-app iframe browser,
      // #116). Always available, even mid-typing (a from-anywhere panel toggle
      // like ⌘. / ⌘B). The Shift guard keeps it off the bare ⌘V paste path.
      if (mod && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        if (!onTogglePreview) return
        e.preventDefault()
        onTogglePreview()
        return
      }

      // ⌘N / Ctrl+N — New chat. Suppressed while typing.
      if (mod && (e.key === 'n' || e.key === 'N')) {
        if (editing) return
        e.preventDefault()
        onNewChat()
        return
      }

      // j / ↓ — move the focused session DOWN. Plain key, suppressed while typing
      // or with a modifier (so ⌘↓ / native caret movement is never hijacked).
      if ((e.key === 'j' || e.key === 'ArrowDown') && !mod && !e.altKey) {
        if (editing || !onSessionNav) return
        e.preventDefault()
        onSessionNav('next')
        return
      }

      // k / ↑ — move the focused session UP.
      if ((e.key === 'k' || e.key === 'ArrowUp') && !mod && !e.altKey) {
        if (editing || !onSessionNav) return
        e.preventDefault()
        onSessionNav('prev')
        return
      }

      // ↵ — open the focused session. Only consume the event when a session was
      // actually focused (the handler returns true); otherwise a normal Enter on
      // a button/link keeps its native activation. Suppressed while typing so the
      // composer's own Enter (send / newline) is never stolen.
      if (e.key === 'Enter' && !mod && !e.altKey) {
        if (editing || !onOpenFocusedSession) return
        if (onOpenFocusedSession()) e.preventDefault()
        return
      }

      // ? — shortcuts overlay. Plain key, suppressed while typing or with a modifier.
      if (e.key === '?' && !mod && !e.altKey) {
        if (editing) return
        e.preventDefault()
        onShowShortcuts()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onOpenPalette,
    onNewChat,
    onShowShortcuts,
    onToggleSessions,
    onTogglePreview,
    onSessionNav,
    onOpenFocusedSession,
  ])
}

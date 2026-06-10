/**
 * useRunNotifications (A1) — surfaces a run finishing, failing, or raising an
 * approval when the operator is NOT looking at the conversation.
 *
 * Today the chat store silently updates `runStatus` / `error` / `pendingApproval`
 * with no toast, no `document.title` flip, and no Notification, so a long run
 * that ends (or blocks on an approval) while the operator is on Files, on another
 * tab, or in another window is 100% invisible. This subscriber watches the store
 * for the meaningful transitions and, when the operator isn't viewing chat,
 * fires:
 *   - a toast (always — the calm in-app channel),
 *   - a blurred-tab `document.title` flip (restored when the tab regains focus),
 *   - an optional browser Notification (permission requested lazily, once;
 *     gracefully degrades when unavailable or denied).
 *
 * It is a pure subscriber: it never mutates the store and is mounted once
 * (alongside the app chrome). All side-effecting collaborators are injectable so
 * it unit-tests hermetically without real focus, a real prompt, or a backend.
 */
import { useEffect } from 'react'
import type { AvatarId } from '@agent-deck/protocol'
import { useChatStore } from '@/state/useChatStore'
import { CHAT_PATH } from '@/app/navigation'
import { toast as defaultToast } from '@/lib/toast'
import {
  BrowserNotifier,
  buildRunNotice,
  createTitleController,
  type RunNotice,
  type TitleController,
} from '@/lib/runNotify'
import { getNotificationsEnabled } from './notificationPref'

/** The active agent's identity, threaded so a finished-run notification carries
 * the agent's name + face instead of a faceless "Run finished" (A3). */
export interface NotifyAgent {
  /** The friendly agent name, or undefined for the unnamed default (faceless). */
  name?: string
  /** The agent's avatar id → the Notification icon. */
  avatarId?: AvatarId
}

/** The minimal toast surface this hook needs (the three governed variants). */
export interface NotifyToast {
  success: (message: string, opts?: { description?: string }) => unknown
  error: (message: string, opts?: { description?: string }) => unknown
  warning: (message: string, opts?: { description?: string }) => unknown
}

/** The minimal browser-notifier surface (see {@link BrowserNotifier}). */
export interface NotifyNotifier {
  ensurePermission(): Promise<boolean>
  notify(notice: RunNotice): unknown
}

export interface UseRunNotificationsOptions {
  /** Whether run notifications are enabled (the operator's local on/off toggle).
   * When this returns false the hook is FULLY silent: no toast, no title flip, no
   * permission prompt, no Notification. Read per-emit so a mid-session toggle is
   * honored immediately. Defaults to the persisted {@link getNotificationsEnabled}
   * preference. */
  isEnabled?: () => boolean
  /** True when the operator is actively looking at the conversation (chat route,
   * tab visible + focused). When true, the hook stays silent — the transcript
   * already shows the outcome. Defaults to a live-DOM probe. */
  isViewingChat?: () => boolean
  /** Whether the tab is currently blurred/hidden — gates the `document.title`
   * flip (a backgrounded tab is the only place a title badge is useful).
   * Defaults to a live-DOM probe. */
  isTabBlurred?: () => boolean
  toast?: NotifyToast
  notifier?: NotifyNotifier
  title?: TitleController
  /** The active agent's identity (name + avatar) for a PERSONALIZED notification
   * (A3). Read per-emit so a mid-session agent switch is reflected at once.
   * Defaults to no identity → the honest faceless "Run finished" copy. */
  getAgent?: () => NotifyAgent | null
}

/** The live-DOM default: the operator is "viewing chat" only when the tab is
 * visible AND focused AND the current route is the chat surface (CHAT_PATH). */
function defaultIsViewingChat(): boolean {
  if (typeof document === 'undefined') return true
  const visible = document.visibilityState === 'visible'
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  // The active conversation lives at `/chat/<id>` (the URL carries the session id),
  // not just the bare `/chat` — match the whole chat surface by prefix so a run
  // finishing while you WATCH the transcript stays silent (the feature's whole point).
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const onChat = path === CHAT_PATH || path.startsWith(`${CHAT_PATH}/`)
  return visible && focused && onChat
}

/** The live-DOM default for "is this tab in the background right now". */
function defaultIsTabBlurred(): boolean {
  if (typeof document === 'undefined') return false
  const hidden = document.visibilityState === 'hidden'
  const blurred = typeof document.hasFocus === 'function' ? !document.hasFocus() : false
  return hidden || blurred
}

export function useRunNotifications(options: UseRunNotificationsOptions = {}): void {
  useEffect(() => {
    const isEnabled = options.isEnabled ?? getNotificationsEnabled
    const isViewingChat = options.isViewingChat ?? defaultIsViewingChat
    const isTabBlurred = options.isTabBlurred ?? defaultIsTabBlurred
    const toast = options.toast ?? defaultToast
    const notifier = options.notifier ?? new BrowserNotifier()
    const title = options.title ?? createTitleController()
    const getAgent = options.getAgent ?? (() => null)

    // The active agent's name/avatar, threaded into a notice so a finished-run
    // notification reads "Sol finished" with the agent's face as its icon.
    const agentNotice = () => {
      const agent = getAgent()
      return {
        ...(agent?.name ? { agentName: agent.name } : {}),
        ...(agent?.avatarId ? { avatarId: agent.avatarId } : {}),
      }
    }

    // Whether the title is currently flipped, so `restore` only runs when needed.
    let titleFlipped = false

    const emit = (notice: RunNotice) => {
      // Toast — always (the calm in-app channel).
      const opts = notice.toastDescription ? { description: notice.toastDescription } : undefined
      if (notice.toastVariant === 'success') toast.success(notice.toastMessage, opts)
      else if (notice.toastVariant === 'error') toast.error(notice.toastMessage, opts)
      else toast.warning(notice.toastMessage, opts)

      // Title flip — only meaningful when the tab is backgrounded.
      if (isTabBlurred()) {
        title.flip(notice)
        titleFlipped = true
      }

      // Browser Notification — lazily resolve permission, then post if granted.
      void Promise.resolve(notifier.ensurePermission()).then((ok) => {
        if (ok) notifier.notify(notice)
      })
    }

    // Restore the page title when the operator returns to the tab.
    const restoreTitle = () => {
      if (titleFlipped) {
        title.restore()
        titleFlipped = false
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') restoreTitle()
    }
    window.addEventListener('focus', restoreTitle)
    document.addEventListener('visibilitychange', onVisible)

    // Track the prior snapshot so we act only on the meaningful transitions.
    let prevStatus = useChatStore.getState().runStatus
    let prevApprovalId = approvalKey(useChatStore.getState().pendingApproval)

    const unsubscribe = useChatStore.subscribe((state) => {
      const status = state.runStatus
      const approval = state.pendingApproval

      // The operator's local on/off toggle gates EVERYTHING (read per-event so a
      // mid-session flip is honored at once). When off we never even prompt for
      // browser permission — staying honestly silent.
      const enabled = isEnabled()

      // 1) A run reached a terminal state (running/stopping -> idle). Classify by
      //    whether an error was set at the same moment. A COMPLETED notice gets a
      //    1-line task hint from the prompting user turn ("repo summary ready"-style).
      if (prevStatus !== 'idle' && status === 'idle') {
        if (enabled && !isViewingChat()) {
          const id = agentNotice()
          emit(
            state.error
              ? buildRunNotice('failed', { ...id, detail: state.error.trim() })
              : buildRunNotice('completed', { ...id, taskHint: lastUserTaskHint(state.turns) }),
          )
        }
      }

      // 2) A NEW approval appeared (null/other -> a fresh approval id).
      const approvalId = approvalKey(approval)
      if (approvalId && approvalId !== prevApprovalId) {
        if (enabled && !isViewingChat()) {
          emit(buildRunNotice('approval', { ...agentNotice(), detail: approval?.command }))
        }
      }

      prevStatus = status
      prevApprovalId = approvalId
    })

    return () => {
      unsubscribe()
      window.removeEventListener('focus', restoreTitle)
      document.removeEventListener('visibilitychange', onVisible)
      // Leave the title restored on teardown so we never strand a badge.
      restoreTitle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** A stable identity for a pending approval (its id, falling back to run+command)
 * so we fire once per distinct gate, not on every unrelated re-render. */
function approvalKey(approval: { approval_id?: string; run_id?: string; command?: string } | null) {
  if (!approval) return null
  return approval.approval_id ?? `${approval.run_id ?? ''}:${approval.command ?? ''}`
}

/** The longest head of the user's task this run answered (~48 chars), used as the
 * completed-notification's 1-line hint. Reads the most recent user turn — the
 * prompt the agent just finished — and trims it to a calm headline length. Empty
 * when there's no user prompt to summarize (the title then stays "<name> finished"). */
const TASK_HINT_MAX = 48
function lastUserTaskHint(turns: { role: string; content?: string }[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t && t.role === 'user' && typeof t.content === 'string') {
      const head = t.content.trim().replace(/\s+/g, ' ')
      if (!head) return ''
      return head.length <= TASK_HINT_MAX ? head : `${head.slice(0, TASK_HINT_MAX).trimEnd()}…`
    }
  }
  return ''
}

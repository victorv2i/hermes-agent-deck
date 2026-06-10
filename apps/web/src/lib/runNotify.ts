/**
 * Run-notification primitives (A1) — the pure, framework-free core behind
 * `useRunNotifications`. A long run finishing, failing, or raising an approval
 * while the operator is on another surface or another tab is otherwise 100%
 * silent. These helpers build the message content, manage the `document.title`
 * flip, and wrap the browser `Notification` API behind a graceful-degrade gate.
 *
 * Everything here is deliberately side-effect-light and injectable so the
 * subscriber hook can be unit-tested without a live backend, real focus, or a
 * real Notification permission prompt.
 */
import type { AvatarId } from '@agent-deck/protocol'
import { avatarSrc } from '@/features/profiles/avatarForProfile'
import { getActiveSwRegistration } from './swNotify'

/** What happened to the run while the operator wasn't looking. */
export type RunOutcome = 'completed' | 'failed' | 'approval'

export type ToastVariant = 'success' | 'error' | 'warning'

export interface RunNotice {
  outcome: RunOutcome
  /** A single-glyph badge prefixed onto `document.title` when the tab is blurred. */
  titleBadge: string
  toastVariant: ToastVariant
  toastMessage: string
  /** Optional toast description (e.g. a failure detail). */
  toastDescription?: string
  notificationTitle: string
  notificationBody: string
  /** The agent's avatar served path, set as the Notification icon (A3) — present
   * only when the active agent's identity is known. Absent → faceless default. */
  icon?: string
}

interface NoticeOptions {
  /** A failure reason / approval command to thread into the description + body. */
  detail?: string
  /** The active agent's friendly name — personalizes the notification title from
   * a faceless "Run finished" to "Sol finished" (A3). Omitted/blank → the
   * honest faceless copy is kept. */
  agentName?: string
  /** A 1-line task hint appended to a COMPLETED title ("… — repo summary ready").
   * Quietly ignored on failure/approval, where the detail already carries the why. */
  taskHint?: string
  /** The active agent's avatar id → resolved to the served `/avatars/<id>.webp`
   * path and attached as the Notification icon. */
  avatarId?: AvatarId
}

const COPY: Record<
  RunOutcome,
  {
    badge: string
    variant: ToastVariant
    toast: string
    notificationTitle: string
    notificationBody: string
    /** The personalized title VERB phrase ("<name> <verb>") when an agent name is
     * known — keeps the named title parallel to the faceless one (A3). */
    namedVerb: string
  }
> = {
  completed: {
    badge: '●',
    variant: 'success',
    toast: 'Run finished',
    notificationTitle: 'Run finished',
    notificationBody: 'Your agent finished its run.',
    namedVerb: 'finished',
  },
  failed: {
    badge: '✖',
    variant: 'error',
    toast: 'Run failed',
    notificationTitle: 'Run failed',
    notificationBody: 'Your agent’s run failed.',
    namedVerb: 'hit an error',
  },
  approval: {
    badge: '!',
    variant: 'warning',
    toast: 'Approval needed',
    notificationTitle: 'Approval needed',
    notificationBody: 'Your agent is waiting for your approval.',
    namedVerb: 'needs your approval',
  },
}

/** Build the (pure) content for a run notice — no side effects. */
export function buildRunNotice(outcome: RunOutcome, opts: NoticeOptions = {}): RunNotice {
  const copy = COPY[outcome]
  const detail = opts.detail?.trim()
  const agentName = opts.agentName?.trim()
  const taskHint = opts.taskHint?.trim()

  // The notification TITLE: personalized to the agent when its name is known
  // ("Sol finished — repo summary ready"), else the honest faceless copy.
  // The 1-line task hint only sweetens a COMPLETED title; failure/approval lean on
  // the detail in the body so the title stays a calm, scannable headline.
  let notificationTitle = copy.notificationTitle
  if (agentName) {
    notificationTitle = `${agentName} ${copy.namedVerb}`
    if (taskHint && outcome === 'completed') notificationTitle += `: ${taskHint}`
  }

  return {
    outcome,
    titleBadge: copy.badge,
    toastVariant: copy.variant,
    toastMessage: copy.toast,
    ...(detail ? { toastDescription: detail } : {}),
    notificationTitle,
    notificationBody: detail ? `${copy.notificationBody} (${detail})` : copy.notificationBody,
    // Attach the agent's served avatar as the Notification icon when known.
    ...(opts.avatarId ? { icon: avatarSrc(opts.avatarId) } : {}),
  }
}

/**
 * Manages the blurred-tab `document.title` flip. Captures the live title on the
 * FIRST flip so a later flip (e.g. an approval after a completion) and the
 * eventual restore always return to the original page title — never a badged one.
 */
export interface TitleController {
  flip(notice: RunNotice): void
  restore(): void
}

export function createTitleController(doc: Document = document): TitleController {
  let base: string | null = null
  return {
    flip(notice) {
      if (base === null) base = doc.title
      doc.title = `${notice.titleBadge} ${notice.toastMessage} · ${base}`
    },
    restore() {
      if (base === null) return
      doc.title = base
      base = null
    },
  }
}

/**
 * The slice of a service-worker registration the notifier posts through. A
 * provider returning a registration routes notices via `showNotification`, which
 * keeps firing while the tab is backgrounded; returning `null` falls back to the
 * in-tab `Notification`.
 */
export interface NotifyRegistration {
  showNotification(title: string, options?: NotificationOptions): Promise<void> | void
}
export type NotifyRegistrationProvider = () => NotifyRegistration | null

/**
 * Thin wrapper over the browser `Notification` API that:
 *  - degrades silently when the API is absent (SSR, unsupported, sandbox),
 *  - asks for permission lazily and AT MOST once (caches the resolved grant),
 *  - never re-prompts after a denial,
 *  - posts a notification only when permission is granted,
 *  - prefers a service-worker `registration.showNotification` when one is
 *    available (so notices fire while the tab is backgrounded), falling back to
 *    the in-tab `new Notification(...)` when no SW is registered.
 *
 * The constructor is injected so tests drive it without a real prompt; the
 * default reads the global `Notification`.
 */
export class BrowserNotifier {
  private readonly ctor: typeof Notification | undefined
  private readonly getRegistration: NotifyRegistrationProvider
  /** Cached terminal decision: true=granted, false=denied/unavailable, null=unasked. */
  private granted: boolean | null = null
  /** De-dupes concurrent permission requests into one prompt. */
  private pending: Promise<boolean> | null = null

  constructor(
    ctor: typeof Notification | undefined = resolveNotificationCtor(),
    getRegistration: NotifyRegistrationProvider = getActiveSwRegistration,
  ) {
    this.ctor = ctor
    this.getRegistration = getRegistration
    // Adopt an already-resolved permission so we never re-prompt unnecessarily.
    if (ctor) {
      if (ctor.permission === 'granted') this.granted = true
      else if (ctor.permission === 'denied') this.granted = false
    } else {
      this.granted = false
    }
  }

  /** Lazily resolve permission. Returns whether notifications may be posted.
   * Prompts at most once; subsequent calls reuse the cached/ongoing result. */
  async ensurePermission(): Promise<boolean> {
    if (this.granted !== null) return this.granted
    if (!this.ctor) {
      this.granted = false
      return false
    }
    if (this.pending) return this.pending
    this.pending = this.ctor
      .requestPermission()
      .then((perm) => {
        this.granted = perm === 'granted'
        return this.granted
      })
      .catch(() => {
        // A throwing/legacy callback-style API: treat as unavailable.
        this.granted = false
        return false
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  /** Post a notification IF permission is already granted; else a no-op (null).
   * Prefers the service worker (fires while backgrounded) and falls back to the
   * in-tab Notification. Call {@link ensurePermission} first to request it.
   * Never throws. Returns the in-tab `Notification` only on the fallback path;
   * the SW path returns `null` (it resolves a Promise, not an instance). */
  notify(notice: RunNotice): Notification | null {
    if (this.granted !== true) return null
    const options: NotificationOptions = {
      body: notice.notificationBody,
      tag: `agent-deck-run-${notice.outcome}`,
      // The agent's face as the OS notification icon (A3) — present only when the
      // active agent's identity is known; omitted keeps the platform default.
      ...(notice.icon ? { icon: notice.icon } : {}),
    }
    // Prefer the service worker so the notice fires even when the tab is hidden.
    const registration = this.getRegistration()
    if (registration) {
      try {
        void Promise.resolve(
          registration.showNotification(notice.notificationTitle, options),
        ).catch(() => {})
        return null
      } catch {
        // Fall through to the in-tab path if the SW call throws synchronously.
      }
    }
    // In-tab fallback (no SW registered, or the SW call threw synchronously).
    if (!this.ctor) return null
    try {
      return new this.ctor(notice.notificationTitle, options)
    } catch {
      return null
    }
  }
}

/** Read the global `Notification` constructor when available, else undefined. */
function resolveNotificationCtor(): typeof Notification | undefined {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return window.Notification
    }
  } catch {
    // Accessing window.Notification can throw in locked-down contexts.
  }
  return undefined
}

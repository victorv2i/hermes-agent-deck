import { useId, useSyncExternalStore } from 'react'
import { Bell, BellOff, Ban, Check, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  useNotificationsEnabled,
  readNotificationPermission,
  type NotificationPermissionStatus,
} from './notificationPref'

/**
 * NotificationsControl — the HONEST on/off toggle for run notifications, on the
 * Settings "Your preferences" group alongside Density / Composer. It governs the
 * headless {@link useRunNotifications} subscriber that pings you when a run
 * finishes, fails, or blocks on an approval while you're not looking.
 *
 * Honesty is the whole point here:
 *   - The switch is bound to the LOCAL preference ({@link useNotificationsEnabled}),
 *     but it is honestly DISABLED whenever the browser can't actually deliver —
 *     when the OS permission is `denied` ("Blocked") or the API is `unsupported`.
 *     A pref flip can never make a blocked browser notify, so we don't pretend it
 *     can.
 *   - The real `Notification.permission` is shown verbatim (granted / not asked /
 *     blocked / unsupported). When it's `default` we offer a one-tap opt-in that
 *     fires the real `Notification.requestPermission()`.
 *   - We state the real boundary: browser notifications only fire while a tab is
 *     open. We never imply closed-tab / off-device delivery (that's hermes'
 *     Telegram channel, not this).
 *
 * `permission` and `requestPermission` are injected so the control unit-tests
 * each browser state hermetically; the defaults read the live browser.
 */

export interface NotificationsControlProps {
  /** Read the live browser permission. Defaults to {@link readNotificationPermission}. */
  permission?: () => NotificationPermissionStatus
  /** Request OS permission (the `default` opt-in). Defaults to the real browser API. */
  requestPermission?: () => Promise<NotificationPermission>
}

/** The browser's live permission as a reactive value: re-read on focus/visibility,
 * so granting it in the browser's own UI (then returning) updates the copy. */
function usePermission(read: () => NotificationPermissionStatus): NotificationPermissionStatus {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {}
      window.addEventListener('focus', onChange)
      document.addEventListener('visibilitychange', onChange)
      return () => {
        window.removeEventListener('focus', onChange)
        document.removeEventListener('visibilitychange', onChange)
      }
    },
    read,
    read,
  )
}

function defaultRequestPermission(): Promise<NotificationPermission> {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Promise.resolve(window.Notification.requestPermission())
    }
  } catch {
    // Locked-down context — fall through.
  }
  return Promise.resolve('denied')
}

export function NotificationsControl({
  permission = readNotificationPermission,
  requestPermission = defaultRequestPermission,
}: NotificationsControlProps = {}) {
  const { enabled, setEnabled } = useNotificationsEnabled()
  const perm = usePermission(permission)
  const labelId = useId()
  const hintId = useId()

  // The browser can't deliver at all when blocked or unsupported — so the toggle
  // is honestly disabled (the local pref can't override the browser's "no").
  const blocked = perm === 'denied'
  const unsupported = perm === 'unsupported'
  const canDeliver = !blocked && !unsupported
  // When the API exists but hasn't been asked yet, offer the real opt-in.
  const canRequest = perm === 'default'

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p
              id={labelId}
              className="flex items-center gap-1.5 text-sm font-medium text-foreground"
            >
              {enabled && canDeliver ? (
                <Bell className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
              ) : (
                <BellOff className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
              )}
              Notify me when a run needs me
            </p>
            <p id={hintId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ping you when a run finishes, fails, or blocks waiting for your approval and you
              aren&rsquo;t looking at the conversation. Works only while Agent Deck is open in a
              tab; it can&rsquo;t reach a closed tab or a sleeping device.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={enabled && canDeliver}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            disabled={!canDeliver}
            onClick={() => setEnabled(!enabled)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              'focus-visible:ad-focus',
              'disabled:cursor-not-allowed disabled:opacity-50',
              enabled && canDeliver ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-block size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
                enabled && canDeliver ? 'translate-x-[22px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        {/* The honest permission status — shown verbatim, never faked. */}
        <PermissionStatus
          perm={perm}
          canRequest={canRequest}
          onEnable={() => {
            void requestPermission()
          }}
        />
      </CardContent>
    </Card>
  )
}

/**
 * The honest browser-permission row. Each state reads back the REAL
 * `Notification.permission`; the `default` state offers a one-tap opt-in.
 */
function PermissionStatus({
  perm,
  canRequest,
  onEnable,
}: {
  perm: NotificationPermissionStatus
  canRequest: boolean
  onEnable: () => void
}) {
  if (perm === 'granted') {
    return (
      <StatusRow
        icon={<Check className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />}
        text="Browser notifications are allowed. You’ll get them while a tab is open."
      />
    )
  }

  if (perm === 'denied') {
    return (
      <StatusRow
        icon={<Ban className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />}
        text="Your browser has blocked notifications for this site, so it won’t show them. You’ll still see the in-app toast and tab-title badge. To re-enable, allow notifications in your browser’s site settings."
      />
    )
  }

  if (perm === 'unsupported') {
    return (
      <StatusRow
        icon={<Info className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />}
        text="This browser doesn’t support system notifications. You’ll still see the in-app toast and tab-title badge."
      />
    )
  }

  // 'default' — not yet asked. Offer the real opt-in.
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <StatusRow
        icon={<Info className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />}
        text="Your browser hasn’t been asked yet. Allow system notifications to get them outside this tab."
      />
      {canRequest && (
        <button
          type="button"
          onClick={onEnable}
          className="ad-surface ad-surface-hover inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors focus-visible:ad-focus"
        >
          <Bell className="size-3.5" aria-hidden />
          Enable browser notifications
        </button>
      )}
    </div>
  )
}

function StatusRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-px">{icon}</span>
      <p>{text}</p>
    </div>
  )
}

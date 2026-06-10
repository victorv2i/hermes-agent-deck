/**
 * Service-worker registration for run notifications (S6).
 *
 * Registering a service worker lets {@link BrowserNotifier} post notices through
 * `registration.showNotification(...)`, which keeps firing while the Agent Deck
 * tab is backgrounded (the in-tab `new Notification(...)` path can be throttled
 * or suppressed once the page is hidden). This is what pings a phone whose tab is
 * in the background over Tailscale HTTPS.
 *
 * Honest boundaries:
 *  - We register ONLY in a secure context (HTTPS / localhost). A plaintext SW is
 *    a browser error, not a silent fallback — so we no-op instead.
 *  - We never throw: an unsupported browser, a blocked registration, or SSR all
 *    degrade to `null` and the caller falls back to the in-tab Notification.
 *  - This does NOT reach a fully-closed device. Real off-device delivery still
 *    needs hermes' own Telegram channel; we do not pretend otherwise.
 */

/** The slice of `ServiceWorkerRegistration` the notifier needs. */
export interface SwRegistrationLike {
  showNotification(title: string, options?: NotificationOptions): Promise<void>
}

/**
 * The currently active SW registration, if any. The default {@link BrowserNotifier}
 * reads this so it routes through the SW once registration completes, with no
 * prop-drilling. `null` until {@link registerNotificationServiceWorker} succeeds.
 */
let activeRegistration: SwRegistrationLike | null = null

/** The live SW registration the in-tab notifier should post through (or null). */
export function getActiveSwRegistration(): SwRegistrationLike | null {
  return activeRegistration
}

/** Publish (or clear) the active SW registration. Exposed for tests. */
export function setActiveSwRegistration(registration: SwRegistrationLike | null): void {
  activeRegistration = registration
}

export interface RegisterSwOptions {
  /** Defaults to `window.isSecureContext`. */
  isSecureContext?: boolean
  /** Defaults to the global `navigator`. Injected for hermetic tests. */
  navigator?: Navigator
  /** The worker script URL. Defaults to the committed `/sw.js`. */
  scriptUrl?: string
}

/**
 * Register the notification service worker, or no-op (returning `null`) when the
 * context is insecure, service workers are unsupported, or registration fails.
 * Never throws.
 */
export async function registerNotificationServiceWorker(
  options: RegisterSwOptions = {},
): Promise<SwRegistrationLike | null> {
  const secure =
    options.isSecureContext ?? (typeof window !== 'undefined' ? window.isSecureContext : false)
  if (!secure) return null

  const nav = options.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  if (!nav || !('serviceWorker' in nav)) return null

  try {
    const registration = (await nav.serviceWorker.register(
      options.scriptUrl ?? '/sw.js',
    )) as unknown as SwRegistrationLike
    setActiveSwRegistration(registration)
    return registration
  } catch {
    // A blocked / unsupported registration is non-fatal: fall back to in-tab.
    return null
  }
}

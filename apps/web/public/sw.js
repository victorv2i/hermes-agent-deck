/**
 * Agentdeck service worker (S6) — minimal, no precache, no offline shell.
 *
 * Its ONE job is to be the surface that shows run notifications while the tab is
 * backgrounded: the page calls `registration.showNotification(...)` through this
 * worker (see src/lib/swNotify.ts), so a finished / failed / approval-blocked run
 * pings a phone whose Agentdeck tab is in the background — over the same
 * Tailscale HTTPS origin the UI is served from.
 *
 * It deliberately does NOT cache assets (Agentdeck is a live cockpit over a
 * running Hermes — a stale offline shell would be a lie), and it does NOT
 * pretend to deliver pushes from a fully-closed device: real off-device reach
 * still needs hermes' own Telegram channel. The `push` handler is here only so a
 * future web-push backend can light up without another SW round-trip; with no
 * such backend wired, it simply never fires.
 */

// Activate immediately so the page can route notifications without a reload.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * Web-push entry point (inert until a push backend exists). Stock Hermes does
 * not send web pushes today, so this is future-proofing, not a live path.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'Agentdeck'
  const options = {
    body: data.body || '',
    tag: data.tag || 'agent-deck-run',
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * Bring the app to the foreground when a notification is tapped: focus an
 * existing client if one is open, else open a new window at the app root.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
      return undefined
    }),
  )
})

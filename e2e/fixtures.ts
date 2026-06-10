import { test as base, expect } from '@playwright/test'

/**
 * A healthy one-model roster for the hermetic COCKPIT specs. A working chat needs
 * a usable model on a reachable agent — ChatRoute honestly disables the composer
 * and shows a "connect a model" / "agent unreachable" notice when the model list
 * is empty or the query errors. The cockpit specs exercise an established user
 * mid-conversation, so their baseline carries a model; specs that deliberately
 * test the no-model / unreachable / first-run-connect states override `/models`.
 */
export const MOCK_MODELS = {
  activeModelId: 'anthropic/claude-sonnet-4',
  provider: { id: 'anthropic', label: 'Anthropic' },
  models: [
    {
      id: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
      provider: 'anthropic',
      active: true,
      source: 'config',
    },
  ],
}

/**
 * Shared e2e harness. Extends Playwright's `test` so every hermetic spec seeds
 * the `agent-deck:onboarded` flag BEFORE the app's scripts run (addInitScript).
 *
 * Rationale: these specs exercise the operator COCKPIT (a returning user with
 * data), not the first-run onboarding path. Without the flag, App.tsx's
 * first-run beat fires — the Home front-door landing — which would change which
 * surface the specs start on. Seeding the flag mirrors a returning user and
 * keeps the cockpit specs deterministic. The first-run beat itself is covered
 * hermetically by the App + Home unit tests; the dedicated `resume` spec opts
 * back in where it needs the fresh-context behavior.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('agent-deck:onboarded', '1')
      } catch {
        // Storage can be unavailable (privacy mode); the app degrades anyway.
      }
    })
    await use(page)
  },
})

/**
 * freshTest — a blank-slate first load: NO `agent-deck:onboarded` flag set, NO
 * stored auth token. Used by the onboarding-journey spec to exercise the real
 * first-run wizard path that the cockpit specs skip.
 */
export const freshTest = base.extend({
  page: async ({ page }, use) => {
    // Explicitly clear any persisted onboarded / auth-token state so the spec
    // truly mirrors a brand-new user opening the app for the first time.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('agent-deck:onboarded')
        window.localStorage.removeItem('agent-deck:auth-token')
      } catch {
        // Storage unavailable — fine; nothing to clear.
      }
    })
    await use(page)
  },
})

/**
 * authTest — a session with `authRequired=true` from the health probe. The
 * onboarded flag IS set (we're testing the auth unlock path, not onboarding),
 * and the stored auth token is cleared so the AuthGate renders the unlock form.
 */
export const authTest = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('agent-deck:onboarded', '1')
        window.localStorage.removeItem('agent-deck:auth-token')
      } catch {
        // Storage unavailable; the app degrades anyway.
      }
    })
    await use(page)
  },
})

export { expect }

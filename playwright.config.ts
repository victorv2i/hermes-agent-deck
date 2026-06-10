import { defineConfig } from '@playwright/test'

// Hermetic by default: the gate (`pnpm e2e` / `pnpm verify`) runs ONLY the chat
// and surfaces projects. Both drive a dedicated BFF instance wired to an
// IN-PROCESS MOCK gateway (no live :8643) on their OWN dedicated port pair with
// `reuseExistingServer: false`, so Playwright always boots a fresh mock instance
// and tears it down. The gate can never couple to a stale/long-running server
// (e.g. a contributor's :7878/:5173 dev instance, or the :5174 bridge unit) and
// so never streams a run against the real gateway — it is reproducible on a fresh
// clone with no other server running.
//
//   chat  project  → web :5199 → BFF :7899 (in-process mock gateway; drives a full
//                    scripted run: streamed text, tool chip, approval, Stop/abort).
//                    Dedicated ports, NO reuse — fully hermetic.
//   surfaces proj. → web :5199 (shared mock web) — every secondary surface + the
//                    resume loop; REST stubbed via page.route (no live BFF/dashboard).
//
// OPT-IN ONLY (never in the default gate):
//   smoke project  → web :5173 → BFF :7878 (real dev URLs; only loads the app,
//                    asserts theme/health-dot; never drives a run, so it is
//                    independent of whether the live gateway is up). REUSES an
//                    already-running dev instance on purpose — it confirms the
//                    LIVE deployment, which is non-reproducible on a fresh clone,
//                    so it is excluded from the default run and gated behind a
//                    flag. Run it against a deployment you have already started:
//                      AGENT_DECK_SMOKE=1 pnpm e2e --project=smoke
//   live  project  → web :5173 → real BFF :7878 → live hermes gateway :8643. Drives
//                    a real streamed reply. Run only when explicitly opted in:
//                      AGENT_DECK_LIVE_SMOKE=1 pnpm e2e --project=live

// The hermetic mock instances bind their OWN ports — deliberately far from the
// user's live :7878/:5173 and the :5174 bridge unit — and are never reused, so a
// gate run is reproducible regardless of what else is running on the box.
const MOCK_BFF_PORT = 7899
const MOCK_WEB_PORT = 5199

// Opt-in DEPLOYMENT check (never gated): a browser-driven smoke against an
// already-running dev deployment on :5173/:7878. Excluded from the default
// `pnpm e2e` so the gate stays hermetic and reproducible.
//   AGENT_DECK_SMOKE=1 pnpm e2e --project=smoke
const smoke = process.env.AGENT_DECK_SMOKE === '1'

// Opt-in LIVE check (never gated): a browser-driven smoke against the REAL BFF +
// live gateway :8643.
//   AGENT_DECK_LIVE_SMOKE=1 pnpm e2e --project=live
const liveSmoke = process.env.AGENT_DECK_LIVE_SMOKE === '1'

export default defineConfig({
  testDir: './e2e',
  // The socket/run-heavy specs (chat fork / reload / resume) drive a full streamed
  // run + reconnect + replay-from-cursor through ONE shared mock BFF. Under full-suite
  // parallel load on a contended box that replay occasionally exceeds a timeout, though
  // every such test passes reliably in isolation. Two retries make the gate resilient
  // to that environmental latency WITHOUT masking real breakage — a genuinely broken
  // test still fails all attempts, and Playwright reports a passed-on-retry test as
  // "flaky" (visible, not hidden). This is latency tolerance, not a correctness waiver.
  retries: 2,
  projects: [
    {
      name: 'chat',
      // The streamed-run spec (chat.spec.ts), the client-side chat-media spec
      // (chat-media.spec.ts) which renders a user-sent image in the transcript,
      // and the agent rich-content spec (agent-markdown.spec.ts) which drives the
      // mock's "demo:table" / "demo:image" rich-content path. All share the chat
      // project's hermetic mock web → mock-BFF pair.
      testMatch: /(chat(-media)?|agent-markdown)\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${MOCK_WEB_PORT}` },
    },
    {
      // Cross-surface coverage (Sessions/Files/Models/Profiles/Settings/Usage),
      // the Terminal surface, and the Continue/resume loop. All hermetic: REST is
      // stubbed at the browser layer (page.route) so no live BFF/dashboard is hit;
      // the resume run rides the in-process mock `/chat-run` on the mock BFF, so
      // this project shares the chat project's mock web → mock-BFF pair.
      name: 'surfaces',
      testMatch:
        /(surfaces|route-smoke|terminal|terminal-dock|resume|reload|reconnect|polish|persistence|onboarding-journey|auth-unlock|agent-identity|keyboard|mobile|mobile-release|usage-provider|release-journey)\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${MOCK_WEB_PORT}` },
    },
    // Opt-in deployment check — excluded from the default gate (see header).
    ...(smoke
      ? [
          {
            name: 'smoke' as const,
            testMatch: /smoke\.spec\.ts/,
            use: { baseURL: 'http://127.0.0.1:5173' },
          },
        ]
      : []),
    // Opt-in live check — excluded from the default gate (see header).
    ...(liveSmoke
      ? [
          {
            name: 'live' as const,
            testMatch: /chat\.live\.spec\.ts/,
            use: { baseURL: process.env.AGENT_DECK_LIVE_URL ?? 'http://127.0.0.1:5173' },
          },
        ]
      : []),
  ],
  webServer: [
    // --- hermetic mock instance (chat + surfaces projects) ---
    // Dedicated ports, NEVER reused: each gate run boots its own mock BFF/web and
    // tears them down, so the hermetic projects are deterministic and decoupled
    // from any stale server already bound to a port.
    {
      command: `AGENT_DECK_PORT=${MOCK_BFF_PORT} pnpm --filter @agent-deck/server exec tsx scripts/serve-mock-gateway.mjs`,
      port: MOCK_BFF_PORT,
      reuseExistingServer: false,
    },
    {
      command: `AGENT_DECK_WEB_PORT=${MOCK_WEB_PORT} AGENT_DECK_BFF_TARGET=http://127.0.0.1:${MOCK_BFF_PORT} pnpm --filter @agent-deck/web dev`,
      port: MOCK_WEB_PORT,
      reuseExistingServer: false,
    },
    // --- opt-in real-deployment instance (smoke + live projects) ---
    // Only spun up / reused when the smoke or live project is enabled. Reuses an
    // already-running dev deployment on :7878/:5173 when present (the point of
    // the deployment / live check), and boots one otherwise. Excluded from the
    // default gate so the default run never touches these ports.
    ...(smoke || liveSmoke
      ? [
          {
            command: 'pnpm --filter @agent-deck/server exec tsx src/index.ts',
            port: 7878,
            reuseExistingServer: true,
          },
          {
            command: 'pnpm --filter @agent-deck/web dev',
            port: 5173,
            reuseExistingServer: true,
          },
        ]
      : []),
  ],
})

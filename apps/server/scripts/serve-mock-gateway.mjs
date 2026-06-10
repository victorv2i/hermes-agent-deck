/**
 * Hermetic e2e launcher — the agent-deck BFF wired to an IN-PROCESS MOCK gateway.
 *
 * The Playwright chat e2e (e2e/chat.spec.ts) runs this as a webServer so the
 * whole flow — `/chat-run` socket, run-store cursors, named-event surface — is
 * exercised end-to-end WITHOUT touching the live hermes gateway. The mock streams
 * a scripted run (streamed text → tool chip → approval → final text → completed)
 * and supports an approval round-trip and Stop/abort.
 *
 * Run via tsx so the TS source + the .test-support mock resolve:
 *   AGENT_DECK_PORT=7879 pnpm --filter @agent-deck/server exec tsx scripts/serve-mock-gateway.mjs
 *
 * Hermetic + safe: binds loopback only, never reads a gateway key, never talks
 * to :8643. The mock module is test-support (never in the production build); it
 * is loaded here, outside the built `src`, so nothing ships it.
 */
import { buildApp, attachChat } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { MockGatewayClient } from '../src/hermes/mockGatewayClient.test-support.ts'

const config = loadConfig()
const app = await buildApp(config)
attachChat(app, config, new MockGatewayClient())
await app.listen({ host: config.host, port: config.port })
console.log(
  `agent-deck MOCK server on http://${config.host}:${config.port} (in-process mock gateway)`,
)

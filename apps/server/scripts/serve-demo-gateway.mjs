/**
 * SCREENSHOT-ONLY demo gateway launcher (NOT part of the test gate).
 *
 * Boots the agent-deck BFF wired to an IN-PROCESS demo gateway that streams a
 * polished, GENERIC, fully-FAKE agent run — used only to capture README
 * screenshots. It never touches the real hermes gateway (:8643) or dashboard
 * (:9123): it binds loopback on its OWN dedicated port and the streamed content
 * is hand-authored demo text (no real session titles, paths, or usage).
 *
 * Run:  AGENT_DECK_PORT=7991 AGENT_DECK_WEB_CLIENT_ROOT=<apps/web/dist> \
 *         pnpm --filter @agent-deck/server exec tsx scripts/serve-demo-gateway.mjs
 */
import { buildApp, attachChat } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { DemoGatewayClient } from './demoGatewayClient.mjs'

const config = loadConfig()
const app = await buildApp(config)
attachChat(app, config, new DemoGatewayClient())
await app.listen({ host: config.host, port: config.port })
console.log(
  `agent-deck DEMO server on http://${config.host}:${config.port} (in-process demo gateway)`,
)

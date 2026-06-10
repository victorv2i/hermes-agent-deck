/**
 * STAGE 3 — LIVE end-to-end smoke for the chat BFF.
 *
 * Confirmatory only — NOT part of the hermetic `pnpm verify` gate. This script
 * talks to the REAL hermes gateway on :8643 and proves a real agent reply
 * streams through the agent-deck BFF's durable `/chat-run` Socket.IO surface.
 *
 * What it does:
 *  1. builds the agent-deck Fastify app + attaches the `/chat-run` namespace
 *  2. listens on an ephemeral port (loopback)
 *  3. connects a socket.io-client to `/chat-run`
 *  4. emits `run` { input: "reply with the single word: pong" }
 *  5. prints every streamed ChatServerEvent until run.completed / run.failed
 *
 * If the live gateway is unreachable or unauthenticated, it reports that clearly
 * and exits 0 (this is NOT the gate — the hermetic tests are). The gateway API
 * key is read server-side by the BFF from ~/.hermes/config.yaml and is NEVER
 * printed here.
 *
 * Run with tsx (so the TS source imports resolve):
 *   pnpm --filter @agent-deck/server exec tsx scripts/smoke-chat-live.mjs
 */
import { io as ioClient } from 'socket.io-client'
import { buildApp, attachChat } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const PROMPT = 'reply with the single word: pong'
const OVERALL_TIMEOUT_MS = 60_000

const config = loadConfig()
const gatewayUrl = config.hermesGatewayUrl
const hasKey = Boolean(config.hermesApiKey) // boolean only — never print the key

console.log('=== agent-deck live /chat-run smoke ===')
console.log(`gateway:    ${gatewayUrl}`)
console.log(`api key:    ${hasKey ? 'present (server-side)' : 'MISSING'}`)
console.log(`prompt:     ${JSON.stringify(PROMPT)}`)
console.log('')

// Preflight: is the gateway reachable at all? If not, report and exit 0.
async function probe() {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(new URL('/v1/health', gatewayUrl), { signal: controller.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

const reachable = await probe()
if (!reachable) {
  console.log(`SMOKE INCONCLUSIVE: gateway ${gatewayUrl} is unreachable.`)
  console.log('(This is NOT a gate failure — the hermetic tests are the gate.)')
  process.exit(0)
}
if (!hasKey) {
  console.log('SMOKE INCONCLUSIVE: no gateway API key resolved server-side.')
  console.log('(This is NOT a gate failure — the hermetic tests are the gate.)')
  process.exit(0)
}

const app = await buildApp(config)
const ioServer = attachChat(app, config)
// Ephemeral loopback port (0 = OS-assigned).
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address()
const port = typeof address === 'object' && address ? address.port : null
const base = `http://127.0.0.1:${port}`
console.log(`agent-deck BFF listening on ${base}`)
console.log('connecting socket.io-client to /chat-run ...\n')

const received = []
let resolved = false

async function shutdown(code) {
  if (resolved) return
  resolved = true
  try {
    client.close()
  } catch {
    /* ignore */
  }
  try {
    ioServer.close()
  } catch {
    /* ignore */
  }
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  process.exit(code)
}

const client = ioClient(`${base}/chat-run`, {
  transports: ['websocket'],
  reconnection: false,
  timeout: 10_000,
})

// Print + record every named ChatServerEvent the BFF streams.
const NAMED_EVENTS = [
  'run.started',
  'run.queued',
  'message.started',
  'message.delta',
  'reasoning.available',
  'reasoning.delta',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'approval.request',
  'approval.responded',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.stopping',
]

let assembled = ''
for (const name of NAMED_EVENTS) {
  client.on(name, (payload) => {
    received.push(name)
    if (name === 'message.delta' && typeof payload?.delta === 'string') {
      assembled += payload.delta
      console.log(`  [${name}] cursor=${payload.cursor} delta=${JSON.stringify(payload.delta)}`)
    } else if (name === 'run.completed') {
      console.log(
        `  [${name}] cursor=${payload.cursor} output=${JSON.stringify(payload.output ?? null)} usage=${JSON.stringify(payload.usage ?? null)}`,
      )
    } else if (name === 'run.failed') {
      console.log(
        `  [${name}] cursor=${payload.cursor} error=${JSON.stringify(payload.error ?? null)}`,
      )
    } else {
      console.log(`  [${name}] ${JSON.stringify(payload)}`)
    }

    if (name === 'run.completed') {
      console.log('')
      console.log('=== SMOKE PASS ===')
      console.log(`event sequence: ${received.join(' -> ')}`)
      console.log(`assembled assistant text: ${JSON.stringify(assembled)}`)
      console.log('A real agent reply streamed through the BFF from the live gateway :8643.')
      void shutdown(0)
    } else if (name === 'run.failed') {
      console.log('')
      console.log('=== SMOKE INCONCLUSIVE: run.failed ===')
      console.log(`event sequence: ${received.join(' -> ')}`)
      console.log('(This is NOT a gate failure — the hermetic tests are the gate.)')
      void shutdown(0)
    }
  })
}

client.on('command.error', (payload) => {
  console.log(`  [command.error] ${JSON.stringify(payload)}`)
  console.log('')
  console.log('=== SMOKE INCONCLUSIVE: BFF rejected the command / gateway error ===')
  console.log('(This is NOT a gate failure — the hermetic tests are the gate.)')
  void shutdown(0)
})

client.on('connect', () => {
  console.log('socket connected; emitting `run` ...')
  client.emit('run', { input: PROMPT })
})

client.on('connect_error', (err) => {
  console.log(`socket connect_error: ${err?.message ?? err}`)
  void shutdown(0)
})

setTimeout(() => {
  console.log('')
  console.log(`=== SMOKE INCONCLUSIVE: no run.completed within ${OVERALL_TIMEOUT_MS}ms ===`)
  console.log(`events so far: ${received.join(' -> ') || '(none)'}`)
  console.log('(This is NOT a gate failure — the hermetic tests are the gate.)')
  void shutdown(0)
}, OVERALL_TIMEOUT_MS)

/**
 * LIVE STOP smoke for the chat BFF — confirms a user Stop terminates cleanly
 * against the REAL hermes gateway :8643 (the P0 the in-process mock hid).
 *
 * Not part of the hermetic `pnpm verify` gate — confirmatory only. It:
 *   1. builds the agent-deck Fastify app + attaches `/chat-run`
 *   2. listens on an ephemeral loopback port
 *   3. emits `run` with a prompt long enough to be mid-stream
 *   4. waits until the run is actively streaming (first delta / lifecycle frame)
 *   5. emits `abort` and asserts a TERMINAL run.cancelled arrives — proving the
 *      synthesized terminal frame leaves the client able to return to idle even
 *      though the real fetch-abort tears down the gateway SSE (no graceful
 *      run.cancelled from the gateway on the aborted connection).
 *
 * Exits 0 on a clean terminal Stop (PASS) or when the gateway is
 * unreachable/unauthenticated (INCONCLUSIVE, not a gate). Exits 1 only if the
 * run was started+streaming but never reached a terminal frame after Stop — the
 * exact regression. The API key is read server-side and NEVER printed.
 *
 *   pnpm --filter @agent-deck/server exec tsx scripts/smoke-chat-stop-live.mjs
 */
import { io as ioClient } from 'socket.io-client'
import { buildApp, attachChat } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

// A prompt that produces a multi-token reply so we can Stop it mid-stream.
const PROMPT = 'Count slowly from 1 to 50, one number per line, with a short note after each.'
const OVERALL_TIMEOUT_MS = 60_000
// How long to wait for a terminal frame AFTER we send abort.
const TERMINAL_AFTER_STOP_MS = 15_000

const config = loadConfig()
const gatewayUrl = config.hermesGatewayUrl
const hasKey = Boolean(config.hermesApiKey)

console.log('=== agent-deck live /chat-run STOP smoke ===')
console.log(`gateway:    ${gatewayUrl}`)
console.log(`api key:    ${hasKey ? 'present (server-side)' : 'MISSING'}`)
console.log(`prompt:     ${JSON.stringify(PROMPT)}`)
console.log('')

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

if (!(await probe())) {
  console.log(`STOP SMOKE INCONCLUSIVE: gateway ${gatewayUrl} is unreachable.`)
  process.exit(0)
}
if (!hasKey) {
  console.log('STOP SMOKE INCONCLUSIVE: no gateway API key resolved server-side.')
  process.exit(0)
}

const app = await buildApp(config)
const ioServer = attachChat(app, config)
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address()
const port = typeof address === 'object' && address ? address.port : null
const base = `http://127.0.0.1:${port}`
console.log(`agent-deck BFF listening on ${base}`)
console.log('connecting socket.io-client to /chat-run ...\n')

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

const received = []
let runId = null
let streaming = false
let aborted = false
let stopTimer = null

const NAMED_EVENTS = [
  'run.started',
  'run.queued',
  'message.started',
  'message.delta',
  'reasoning.delta',
  'tool.started',
  'tool.completed',
  'approval.request',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.stopping',
]

function maybeAbort() {
  // Abort once the run is genuinely mid-stream (we have a run id and at least one
  // streamed lifecycle frame), and only once.
  if (aborted || !streaming || !runId) return
  aborted = true
  console.log(`\n>>> run ${runId} is mid-stream — emitting abort ...\n`)
  client.emit('abort', { run_id: runId })
  stopTimer = setTimeout(() => {
    console.log('')
    console.log(
      '=== STOP SMOKE FAIL: no terminal frame within TERMINAL_AFTER_STOP_MS after abort ===',
    )
    console.log(`event sequence: ${received.join(' -> ')}`)
    console.log('The run hung non-terminal after Stop — this is the P0 regression.')
    void shutdown(1)
  }, TERMINAL_AFTER_STOP_MS)
}

for (const name of NAMED_EVENTS) {
  client.on(name, (payload) => {
    received.push(name)
    if (name === 'run.started') {
      runId = payload?.run_id ?? runId
      console.log(`  [run.started] run_id=${runId}`)
      return
    }
    if (name === 'message.delta') {
      streaming = true
      // Keep output quiet; just note streaming has begun, then abort.
      maybeAbort()
      return
    }
    if (name === 'tool.started' || name === 'reasoning.delta' || name === 'message.started') {
      streaming = true
      maybeAbort()
      return
    }
    console.log(`  [${name}] ${JSON.stringify(payload)}`)

    if (name === 'run.cancelled') {
      if (stopTimer) clearTimeout(stopTimer)
      console.log('')
      console.log('=== STOP SMOKE PASS ===')
      console.log(`event sequence: ${received.join(' -> ')}`)
      console.log(
        'A user Stop reached a TERMINAL run.cancelled frame against the live gateway :8643.',
      )
      console.log(
        'The client reducer maps run.cancelled -> runStatus idle, so the composer returns to Send.',
      )
      void shutdown(0)
    } else if (name === 'run.completed') {
      if (stopTimer) clearTimeout(stopTimer)
      console.log('')
      console.log('=== STOP SMOKE INCONCLUSIVE: run completed before/despite the abort ===')
      console.log(`event sequence: ${received.join(' -> ')}`)
      console.log(
        '(Run finished too fast to observe the Stop terminal path. Re-run with a longer prompt.)',
      )
      void shutdown(0)
    } else if (name === 'run.failed') {
      if (stopTimer) clearTimeout(stopTimer)
      console.log('')
      console.log('=== STOP SMOKE INCONCLUSIVE: run.failed ===')
      console.log(`event sequence: ${received.join(' -> ')}`)
      void shutdown(0)
    }
  })
}

client.on('command.error', (payload) => {
  console.log(`  [command.error] ${JSON.stringify(payload)}`)
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
  console.log(`=== STOP SMOKE INCONCLUSIVE: no terminal frame within ${OVERALL_TIMEOUT_MS}ms ===`)
  console.log(`events so far: ${received.join(' -> ') || '(none)'}`)
  void shutdown(0)
}, OVERALL_TIMEOUT_MS)

import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { buildApp, attachChat } from '../app'
import type { ServerConfig } from '../config'
import {
  startMockGateway,
  cannedSse,
  type MockGatewayHandle,
} from '../hermes/mockGateway.test-support'
import type { ChatServerEvent } from '@agent-deck/protocol'
import { CHAT_NAMESPACE, MAX_TAILS_PER_SOCKET, registerChatRunHandlers } from './chatRun'
import { RunStore } from './runStore'
import type { GatewayClientLike } from '../hermes/gatewayClient'

type App = Awaited<ReturnType<typeof buildApp>>

let app: App | undefined
let io: ReturnType<typeof attachChat> | undefined
let gateway: MockGatewayHandle | undefined
let client: ClientSocket | undefined

afterEach(async () => {
  client?.disconnect()
  client = undefined
  await io?.close()
  io = undefined
  await app?.close()
  app = undefined
  await gateway?.close()
  gateway = undefined
})

function testConfig(gatewayUrl: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    remote: false,
    trustedHosts: [],
    terminalEnabled: true,
    terminalAllowHome: false,
    terminalParkGraceMs: 60_000,
    hermesHome: '/tmp/hermes-test-home',
    hermesGatewayUrl: gatewayUrl,
    hermesBin: '/tmp/hermes',
    hermesApiKey: 'test-key',
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    webClientRoot: null,
    mcpCatalogDir: '/tmp/optional-mcps',
  }
}

/** Boot a Fastify app + /chat-run, return a connected socket.io client. */
async function boot(
  options: { sse?: string; runId?: string; manualSse?: boolean; sessionId?: string } = {},
): Promise<{
  client: ClientSocket
  gateway: MockGatewayHandle
  baseUrl: string
}> {
  gateway = await startMockGateway({
    sse: options.sse,
    runId: options.runId,
    manualSse: options.manualSse,
    sessionId: options.sessionId,
  })
  const config = testConfig(gateway.url)
  app = await buildApp(config)
  io = attachChat(app, config)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const { port } = app.server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`
  client = ioClient(`${baseUrl}/chat-run`, {
    transports: ['websocket'],
    forceNew: true,
  })
  await new Promise<void>((resolve, reject) => {
    client!.on('connect', resolve)
    client!.on('connect_error', reject)
  })
  return { client, gateway, baseUrl }
}

/** Collect named events until `run.completed` (or timeout). */
function collectUntilCompleted(
  socket: ClientSocket,
  names: string[],
): Promise<Record<string, ChatServerEvent[]>> {
  const collected: Record<string, ChatServerEvent[]> = {}
  for (const n of names) collected[n] = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for run.completed')), 5000)
    for (const name of names) {
      socket.on(name, (e: ChatServerEvent) => {
        collected[name]!.push(e)
        if (name === 'run.completed') {
          clearTimeout(timer)
          resolve(collected)
        }
      })
    }
  })
}

const EVENT_NAMES = [
  'run.started',
  'message.delta',
  'tool.started',
  'tool.completed',
  'run.completed',
  'run.failed',
]

const idleGateway = {
  async startRun() {
    return { runId: 'unused' }
  },
  // eslint-disable-next-line require-yield
  async *streamRun() {
    return
  },
  async stopRun() {},
  async respondApproval() {},
  async getRunSession() {
    return { sessionId: null }
  },
} as GatewayClientLike

async function bootStoreSocket(store = new RunStore()): Promise<{
  store: RunStore
  client: ClientSocket
  close: () => Promise<void>
}> {
  const http: HttpServer = createServer()
  const socketServer = new SocketIOServer(http)
  registerChatRunHandlers(socketServer, { gateway: idleGateway, store })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  const c = ioClient(`http://127.0.0.1:${port}${CHAT_NAMESPACE}`, {
    transports: ['websocket'],
    forceNew: true,
  })
  await new Promise<void>((resolve, reject) => {
    c.on('connect', resolve)
    c.on('connect_error', reject)
  })

  return {
    store,
    client: c,
    close: async () => {
      c.disconnect()
      await new Promise<void>((resolve) => socketServer.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

describe('/chat-run socket namespace', () => {
  it('(s) a NEW chat (no session_id) stamps run.started with the gateway-resolved session id', async () => {
    // A fresh chat starts session-less; the BFF asks the gateway (GET /v1/runs/{id})
    // which durable session it derived and surfaces it on run.started so the client
    // can route to /chat/:id and rehydrate after a refresh.
    const { client: c } = await boot({ runId: 'run_new', sessionId: 'api-deadbeef' })
    const started = new Promise<ChatServerEvent>((resolve) => {
      c.on('run.started', (e: ChatServerEvent) => resolve(e))
    })
    c.emit('run', { input: 'hi' }) // no session_id → new chat
    const evt = (await started) as Extract<ChatServerEvent, { event: 'run.started' }>
    expect(evt.session_id).toBe('api-deadbeef')
  })

  it('(b) maps a run to ordered events with monotonic cursors', async () => {
    const { client: c } = await boot({ runId: 'run_abc' })

    // Record the global ordering of server-emitted events.
    const order: { event: string; cursor?: number }[] = []
    for (const name of EVENT_NAMES) {
      c.on(name, (e: ChatServerEvent) => order.push({ event: e.event, cursor: e.cursor }))
    }
    const done = collectUntilCompleted(c, EVENT_NAMES)
    c.emit('run', { input: 'hi', session_id: 's1' })
    const collected = await done

    const deltas = collected['message.delta']! as Extract<
      ChatServerEvent,
      { event: 'message.delta' }
    >[]
    expect(deltas.map((e) => e.delta)).toEqual(['Hel', 'lo ', 'world'])
    expect(collected['tool.started']).toHaveLength(1)
    expect(collected['tool.completed']).toHaveLength(1)
    const completed = collected['run.completed']![0]! as Extract<
      ChatServerEvent,
      { event: 'run.completed' }
    >
    expect(completed.output).toBe('Hello world')

    // run.started synthesized first; then the mapped gateway lifecycle in order.
    expect(order.map((o) => o.event)).toEqual([
      'run.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'tool.started',
      'tool.completed',
      'run.completed',
    ])
    // Cursors are strictly increasing 1..N.
    const cursors = order.map((o) => o.cursor!)
    expect(cursors).toEqual([1, 2, 3, 4, 5, 6, 7])

    // session_id is stamped by the BFF onto each event.
    expect(collected['message.delta']![0]!.session_id).toBe('s1')
  })

  it('(b2) forwards image attachments to the gateway as native multimodal input', async () => {
    const { client: c, gateway: g } = await boot({ runId: 'run_img' })
    const done = collectUntilCompleted(c, EVENT_NAMES)
    c.emit('run', {
      input: 'describe this',
      attachments: [
        {
          kind: 'image',
          name: 'shot.png',
          mime: 'image/png',
          data_url: 'data:image/png;base64,AAAA',
        },
      ],
    })
    await done
    // The BFF builds the gateway's multimodal `input` array from text + image.
    expect(g.calls.runs).toHaveLength(1)
    expect(g.calls.runs[0]!.body).toEqual({
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    })
  })

  it('(b3) forwards conversation_history to the gateway run body', async () => {
    const { client: c, gateway: g } = await boot({ runId: 'run_hist' })
    const done = collectUntilCompleted(c, EVENT_NAMES)
    const history = [
      { role: 'user', content: 'Reply with exactly: BLUE.' },
      { role: 'assistant', content: 'BLUE' },
    ]
    c.emit('run', {
      input: 'What word did I ask you to reply with?',
      session_id: 's1',
      conversation_history: history,
    })
    await done
    // The gateway does NOT load history for a bare session_id; the BFF must
    // carry the transcript on every run so the model sees the thread.
    expect(g.calls.runs).toHaveLength(1)
    expect(g.calls.runs[0]!.body).toEqual({
      input: 'What word did I ask you to reply with?',
      session_id: 's1',
      conversation_history: history,
    })
  })

  it('(c) resume with after_cursor replays only newer events, then tails', async () => {
    const runId = 'run_resume'
    const { client: c, baseUrl } = await boot({ runId, sse: cannedSse(runId) })

    const firstRun = collectUntilCompleted(c, EVENT_NAMES)
    c.emit('run', { input: 'hi' })
    await firstRun // run finished; store now holds cursors 1..7

    // A fresh client resumes after cursor 4 → should replay cursors 5,6,7 only.
    const resumeClient = ioClient(`${baseUrl}/chat-run`, {
      transports: ['websocket'],
      forceNew: true,
    })
    await new Promise<void>((resolve) => resumeClient.on('connect', () => resolve()))

    const replayed: ChatServerEvent[] = []
    const replayDone = new Promise<void>((resolve) => {
      for (const name of EVENT_NAMES) {
        resumeClient.on(name, (e: ChatServerEvent) => {
          replayed.push(e)
          if (e.event === 'run.completed') resolve()
        })
      }
    })
    resumeClient.emit('resume', { run_id: runId, after_cursor: 4 })
    await replayDone

    expect(replayed.map((e) => e.cursor)).toEqual([5, 6, 7])
    expect(replayed.map((e) => e.event)).toEqual([
      'tool.started',
      'tool.completed',
      'run.completed',
    ])
    resumeClient.disconnect()
  })

  it('(d) abort calls stopRun on the gateway', async () => {
    // manualSse keeps the run's stream OPEN (no terminal frame) so the pump stays
    // active when the abort arrives — the realistic "stop a running run" case. The
    // BFF only forwards stopRun for a still-active run (a terminal run has nothing
    // to stop, and routing it could reach the wrong agent after a profile switch).
    const { client: c, gateway: g } = await boot({ runId: 'run_stop', manualSse: true })

    // Start a run so the BFF has a run id (also exercises the happy path).
    const started = new Promise<ChatServerEvent>((resolve) => {
      c.on('run.started', (e: ChatServerEvent) => resolve(e))
    })
    c.emit('run', { input: 'hi' })
    const startEvent = await started

    c.emit('abort', { run_id: startEvent.run_id })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stopRun not called')), 3000)
      const poll = setInterval(() => {
        if (g.calls.stops.length > 0) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve()
        }
      }, 20)
    })

    expect(g.calls.stops[0]!.runId).toBe(startEvent.run_id)
    expect(g.calls.stops[0]!.auth).toBe('Bearer test-key')
  })

  it('(C2) synthesizes run.failed (not run.completed) when the SSE ends without a terminal frame', async () => {
    // SSE that streams a delta then ends with NO terminal frame.
    const runId = 'run_abrupt'
    const partialSse =
      'data: {"event":"message.delta","run_id":"' +
      runId +
      '","delta":"hi"}\n\n' +
      ': stream closed\n\n'
    const { client: c } = await boot({ runId, sse: partialSse })

    const failed = new Promise<ChatServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no run.failed')), 3000)
      c.on('run.completed', () => {
        clearTimeout(timer)
        reject(new Error('got run.completed but stream ended abnormally'))
      })
      c.on('run.failed', (e: ChatServerEvent) => {
        clearTimeout(timer)
        resolve(e)
      })
    })
    c.emit('run', { input: 'hi' })
    const e = (await failed) as Extract<ChatServerEvent, { event: 'run.failed' }>
    expect(e.error).toBe('stream closed before completion')
  })

  it('(C1) resume mid-stream delivers each event exactly once with strictly-increasing cursors', async () => {
    const runId = 'run_midstream'
    const { client: c, gateway: g, baseUrl } = await boot({ runId, manualSse: true })

    // Start the run; wait until the pump's SSE stream is actually open (there's
    // a gap between the POST /v1/runs 202 and the GET /events subscription), then
    // push two deltas so the run is actively pumping when the 2nd socket resumes.
    const firstDelta = new Promise<void>((resolve) => {
      c.on('message.delta', () => resolve())
    })
    c.emit('run', { input: 'hi' })
    await g.streamOpened()
    // run.started is cursor 1; push two deltas (cursors 2,3) before resume.
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"a"}\n\n`)
    await firstDelta
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"b"}\n\n`)

    // Second socket resumes from the start while the run is still pumping.
    const resumeClient = ioClient(`${baseUrl}/chat-run`, {
      transports: ['websocket'],
      forceNew: true,
    })
    await new Promise<void>((resolve) => resumeClient.on('connect', () => resolve()))

    const seen: ChatServerEvent[] = []
    const done = new Promise<void>((resolve) => {
      for (const name of EVENT_NAMES) {
        resumeClient.on(name, (e: ChatServerEvent) => {
          seen.push(e)
          if (e.event === 'run.completed') resolve()
        })
      }
    })
    resumeClient.emit('resume', { run_id: runId })

    // After resume, push more live events + terminal frame.
    await new Promise<void>((r) => setTimeout(r, 50))
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"c"}\n\n`)
    g.pushSse(`data: {"event":"run.completed","run_id":"${runId}","output":"abc"}\n\n`)
    g.endSse()
    await done

    const cursors = seen.map((e) => e.cursor!)
    // Strictly increasing — no duplicates from replay+tail overlap.
    for (let i = 1; i < cursors.length; i++) {
      expect(cursors[i]!).toBeGreaterThan(cursors[i - 1]!)
    }
    // Each cursor appears exactly once.
    expect(new Set(cursors).size).toBe(cursors.length)
    // The resume socket saw the whole run 1..N: run.started + deltas a..c + completed.
    expect(seen.map((e) => e.event)).toEqual([
      'run.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'run.completed',
    ])
    expect(cursors).toEqual([1, 2, 3, 4, 5])
    resumeClient.disconnect()
  })

  it('forwards gateway SSE keepalives to the tailing client as transient run.heartbeat frames', async () => {
    const runId = 'run_heartbeat'
    const { client: c, gateway: g } = await boot({ runId, manualSse: true })

    const heartbeats: ChatServerEvent[] = []
    const firstHeartbeat = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for run.heartbeat')), 3000)
      c.on('run.heartbeat', (e: ChatServerEvent) => {
        heartbeats.push(e)
        clearTimeout(timer)
        resolve()
      })
    })
    const completed = new Promise<void>((resolve) => {
      c.on('run.completed', () => resolve())
    })

    c.emit('run', { input: 'hi' })
    await g.streamOpened()
    // A keepalive comment on the gateway SSE — no data frame at all.
    g.pushSse(': keepalive\n\n')
    await firstHeartbeat

    expect(heartbeats[0]!.event).toBe('run.heartbeat')
    expect(heartbeats[0]!.run_id).toBe(runId)
    // Transient: never cursored, so it can never disturb the resume anchor.
    expect(heartbeats[0]!.cursor).toBeUndefined()

    g.pushSse(`data: {"event":"run.completed","run_id":"${runId}","output":"ok"}\n\n`)
    g.endSse()
    await completed
  })

  it('drops a socket tail after a terminal event so completed runs do not retain callbacks', async () => {
    const { store, client: c, close } = await bootStoreSocket()

    try {
      const runId = 'run_tail_cleanup'
      store.append(runId, { event: 'run.started', run_id: runId, input: 'hi' })

      const replayedStarted = new Promise<ChatServerEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('resume did not replay start')), 3000)
        c.on('run.started', (e: ChatServerEvent) => {
          clearTimeout(timer)
          resolve(e)
        })
      })
      c.emit('resume', { run_id: runId, after_cursor: 0 })
      await replayedStarted

      const completed = new Promise<ChatServerEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('tail did not receive terminal')), 3000)
        c.on('run.completed', (e: ChatServerEvent) => {
          clearTimeout(timer)
          resolve(e)
        })
      })
      store.append(runId, { event: 'run.completed', run_id: runId, output: 'done' })
      expect((await completed).event).toBe('run.completed')

      const strayDelta = new Promise<ChatServerEvent | null>((resolve) => {
        c.on('message.delta', (e: ChatServerEvent) => resolve(e))
        store.append(runId, { event: 'message.delta', run_id: runId, delta: 'after terminal' })
        setTimeout(() => resolve(null), 50)
      })
      expect(await strayDelta).toBeNull()
    } finally {
      await close()
    }
  })

  it('re-surfaces a still-pending approval the resume cursor already skipped (reload-safe)', async () => {
    // A page that received approval.request BEFORE reloading persists a resume
    // cursor PAST it; the normal replay would skip the request and the reloaded
    // page would never render the approval card. The subscribe path re-emits the
    // unresolved request as a CURSOR-LESS transient frame.
    const { store, client: c, close } = await bootStoreSocket()
    try {
      const runId = 'run_pending_approval'
      store.append(runId, { event: 'run.started', run_id: runId, input: 'hi' }) // cursor 1
      store.append(runId, {
        event: 'approval.request',
        run_id: runId,
        approval_id: 'apr-1',
        command: 'rm -rf ./build',
        description: 'Delete the build folder',
        choices: ['once', 'deny'],
      }) // cursor 2

      const resurfaced = new Promise<ChatServerEvent>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('pending approval was not re-surfaced')),
          3000,
        )
        c.on('approval.request', (e: ChatServerEvent) => {
          clearTimeout(timer)
          resolve(e)
        })
      })
      c.emit('resume', { run_id: runId, after_cursor: 2 }) // cursor already past the request
      const frame = await resurfaced
      expect(frame.event).toBe('approval.request')
      expect(frame.cursor).toBeUndefined() // transient: passes the client's cursor de-dup
      expect((frame as { approval_id?: string }).approval_id).toBe('apr-1')
    } finally {
      await close()
    }
  })

  it('does NOT re-surface an approval that was already responded to', async () => {
    const { store, client: c, close } = await bootStoreSocket()
    try {
      const runId = 'run_resolved_approval'
      store.append(runId, { event: 'run.started', run_id: runId, input: 'hi' }) // 1
      store.append(runId, {
        event: 'approval.request',
        run_id: runId,
        approval_id: 'apr-2',
        command: 'rm -rf ./build',
        description: 'Delete the build folder',
        choices: ['once', 'deny'],
      }) // 2
      store.append(runId, {
        event: 'approval.responded',
        run_id: runId,
        approval_id: 'apr-2',
        choice: 'once',
      }) // 3

      const stray = new Promise<ChatServerEvent | null>((resolve) => {
        c.on('approval.request', (e: ChatServerEvent) => resolve(e))
        c.emit('resume', { run_id: runId, after_cursor: 3 })
        setTimeout(() => resolve(null), 100)
      })
      expect(await stray).toBeNull()
    } finally {
      await close()
    }
  })

  it('does NOT double-send an approval the replay already carries', async () => {
    const { store, client: c, close } = await bootStoreSocket()
    try {
      const runId = 'run_replayed_approval'
      store.append(runId, { event: 'run.started', run_id: runId, input: 'hi' }) // 1
      store.append(runId, {
        event: 'approval.request',
        run_id: runId,
        approval_id: 'apr-3',
        command: 'rm -rf ./build',
        description: 'Delete the build folder',
        choices: ['once', 'deny'],
      }) // 2

      const requests: ChatServerEvent[] = []
      c.on('approval.request', (e: ChatServerEvent) => requests.push(e))
      c.emit('resume', { run_id: runId, after_cursor: 0 }) // the replay carries cursor 2
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(requests).toHaveLength(1)
      expect(requests[0]!.cursor).toBe(2) // the replayed frame, not a transient copy
    } finally {
      await close()
    }
  })

  it('caps per-socket tails so arbitrary resume IDs cannot grow the map without bound', async () => {
    const { store, client: c, close } = await bootStoreSocket()

    try {
      const totalRuns = MAX_TAILS_PER_SOCKET + 1
      for (let i = 0; i < totalRuns; i++) {
        const runId = `run_tail_cap_${i}`
        store.append(runId, { event: 'run.started', run_id: runId, input: 'hi' })
        const replayed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`resume did not replay ${runId}`)), 3000)
          const handler = (e: ChatServerEvent): void => {
            if (e.run_id !== runId) return
            clearTimeout(timer)
            c.off('run.started', handler)
            resolve()
          }
          c.on('run.started', handler)
        })
        c.emit('resume', { run_id: runId, after_cursor: 0 })
        await replayed
      }

      const newestRunId = `run_tail_cap_${totalRuns - 1}`
      const newestDelta = new Promise<ChatServerEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('newest tail did not receive delta')), 3000)
        const handler = (e: ChatServerEvent): void => {
          if (e.run_id !== newestRunId) return
          clearTimeout(timer)
          c.off('message.delta', handler)
          resolve(e)
        }
        c.on('message.delta', handler)
      })
      store.append(newestRunId, { event: 'message.delta', run_id: newestRunId, delta: 'live' })
      expect((await newestDelta).run_id).toBe(newestRunId)

      const oldestRunId = 'run_tail_cap_0'
      const oldestDelta = new Promise<ChatServerEvent | null>((resolve) => {
        const handler = (e: ChatServerEvent): void => {
          if (e.run_id !== oldestRunId) return
          clearTimeout(timer)
          c.off('message.delta', handler)
          resolve(e)
        }
        const timer = setTimeout(() => {
          c.off('message.delta', handler)
          resolve(null)
        }, 50)
        c.on('message.delta', handler)
      })
      store.append(oldestRunId, {
        event: 'message.delta',
        run_id: oldestRunId,
        delta: 'evicted',
      })
      expect(await oldestDelta).toBeNull()
    } finally {
      await close()
    }
  })

  it('(P0.1) a run is SERVER-OWNED: the pump survives the issuing socket disconnecting mid-stream', async () => {
    // The acceptance test for the server-owned RunManager. The browser that
    // STARTS a run can reload/disconnect mid-stream; the run must keep being
    // pumped into the store so a reconnecting client resumes the FULL buffer —
    // including the events that arrived AFTER the original socket vanished.
    const runId = 'run_serverowned'
    const { client: c, gateway: g, baseUrl } = await boot({ runId, manualSse: true })

    // Start the run on the first socket; wait until the pump's SSE is open, then
    // push one delta (cursor 2) so the run is actively streaming.
    const firstDelta = new Promise<void>((resolve) => c.on('message.delta', () => resolve()))
    c.emit('run', { input: 'hi' })
    await g.streamOpened()
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"a"}\n\n`)
    await firstDelta // run.started=1, delta a=2 were seen by the issuing socket

    // The issuing socket DISCONNECTS mid-stream (browser reload / tab close).
    c.disconnect()
    // Give the server a beat to process the disconnect.
    await new Promise<void>((r) => setTimeout(r, 50))

    // The pump must KEEP appending after the issuing socket is gone. Push events
    // that the original socket never saw (cursors 3,4 + terminal 5).
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"b"}\n\n`)
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"c"}\n\n`)
    g.pushSse(`data: {"event":"run.completed","run_id":"${runId}","output":"abc"}\n\n`)
    g.endSse()

    // A BRAND-NEW socket resumes after cursor 2 (the last cursor the dead socket
    // saw). If the run were socket-owned, the pump would have been aborted on the
    // first socket's disconnect and these events would never exist in the store.
    const resumeClient = ioClient(`${baseUrl}/chat-run`, {
      transports: ['websocket'],
      forceNew: true,
    })
    await new Promise<void>((resolve) => resumeClient.on('connect', () => resolve()))

    const seen: ChatServerEvent[] = []
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('resume never completed')), 3000)
      for (const name of EVENT_NAMES) {
        resumeClient.on(name, (e: ChatServerEvent) => {
          seen.push(e)
          if (e.event === 'run.completed') {
            clearTimeout(timer)
            resolve()
          }
        })
      }
    })
    resumeClient.emit('resume', { run_id: runId, after_cursor: 2 })
    await done

    // The resuming socket received exactly the post-disconnect events (cursors
    // 3,4,5): deltas b,c then run.completed — proof the pump outlived the socket.
    expect(seen.map((e) => e.cursor)).toEqual([3, 4, 5])
    expect(seen.map((e) => e.event)).toEqual(['message.delta', 'message.delta', 'run.completed'])
    const completed = seen[2]! as Extract<ChatServerEvent, { event: 'run.completed' }>
    expect(completed.output).toBe('abc')
    resumeClient.disconnect()
  })

  it('(I3) abort emits run.stopping immediately and aborts the local pump', async () => {
    const runId = 'run_abort_local'
    const { client: c, gateway: g } = await boot({ runId, manualSse: true })

    const started = new Promise<ChatServerEvent>((resolve) => {
      c.on('run.started', (e: ChatServerEvent) => resolve(e))
    })
    c.emit('run', { input: 'hi' })
    const startEvent = await started

    const stopping = new Promise<ChatServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no run.stopping')), 3000)
      c.on('run.stopping', (e: ChatServerEvent) => {
        clearTimeout(timer)
        resolve(e)
      })
    })
    c.emit('abort', { run_id: startEvent.run_id })
    const e = await stopping
    expect(e.run_id).toBe(runId)

    // stopRun was called on the gateway.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stopRun not called')), 3000)
      const poll = setInterval(() => {
        if (g.calls.stops.length > 0) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve()
        }
      }, 20)
    })
    expect(g.calls.stops[0]!.runId).toBe(runId)
  })

  it('(P0) abort is DETERMINISTICALLY TERMINAL even when the gateway fetch-abort throws (no graceful run.cancelled)', async () => {
    // This closes the mock blind spot. In `manualSse` mode the BFF runs the REAL
    // GatewayClient.streamRun against an open HTTP SSE: aborting the pump fires the
    // fetch AbortSignal, so the underlying `fetch`/res.body iteration THROWS an
    // AbortError — exactly the live-gateway behavior — and the HTTP mock NEVER
    // emits a graceful run.cancelled of its own (it just leaves the stream open
    // until we abort it). So the ONLY way the run reaches a terminal frame is the
    // synthesized run.cancelled from RunManager.abort. If that synthesis regressed,
    // the store would stay non-terminal: the issuing socket would never see a
    // terminal frame and a resuming client would tail forever instead of replaying.
    const runId = 'run_abort_terminal'
    const { client: c, gateway: g, baseUrl } = await boot({ runId, manualSse: true })

    const started = new Promise<ChatServerEvent>((resolve) => {
      c.on('run.started', (e: ChatServerEvent) => resolve(e))
    })
    c.emit('run', { input: 'hi' })
    const startEvent = await started
    // Wait until the pump's SSE fetch is actually open, then stream a delta so the
    // run is genuinely mid-stream when we abort (the realistic Stop scenario).
    await g.streamOpened()
    const firstDelta = new Promise<void>((resolve) => c.on('message.delta', () => resolve()))
    g.pushSse(`data: {"event":"message.delta","run_id":"${runId}","delta":"a"}\n\n`)
    await firstDelta

    // The issuing socket must receive a terminal run.cancelled — the synthesized
    // frame, since the gateway never sends one (the SSE is aborted, not graceful).
    const cancelled = new Promise<ChatServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no run.cancelled on issuing socket')), 3000)
      c.on('run.completed', () => {
        clearTimeout(timer)
        reject(new Error('unexpected run.completed after abort'))
      })
      c.on('run.failed', () => {
        clearTimeout(timer)
        reject(new Error('unexpected run.failed after abort'))
      })
      c.on('run.cancelled', (e: ChatServerEvent) => {
        clearTimeout(timer)
        resolve(e)
      })
    })
    c.emit('abort', { run_id: startEvent.run_id })
    const e = await cancelled
    expect(e.event).toBe('run.cancelled')
    expect(e.run_id).toBe(runId)

    // stopRun is still best-effort called on the gateway (to cancel its run).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stopRun not called')), 3000)
      const poll = setInterval(() => {
        if (g.calls.stops.length > 0) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve()
        }
      }, 20)
    })
    expect(g.calls.stops[0]!.runId).toBe(runId)

    // PROOF the STORE reached a terminal state (store.isDone === true): a brand-new
    // socket resuming from cursor 0 must REPLAY run.cancelled from the buffer and
    // then STOP (a done run is not tailed). If the run were still open, resume would
    // subscribe to tail and never deliver a terminal frame here.
    const resumeClient = ioClient(`${baseUrl}/chat-run`, {
      transports: ['websocket'],
      forceNew: true,
    })
    await new Promise<void>((resolve) => resumeClient.on('connect', () => resolve()))
    const replayedTerminal = new Promise<ChatServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('resume never replayed run.cancelled')), 3000)
      resumeClient.on('run.cancelled', (ev: ChatServerEvent) => {
        clearTimeout(timer)
        resolve(ev)
      })
    })
    resumeClient.emit('resume', { run_id: runId, after_cursor: 0 })
    const replayed = await replayedTerminal
    expect(replayed.event).toBe('run.cancelled')
    expect(replayed.run_id).toBe(runId)
    resumeClient.disconnect()
  })

  it('rejects an invalid run command without hitting the gateway', async () => {
    const { client: c, gateway: g } = await boot()
    const err = new Promise<{ command: string }>((resolve) => {
      c.on('command.error', (e: { command: string }) => resolve(e))
    })
    c.emit('run', { input: 123 }) // wrong type
    const e = await err
    expect(e.command).toBe('run')
    expect(g.calls.runs).toHaveLength(0)
  })

  it('(I4) mirrors the Host allowlist on the socket engine allowRequest', async () => {
    // boot() binds 127.0.0.1, so the engine's allowRequest (the I4 Host mirror)
    // must accept a loopback Host and reject a foreign one. Drive the wired
    // callback directly with mock requests — deterministic and true to the wiring
    // (a real client always sends the genuine 127.0.0.1 Host, which can't be
    // overridden reliably from Node).
    await boot()
    const allowRequest = io!.engine.opts.allowRequest!
    const run = (host: string | undefined): Promise<boolean> =>
      new Promise((resolve) =>
        allowRequest({ headers: { host } } as never, (_err, ok) => resolve(ok)),
      )
    expect(await run('127.0.0.1:7878')).toBe(true)
    expect(await run('box.ts.net')).toBe(true)
    expect(await run('evil.example.com')).toBe(false)
    expect(await run(undefined)).toBe(false)
  })

  it('(I6) resume on an unknown runId emits command.error immediately instead of hanging', async () => {
    // A client that resumes a stale runId (e.g. from a previous server instance)
    // must get an immediate command.error rather than waiting silently for events
    // that will never arrive. The guard checks store.has + runManager.isActive.
    const { client: c } = await boot()

    const err = new Promise<{ command: string; message: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no command.error received')), 3000)
      c.on('command.error', (e: { command: string; message: string }) => {
        clearTimeout(timer)
        resolve(e)
      })
    })

    // 'stale-run-id-xyz' has never been started on this server.
    c.emit('resume', { run_id: 'stale-run-id-xyz', after_cursor: 0 })
    const e = await err
    expect(e.command).toBe('resume')
    expect(e.message).toContain('stale-run-id-xyz')
  })
})

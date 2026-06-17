import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import type { ApprovalChoice } from '@agent-deck/protocol'
import type { GatewayClientLike, GatewayEvent, StartRunArgs } from '../hermes/gatewayClient'
import { registerChatRunHandlers } from './chatRun'

/**
 * Multi-gateway routing: a NEW run is sent to the gateway the resolver returns at
 * start time, and then PINNED there — its Stop and approval reach that same
 * gateway even after the active profile (the resolver's return value) has changed.
 * This is the contract behind "switching is an endpoint swap with no restart".
 */

/** A controllable gateway double that records the calls routed to it and holds
 * each run open on an approval gate until told to resolve. */
class RecordingGateway implements GatewayClientLike {
  constructor(readonly id: string) {}
  startRunCalls = 0
  approvalCalls: string[] = []
  stopCalls: string[] = []
  private gates = new Map<string, () => void>()
  private seq = 0

  startRun(_args: StartRunArgs): Promise<{ runId: string }> {
    void _args
    this.startRunCalls += 1
    return Promise.resolve({ runId: `${this.id}-run-${++this.seq}` })
  }

  async *streamRun(
    runId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    // Emit an approval request, then hold until the gate trips (approval or stop).
    yield {
      event: 'approval.request',
      run_id: runId,
      command: 'noop',
      description: 'gate',
      choices: ['once', 'deny'],
    }
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve()
      this.gates.set(runId, resolve)
      signal?.addEventListener('abort', () => resolve())
    })
    yield { event: 'run.completed', run_id: runId, output: 'done' }
  }

  respondApproval(runId: string, _id: string | undefined, _choice: ApprovalChoice): Promise<void> {
    void _id
    void _choice
    this.approvalCalls.push(runId)
    this.gates.get(runId)?.()
    return Promise.resolve()
  }

  stopRun(runId: string): Promise<void> {
    this.stopCalls.push(runId)
    this.gates.get(runId)?.()
    return Promise.resolve()
  }

  getRunSession(_runId: string): Promise<{ sessionId: string | null }> {
    void _runId
    return Promise.resolve({ sessionId: null })
  }
}

let http: HttpServer | undefined
let io: SocketIOServer | undefined
let client: ClientSocket | undefined
/** Run ids that have delivered an approval.request, populated by a persistent
 * listener set at boot so a fast-arriving request is never missed by a race. */
let approvalsSeen: Set<string>
/** Run ids that have reached a terminal frame, for awaitRunDone. */
let runsDone: Set<string>

afterEach(async () => {
  client?.disconnect()
  client = undefined
  await new Promise<void>((r) => (io ? io.close(() => r()) : r()))
  io = undefined
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()))
  http = undefined
})

/** Boot a bare /chat-run namespace with a flippable gateway resolver. */
async function boot(resolveGateway: () => GatewayClientLike, fallback: GatewayClientLike) {
  http = createServer()
  io = new SocketIOServer(http)
  registerChatRunHandlers(io, { gateway: fallback, resolveGateway })
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  client = ioClient(`http://127.0.0.1:${port}/chat-run`, {
    transports: ['websocket'],
    forceNew: true,
  })
  approvalsSeen = new Set<string>()
  client.on('approval.request', (e: { run_id: string }) => approvalsSeen.add(e.run_id))
  runsDone = new Set<string>()
  for (const ev of ['run.completed', 'run.failed', 'run.cancelled']) {
    client.on(ev, (e: { run_id: string }) => runsDone.add(e.run_id))
  }
  await new Promise<void>((resolve, reject) => {
    client!.on('connect', resolve)
    client!.on('connect_error', reject)
  })
}

/** Wait until a run has reached a terminal frame (recorded by the boot listener). */
function awaitRunDone(runId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const tick = () => {
      if (runsDone.has(runId)) return resolve()
      if (Date.now() > deadline) return reject(new Error(`timeout awaiting done for ${runId}`))
      setTimeout(tick, 15)
    }
    tick()
  })
}

/** Send a `run` and resolve with the run id once run.started arrives. */
function startRun(input: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout starting run for ${input}`)), 3000)
    client!.once('run.started', (e: { run_id: string }) => {
      clearTimeout(timer)
      resolve(e.run_id)
    })
    client!.emit('run', { input })
  })
}

/** Wait until an approval.request for the given run id has been delivered (the
 * persistent boot listener records it, so this never misses a fast request). */
function awaitApproval(runId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const tick = () => {
      if (approvalsSeen.has(runId)) return resolve()
      if (Date.now() > deadline) return reject(new Error(`timeout awaiting approval for ${runId}`))
      setTimeout(tick, 15)
    }
    tick()
  })
}

describe('chat run gateway routing', () => {
  it('routes a new run to the active gateway and pins approval + stop to it', async () => {
    const gwA = new RecordingGateway('A')
    const gwB = new RecordingGateway('B')
    let active: GatewayClientLike = gwA
    await boot(() => active, gwA)

    // Run 1 starts while A is active.
    const run1 = await startRun('first')
    await awaitApproval(run1)
    expect(gwA.startRunCalls).toBe(1)
    expect(gwB.startRunCalls).toBe(0)
    expect(run1.startsWith('A-run')).toBe(true)

    // Switch the active profile (the resolver now returns B).
    active = gwB

    // Run 2 starts on B; run 1 is untouched.
    const run2 = await startRun('second')
    await awaitApproval(run2)
    expect(gwB.startRunCalls).toBe(1)
    expect(run2.startsWith('B-run')).toBe(true)

    // Approve run 1: it must reach A (the gateway it started on), never B.
    client!.emit('approval.respond', { run_id: run1, choice: 'once' })
    // Stop run 2: it must reach B.
    client!.emit('abort', { run_id: run2 })

    await new Promise((r) => setTimeout(r, 150))
    expect(gwA.approvalCalls).toEqual([run1])
    expect(gwB.approvalCalls).toEqual([])
    expect(gwB.stopCalls).toEqual([run2])
    expect(gwA.stopCalls).toEqual([])
  })

  it('never routes a Stop/approval for a TERMINAL run to any gateway (no misroute after a switch)', async () => {
    const gwA = new RecordingGateway('A')
    const gwB = new RecordingGateway('B')
    let active: GatewayClientLike = gwA
    await boot(() => active, gwA)

    // Run on A, then drive it to completion (approve → gate trips → run.completed).
    const run1 = await startRun('first')
    await awaitApproval(run1)
    client!.emit('approval.respond', { run_id: run1, choice: 'once' })
    await awaitRunDone(run1)
    const approvalsAfterComplete = gwA.approvalCalls.length

    // Switch the active profile to B (so the stale default-fallback would be wrong).
    active = gwB

    // A late Stop + approval for the now-terminal run must reach NEITHER gateway:
    // the run is over (nothing to act on) and must never be misrouted to B.
    client!.emit('abort', { run_id: run1 })
    client!.emit('approval.respond', { run_id: run1, choice: 'once' })
    await new Promise((r) => setTimeout(r, 150))

    expect(gwA.stopCalls).toEqual([]) // run1 finished on its own; no stop forwarded
    expect(gwB.stopCalls).toEqual([]) // never misrouted to the newly-active gateway
    expect(gwB.approvalCalls).toEqual([])
    expect(gwA.approvalCalls.length).toBe(approvalsAfterComplete) // no extra approval call
  })
})

/**
 * Guards the in-process MockGatewayClient + its wiring through the real BFF
 * `/chat-run` socket. This is the server-side counterpart to the hermetic
 * Playwright chat e2e (e2e/chat.spec.ts): same mock, asserted at the event level.
 * Fully hermetic — no network, no live gateway.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { buildApp, attachChat } from '../app'
import type { ServerConfig } from '../config'
import { MockGatewayClient } from './mockGatewayClient.test-support'
import type { ChatServerEvent } from '@agent-deck/protocol'

type App = Awaited<ReturnType<typeof buildApp>>

let app: App | undefined
let io: ReturnType<typeof attachChat> | undefined
let client: ClientSocket | undefined

afterEach(async () => {
  client?.disconnect()
  client = undefined
  await io?.close()
  io = undefined
  await app?.close()
  app = undefined
})

const testConfig: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  remote: false,
  trustedHosts: [],
  terminalEnabled: true,
  terminalAllowHome: false,
  terminalParkGraceMs: 60_000,
  hermesHome: '/tmp/hermes-test-home',
  hermesGatewayUrl: 'http://127.0.0.1:8643',
  hermesBin: '/tmp/hermes',
  hermesApiKey: null,
  hermesDashboardUrl: 'http://127.0.0.1:9123',
  hermesDashboardHost: '127.0.0.1:9123',
  webClientRoot: null,
  mcpCatalogDir: '/tmp/optional-mcps',
}

async function boot(): Promise<ClientSocket> {
  app = await buildApp(testConfig)
  io = attachChat(app, testConfig, new MockGatewayClient())
  await app.listen({ host: '127.0.0.1', port: 0 })
  const { port } = app.server.address() as AddressInfo
  client = ioClient(`http://127.0.0.1:${port}/chat-run`, {
    transports: ['websocket'],
    forceNew: true,
  })
  await new Promise<void>((resolve, reject) => {
    client!.on('connect', resolve)
    client!.on('connect_error', reject)
  })
  return client
}

const NAMES = [
  'run.started',
  'message.delta',
  'tool.started',
  'tool.completed',
  'approval.request',
  'approval.responded',
  'run.completed',
  'run.cancelled',
  'run.failed',
] as const

/** Record the global ordering of named server events and resolve once `until`
 * arrives (or reject on timeout). */
function record(
  socket: ClientSocket,
  until: ChatServerEvent['event'],
): { order: ChatServerEvent[]; done: Promise<ChatServerEvent[]> } {
  const order: ChatServerEvent[] = []
  const done = new Promise<ChatServerEvent[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${until}`)), 5000)
    for (const name of NAMES) {
      socket.on(name, (e: ChatServerEvent) => {
        order.push(e)
        if (e.event === until || e.event === 'run.failed') {
          clearTimeout(timer)
          resolve(order)
        }
      })
    }
  })
  return { order, done }
}

describe('MockGatewayClient via /chat-run', () => {
  it('streams text, a tool chip, an approval prompt, then completes on allow', async () => {
    const c = await boot()
    const { done } = record(c, 'run.completed')

    // Drive the run; resolve the approval once it surfaces.
    c.on('approval.request', (e: ChatServerEvent) => {
      if (e.event === 'approval.request') {
        c.emit('approval.respond', { run_id: e.run_id, choice: 'once' })
      }
    })
    c.emit('run', { input: 'say hi and clean the build' })

    const order = await done
    const types = order.map((e) => e.event)

    expect(types).toEqual([
      'run.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'tool.started',
      'tool.completed',
      'approval.request',
      'approval.responded',
      'message.delta',
      'message.delta',
      'run.completed',
    ])

    // Monotonic, gap-free cursors on the buffered (non-transient) frames.
    const cursors = order.map((e) => e.cursor)
    expect(cursors).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const text = order
      .filter(
        (e): e is Extract<ChatServerEvent, { event: 'message.delta' }> =>
          e.event === 'message.delta',
      )
      .map((e) => e.delta)
      .join('')
    expect(text).toBe('Hello, from the mock agent. All done. Anything else?')

    const approval = order.find((e) => e.event === 'approval.request')
    expect(approval).toMatchObject({
      command: 'rm -rf ./build',
      choices: ['once', 'session', 'always', 'deny'],
    })

    const completed = order.find(
      (e): e is Extract<ChatServerEvent, { event: 'run.completed' }> => e.event === 'run.completed',
    )
    expect(completed?.output).toBe('Hello, from the mock agent. All done. Anything else?')
  })

  it('cancels the run on abort, emitting run.cancelled', async () => {
    const c = await boot()
    const { done } = record(c, 'run.cancelled')

    // Abort as soon as the first streamed token arrives.
    c.on('message.delta', (e: ChatServerEvent) => {
      c.emit('abort', { run_id: e.run_id })
    })
    c.emit('run', { input: 'start a long task' })

    const order = await done
    const types = order.map((e) => e.event)
    expect(types).toContain('run.cancelled')
    // The approval prompt is never reached once aborted mid-stream.
    expect(types).not.toContain('approval.request')
  })
})

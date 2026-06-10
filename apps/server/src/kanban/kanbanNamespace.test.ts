import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import {
  registerKanbanHandlers,
  KANBAN_NAMESPACE,
  type KanbanNamespaceOptions,
  type KanbanTimer,
} from './kanbanNamespace'
import { KANBAN_COLUMNS, type KanbanBoard, type KanbanBoardResponse } from '@agent-deck/protocol'

let http: HttpServer | undefined
let io: SocketIOServer | undefined
const clients: ClientSocket[] = []

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect()
  await io?.close()
  io = undefined
  if (http) {
    const server = http
    await new Promise<void>((resolve) => server.close(() => resolve()))
    http = undefined
  }
})

function makeBoard(cursor: number): KanbanBoard {
  return {
    board: 'default',
    columns: KANBAN_COLUMNS.map((name) => ({ name, cards: [] })),
    assignees: [],
    cursor,
    now: 1_700_000_000 + cursor,
  }
}

/** A controllable fake timer — a single registered tick we fire by hand. */
function fakeTimer(): { timer: KanbanTimer; tick: () => void; active: () => number } {
  let handler: (() => void) | null = null
  let count = 0
  return {
    timer: {
      setInterval: (h) => {
        handler = h
        count += 1
        return count
      },
      clearInterval: () => {
        handler = null
      },
    },
    tick: () => handler?.(),
    active: () => (handler ? 1 : 0),
  }
}

/** Boot an http+socket.io server with the kanban namespace; return a connected client. */
async function boot(
  opts: Partial<KanbanNamespaceOptions> & {
    board: KanbanNamespaceOptions['kanbanClient']['board']
  },
): Promise<ClientSocket> {
  http = createServer()
  io = new SocketIOServer(http)
  registerKanbanHandlers(io, {
    kanbanClient: { board: opts.board },
    pollIntervalMs: opts.pollIntervalMs ?? 4_000,
    timer: opts.timer,
    auth: opts.auth,
  })
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  const client = ioClient(`http://127.0.0.1:${port}${KANBAN_NAMESPACE}`, {
    transports: ['websocket'],
    forceNew: true,
  })
  clients.push(client)
  await new Promise<void>((resolve, reject) => {
    client.on('connect', resolve)
    client.on('connect_error', reject)
  })
  return client
}

/** Resolve with the next `event` payload (or reject on timeout). */
function next<T = unknown>(socket: ClientSocket, event: string, ms = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms)
    socket.once(event, (payload: T) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
}

describe('/kanban namespace — subscribe + liveness', () => {
  it('emits an immediate snapshot on subscribe', async () => {
    const client = await boot({ board: async () => ({ available: true, data: makeBoard(1) }) })
    const snapPromise = next<KanbanBoardResponse>(client, 'kanban.snapshot')
    client.emit('kanban.subscribe', {})
    const snap = await snapPromise
    expect(snap.available).toBe(true)
    if (!snap.available) throw new Error('unreachable')
    expect(snap.data.cursor).toBe(1)
  })

  it('pushes a new snapshot ONLY when the upstream cursor advances', async () => {
    let cursor = 1
    const ft = fakeTimer()
    const client = await boot({
      board: async () => ({ available: true, data: makeBoard(cursor) }),
      timer: ft.timer,
    })

    // First subscribe → immediate snapshot (cursor 1).
    const first = next<KanbanBoardResponse>(client, 'kanban.snapshot')
    client.emit('kanban.subscribe', {})
    await first

    // A poll tick with the SAME cursor must NOT push.
    let pushed = false
    client.on('kanban.snapshot', () => {
      pushed = true
    })
    ft.tick()
    await new Promise((r) => setTimeout(r, 50))
    expect(pushed).toBe(false)

    // Advance the cursor; the next tick pushes.
    cursor = 2
    const second = next<KanbanBoardResponse>(client, 'kanban.snapshot')
    ft.tick()
    const snap = await second
    if (!snap.available) throw new Error('unreachable')
    expect(snap.data.cursor).toBe(2)
  })

  it('relays the graceful-degrade { available: false } snapshot', async () => {
    const client = await boot({ board: async () => ({ available: false }) })
    const snapPromise = next<KanbanBoardResponse>(client, 'kanban.snapshot')
    client.emit('kanban.subscribe', {})
    expect(await snapPromise).toEqual({ available: false })
  })

  it('emits kanban.error (not a crash) when the upstream board fetch throws', async () => {
    const client = await boot({
      board: async () => {
        throw new Error('upstream boom')
      },
    })
    const errPromise = next<{ message: string }>(client, 'kanban.error')
    client.emit('kanban.subscribe', {})
    expect((await errPromise).message).toMatch(/failed/i)
  })

  it('tears down the poll timer when the last subscriber disconnects', async () => {
    const ft = fakeTimer()
    const client = await boot({
      board: async () => ({ available: true, data: makeBoard(1) }),
      timer: ft.timer,
    })
    const snap = next<KanbanBoardResponse>(client, 'kanban.snapshot')
    client.emit('kanban.subscribe', {})
    await snap
    expect(ft.active()).toBe(1)
    client.disconnect()
    await new Promise((r) => setTimeout(r, 80))
    expect(ft.active()).toBe(0)
  })
})

describe('/kanban namespace — origin guard', () => {
  it('refuses a non-loopback origin at the handshake', async () => {
    http = createServer()
    io = new SocketIOServer(http)
    registerKanbanHandlers(io, {
      kanbanClient: { board: async () => ({ available: true, data: makeBoard(1) }) },
      isAllowedOrigin: () => false,
    })
    await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
    const { port } = http.address() as AddressInfo
    const client = ioClient(`http://127.0.0.1:${port}${KANBAN_NAMESPACE}`, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { Origin: 'https://evil.example' },
    })
    clients.push(client)
    const err = await new Promise<Error>((resolve) => {
      client.on('connect_error', resolve)
      client.on('connect', () => resolve(new Error('unexpectedly connected')))
    })
    expect(err.message).toMatch(/forbidden origin/)
  })
})

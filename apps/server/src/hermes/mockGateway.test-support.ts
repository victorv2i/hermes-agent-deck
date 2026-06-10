/**
 * Test-only mock of the hermes gateway `:8643`. A tiny local HTTP server that
 * answers POST /v1/runs and streams a canned SSE lifecycle on
 * GET /v1/runs/{id}/events, plus POST .../stop and .../approval. Used to keep
 * the chat-BFF tests HERMETIC — no dependency on the live gateway.
 *
 * NOT shipped: excluded from the build (`*.ts` under src is built, but this is
 * imported only from tests; it carries no secrets and binds to loopback:0).
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockGatewayCalls {
  runs: { body: unknown; auth: string | undefined }[]
  stops: { runId: string; auth: string | undefined }[]
  approvals: { runId: string; body: unknown; auth: string | undefined }[]
}

export interface MockGatewayOptions {
  /** run_id to return from POST /v1/runs. */
  runId?: string
  /** Raw SSE text streamed on GET /v1/runs/{id}/events. Defaults to a canned
   * sequence: message.delta×3 + tool.started/completed + run.completed. */
  sse?: string
  /** Override the HTTP status returned by POST /v1/runs (e.g. 401, 500) to
   * exercise error mapping. The body carries a structured `error`. */
  runStatus?: number
  /** When set, POST /v1/runs accepts the connection but never responds, to
   * exercise the unary-call timeout path. */
  hangStartRun?: boolean
  /** When set, the events SSE streams chunks with a delay between them and is
   * driven explicitly via the returned handle (see `pushSse` / `endSse`), so a
   * test can interleave actions while a run is mid-stream. */
  manualSse?: boolean
  /** `session_id` returned by GET /v1/runs/{id} (the durable hermes session the
   * gateway assigned). When unset, the status omits `session_id` — mimicking a
   * gateway that hasn't surfaced one. */
  sessionId?: string
}

export interface MockGatewayHandle {
  url: string
  calls: MockGatewayCalls
  /** Push a raw SSE chunk to all open manual event streams (manualSse mode). */
  pushSse(chunk: string): void
  /** End all open manual event streams (manualSse mode). */
  endSse(): void
  /** Resolves once at least one manual event stream is open (manualSse mode). */
  streamOpened(): Promise<void>
  close(): Promise<void>
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** A canned, realistic SSE sequence including keepalive comments and a
 * multi-line `data:` frame, to exercise the parser's robustness. */
export function cannedSse(runId: string): string {
  const t = 1_700_000_000
  return (
    ': keepalive\n\n' +
    frame({ event: 'message.delta', run_id: runId, timestamp: t, delta: 'Hel' }) +
    frame({ event: 'message.delta', run_id: runId, timestamp: t + 1, delta: 'lo ' }) +
    frame({ event: 'message.delta', run_id: runId, timestamp: t + 2, delta: 'world' }) +
    frame({ event: 'tool.started', run_id: runId, timestamp: t + 3, tool: 'bash', preview: 'ls' }) +
    // a frame split across two data: lines (joined with \n by the parser)
    `data: {"event":"tool.completed","run_id":"${runId}",\n` +
    `data: "timestamp":${t + 4},"tool":"bash","duration":0.12,"error":false}\n\n` +
    ': keepalive\n\n' +
    frame({
      event: 'run.completed',
      run_id: runId,
      timestamp: t + 5,
      output: 'Hello world',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }) +
    ': stream closed\n\n'
  )
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function startMockGateway(
  options: MockGatewayOptions = {},
): Promise<MockGatewayHandle> {
  const runId = options.runId ?? 'run_test123'
  const calls: MockGatewayCalls = { runs: [], stops: [], approvals: [] }
  // Open SSE responses in manualSse mode, driven by pushSse/endSse.
  const openStreams = new Set<import('node:http').ServerResponse>()
  const streamOpenWaiters: (() => void)[] = []

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const auth = req.headers['authorization']
    const path = url.pathname

    if (req.method === 'POST' && path === '/v1/runs') {
      const raw = await readBody(req)
      let body: unknown = null
      try {
        body = JSON.parse(raw)
      } catch {
        /* ignore */
      }
      calls.runs.push({ body, auth })
      // Accept the connection but never respond → exercises the call timeout.
      if (options.hangStartRun) return
      if (options.runStatus && options.runStatus >= 400) {
        res.writeHead(options.runStatus, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { message: 'mock error', type: 'mock', code: 'mock_error' },
          }),
        )
        return
      }
      res.writeHead(202, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ run_id: runId, status: 'started' }))
      return
    }

    const statusMatch = path.match(/^\/v1\/runs\/([^/]+)$/)
    if (req.method === 'GET' && statusMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'hermes.run',
          run_id: decodeURIComponent(statusMatch[1]!),
          status: 'running',
          ...(options.sessionId !== undefined ? { session_id: options.sessionId } : {}),
        }),
      )
      return
    }

    const eventsMatch = path.match(/^\/v1\/runs\/([^/]+)\/events$/)
    if (req.method === 'GET' && eventsMatch) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      if (options.manualSse) {
        // Leave the stream open; the test drives it via pushSse/endSse.
        openStreams.add(res)
        res.on('close', () => openStreams.delete(res))
        for (const w of streamOpenWaiters.splice(0)) w()
        return
      }
      res.end(options.sse ?? cannedSse(runId))
      return
    }

    const stopMatch = path.match(/^\/v1\/runs\/([^/]+)\/stop$/)
    if (req.method === 'POST' && stopMatch) {
      calls.stops.push({ runId: decodeURIComponent(stopMatch[1]!), auth })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ run_id: runId, status: 'stopping' }))
      return
    }

    const approvalMatch = path.match(/^\/v1\/runs\/([^/]+)\/approval$/)
    if (req.method === 'POST' && approvalMatch) {
      const raw = await readBody(req)
      let body: unknown = null
      try {
        body = JSON.parse(raw)
      } catch {
        /* ignore */
      }
      calls.approvals.push({ runId: decodeURIComponent(approvalMatch[1]!), body, auth })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'hermes.run.approval_response',
          run_id: runId,
          choice: (body as { choice?: string })?.choice ?? 'once',
          resolved: 1,
        }),
      )
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found', code: 'not_found' } }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    pushSse: (chunk: string) => {
      for (const res of openStreams) res.write(chunk)
    },
    endSse: () => {
      for (const res of openStreams) res.end()
      openStreams.clear()
    },
    streamOpened: () =>
      openStreams.size > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => streamOpenWaiters.push(resolve)),
    close: () => {
      for (const res of openStreams) res.destroy()
      openStreams.clear()
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        // Forcibly drop any lingering sockets (aborted SSE fetches, hung
        // requests) so teardown doesn't wait on keep-alive drain.
        server.closeAllConnections?.()
      })
    },
  }
}

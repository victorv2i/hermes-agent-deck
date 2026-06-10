import { describe, it, expect, afterEach } from 'vitest'
import { GatewayClient, GatewayError, parseSse, type GatewayEvent } from './gatewayClient'
import { startMockGateway, type MockGatewayHandle } from './mockGateway.test-support'

let gateway: MockGatewayHandle | undefined
afterEach(async () => {
  await gateway?.close()
  gateway = undefined
})

async function* fromStrings(parts: string[]): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder()
  for (const p of parts) yield enc.encode(p)
}

describe('parseSse', () => {
  it('ignores comments/keepalives and parses data: frames in order', async () => {
    const sse =
      ': keepalive\n\n' +
      'data: {"event":"message.delta","run_id":"r1","delta":"a"}\n\n' +
      ': another keepalive\n\n' +
      'data: {"event":"run.completed","run_id":"r1","output":"a"}\n\n' +
      ': stream closed\n\n'
    const events: GatewayEvent[] = []
    for await (const e of parseSse(fromStrings([sse]))) events.push(e)
    expect(events.map((e) => e.event)).toEqual(['message.delta', 'run.completed'])
    expect(events[0]!.delta).toBe('a')
  })

  it('joins multi-line data: frames and tolerates chunk boundaries mid-frame', async () => {
    // The JSON object is split across two data: lines AND across two chunks.
    const parts = [
      'data: {"event":"tool.completed","run_id":"r1",\n',
      'data: "tool":"ba',
      'sh","error":false}\n\n',
    ]
    const events: GatewayEvent[] = []
    for await (const e of parseSse(fromStrings(parts))) events.push(e)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'tool.completed', tool: 'bash', error: false })
  })

  it('skips malformed JSON payloads without throwing', async () => {
    const sse =
      'data: not-json\n\n' + 'data: {"event":"message.delta","run_id":"r1","delta":"ok"}\n\n'
    const events: GatewayEvent[] = []
    for await (const e of parseSse(fromStrings([sse]))) events.push(e)
    expect(events.map((e) => e.event)).toEqual(['message.delta'])
  })

  it('surfaces keepalive comment lines as heartbeats (opt-in) without yielding them as events', async () => {
    const sse =
      ': keepalive\n\n' +
      'data: {"event":"message.delta","run_id":"r1","delta":"a"}\n\n' +
      ': another keepalive\n\n' +
      ': stream closed\n\n'
    const events: GatewayEvent[] = []
    let heartbeats = 0
    for await (const e of parseSse(fromStrings([sse]), { onHeartbeat: () => heartbeats++ })) {
      events.push(e)
    }
    // Comments are STILL never yielded as data events…
    expect(events.map((e) => e.event)).toEqual(['message.delta'])
    // …but each one fired the heartbeat callback, so a reaper can treat a stream
    // that emits only keepalives (a legitimately long-thinking agent) as alive.
    expect(heartbeats).toBe(3)
  })

  it('throws a GatewayError when the buffer grows past the cap without a frame boundary', async () => {
    // A single, never-terminated line larger than the cap → must not grow forever.
    const cap = 1024
    async function* hugeUnterminated(): AsyncGenerator<Uint8Array> {
      const enc = new TextEncoder()
      const chunk = enc.encode('x'.repeat(256)) // no newline ever
      for (let i = 0; i < 10; i++) yield chunk
    }
    const run = async () => {
      for await (const _e of parseSse(hugeUnterminated(), { maxBufferBytes: cap })) {
        void _e
      }
    }
    await expect(run()).rejects.toBeInstanceOf(GatewayError)
  })

  it('parses the canned gateway lifecycle into the right ordered events', async () => {
    gateway = await startMockGateway({ runId: 'run_abc' })
    const client = new GatewayClient({
      hermesGatewayUrl: gateway.url,
      hermesApiKey: 'unit-key',
    })
    const events: GatewayEvent[] = []
    for await (const e of client.streamRun('run_abc')) events.push(e)
    expect(events.map((e) => e.event)).toEqual([
      'message.delta',
      'message.delta',
      'message.delta',
      'tool.started',
      'tool.completed',
      'run.completed',
    ])
    const completed = events.at(-1)!
    expect(completed.output).toBe('Hello world')
    expect(completed.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
  })
})

describe('GatewayClient HTTP methods', () => {
  it('startRun posts input/model/session_id and Bearer auth, returns run_id', async () => {
    gateway = await startMockGateway({ runId: 'run_xyz' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    const { runId } = await client.startRun({
      input: 'hi',
      model: 'm1',
      sessionId: 's1',
    })
    expect(runId).toBe('run_xyz')
    expect(gateway.calls.runs).toHaveLength(1)
    expect(gateway.calls.runs[0]!.body).toEqual({ input: 'hi', model: 'm1', session_id: 's1' })
    expect(gateway.calls.runs[0]!.auth).toBe('Bearer unit-key')
  })

  it('startRun builds a multimodal input array when image attachments are present', async () => {
    gateway = await startMockGateway({ runId: 'run_img' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await client.startRun({
      input: 'what is this?',
      attachments: [
        {
          kind: 'image',
          name: 'shot.png',
          mime: 'image/png',
          data_url: 'data:image/png;base64,AAAA',
        },
      ],
    })
    // The gateway's native multimodal shape: a single user message whose content
    // is a parts array — the text part followed by one image_url part per image.
    expect(gateway.calls.runs[0]!.body).toEqual({
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    })
  })

  it('startRun forwards conversation_history when prior turns are present', async () => {
    gateway = await startMockGateway({ runId: 'run_hist' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    const history = [
      { role: 'user' as const, content: 'Reply with exactly: BLUE.' },
      { role: 'assistant' as const, content: 'BLUE' },
    ]
    await client.startRun({
      input: 'What word did I ask you to reply with?',
      sessionId: 's1',
      conversationHistory: history,
    })
    expect(gateway.calls.runs[0]!.body).toEqual({
      input: 'What word did I ask you to reply with?',
      session_id: 's1',
      conversation_history: history,
    })
  })

  it('startRun omits conversation_history when empty', async () => {
    gateway = await startMockGateway({ runId: 'run_nohist' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await client.startRun({ input: 'hi', conversationHistory: [] })
    expect(gateway.calls.runs[0]!.body).toEqual({ input: 'hi' })
  })

  it('startRun keeps input a plain string when attachments is empty', async () => {
    gateway = await startMockGateway({ runId: 'run_plain' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await client.startRun({ input: 'hi', attachments: [] })
    expect(gateway.calls.runs[0]!.body).toEqual({ input: 'hi' })
  })

  it('respondApproval posts the choice with auth', async () => {
    gateway = await startMockGateway()
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await client.respondApproval('run_test123', 'a1', 'session')
    expect(gateway.calls.approvals).toHaveLength(1)
    expect(gateway.calls.approvals[0]!.runId).toBe('run_test123')
    expect(gateway.calls.approvals[0]!.body).toEqual({ choice: 'session' })
    expect(gateway.calls.approvals[0]!.auth).toBe('Bearer unit-key')
  })

  it('stopRun posts to the stop endpoint with auth', async () => {
    gateway = await startMockGateway()
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await client.stopRun('run_test123')
    expect(gateway.calls.stops).toHaveLength(1)
    expect(gateway.calls.stops[0]!.runId).toBe('run_test123')
    expect(gateway.calls.stops[0]!.auth).toBe('Bearer unit-key')
  })

  it('getRunSession reads the durable session_id from GET /v1/runs/{id}', async () => {
    gateway = await startMockGateway({ runId: 'run_s', sessionId: 'api-abc123' })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    const { sessionId } = await client.getRunSession('run_s')
    expect(sessionId).toBe('api-abc123')
  })

  it('getRunSession returns null when the run status omits session_id', async () => {
    gateway = await startMockGateway({ runId: 'run_s' }) // no sessionId configured
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    const { sessionId } = await client.getRunSession('run_s')
    expect(sessionId).toBeNull()
  })

  it('startRun rejects with a timeout GatewayError when the gateway never responds', async () => {
    gateway = await startMockGateway({ hangStartRun: true })
    const client = new GatewayClient({
      hermesGatewayUrl: gateway.url,
      hermesApiKey: 'unit-key',
      requestTimeoutMs: 100,
    })
    const start = Date.now()
    await expect(client.startRun({ input: 'hi' })).rejects.toMatchObject({
      name: 'GatewayError',
    })
    // The reject must arrive on the timeout, not hang indefinitely. The message
    // must not leak the key.
    expect(Date.now() - start).toBeLessThan(3000)
    try {
      await client.startRun({ input: 'hi' })
    } catch (err) {
      expect((err as Error).message).toMatch(/timed out/i)
      expect((err as Error).message).not.toContain('unit-key')
    }
  })

  it('maps a 401 startRun response to a GatewayError carrying the status', async () => {
    gateway = await startMockGateway({ runStatus: 401 })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await expect(client.startRun({ input: 'hi' })).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
    })
  })

  it('maps a 500 startRun response to a GatewayError carrying the status', async () => {
    gateway = await startMockGateway({ runStatus: 500 })
    const client = new GatewayClient({ hermesGatewayUrl: gateway.url, hermesApiKey: 'unit-key' })
    await expect(client.startRun({ input: 'hi' })).rejects.toMatchObject({
      name: 'GatewayError',
      status: 500,
    })
  })
})

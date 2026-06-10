/**
 * SCREENSHOT-ONLY in-process gateway (NOT shipped, NOT in the test gate).
 *
 * Streams a polished, GENERIC, fully-FAKE run for README screenshots:
 *   1. streamed assistant prose (a believable answer)
 *   2. a completed `bash` tool chip (an expandable tool card)
 *   3. an inline approval request — the stream PAUSES here so the still frame
 *      shows a live "Running" cockpit with a tool timeline + a pending approval.
 *
 * No network, no real gateway/dashboard, no real user data. Implements the same
 * structural surface as GatewayClientLike so `attachChat` can inject it.
 */

const STEP_MS = 70

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

// A believable, fully-generic answer streamed token-ish by chunk.
const REPLY_CHUNKS = [
  'Here’s the plan for reconnecting the websocket cleanly.\n\n',
  'The drop happens because the client never tears down the old socket before ',
  'opening a new one, so two sockets race and the server closes the duplicate. ',
  'I’ll add an exponential-backoff reconnect with a 30s cap and a single ',
  'in-flight connection guard.\n\n',
  '**Steps**\n',
  '1. Track the live socket in a ref and close it before reconnecting.\n',
  '2. Back off `1s → 2s → 4s …` capped at `30s`, with jitter.\n',
  '3. Re-subscribe to the run channel on `open`, then flush the outbox.\n\n',
  'Let me check the current handler first.',
]

export class DemoGatewayClient {
  constructor() {
    this.seq = 0
    this.runs = new Map()
  }

  startRun() {
    const runId = `run_demo${(++this.seq).toString().padStart(4, '0')}`
    this.runs.set(runId, { approval: deferred(), stopped: false, stopGate: deferred() })
    return Promise.resolve({ runId })
  }

  async *streamRun(runId, signal) {
    const state = this.runs.get(runId)
    if (!state) return
    const t = 1_700_000_000
    const aborted = () => Boolean(signal?.aborted) || state.stopped
    const cancelled = () => ({ event: 'run.cancelled', run_id: runId, timestamp: t + 99 })

    // 1. streamed prose
    for (let i = 0; i < REPLY_CHUNKS.length; i++) {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield { event: 'message.delta', run_id: runId, timestamp: t + i, delta: REPLY_CHUNKS[i] }
    }

    // 2. an expandable tool chip (completed)
    await sleep(STEP_MS, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'tool.started',
      run_id: runId,
      timestamp: t + 20,
      tool: 'bash',
      preview: 'rg -n "new WebSocket" src/',
    }
    await sleep(STEP_MS * 3, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'tool.completed',
      run_id: runId,
      timestamp: t + 21,
      tool: 'bash',
      duration: 0.42,
      error: false,
    }

    // 3. an inline approval prompt — pause here for the still frame.
    await sleep(STEP_MS, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'approval.request',
      run_id: runId,
      timestamp: t + 30,
      command: 'pnpm test src/socket/reconnect.test.ts',
      description: 'The agent wants to run the reconnect test suite.',
      pattern_key: 'pnpm',
      pattern_keys: ['pnpm', 'pnpm test'],
      choices: ['once', 'session', 'always', 'deny'],
    }

    const choice = await Promise.race([
      state.approval.promise,
      state.stopGate.promise.then(() => null),
    ])
    if (aborted() || choice === null) {
      yield cancelled()
      return
    }

    yield { event: 'approval.responded', run_id: runId, timestamp: t + 40, choice, resolved: 1 }
    const closing = [' Running the suite now…', ' All 14 tests pass. The reconnect is stable.']
    for (let i = 0; i < closing.length; i++) {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield { event: 'message.delta', run_id: runId, timestamp: t + 41 + i, delta: closing[i] }
    }
    yield {
      event: 'run.completed',
      run_id: runId,
      timestamp: t + 50,
      // The canonical `output` must equal the concatenation of every streamed
      // delta (REPLY_CHUNKS + closing) — matching the real-hermes and mock shapes.
      // The chat store replaces the streamed content with this on completion, so a
      // summary here would collapse the rich plan to one line in README screenshots.
      output: [...REPLY_CHUNKS, ...closing].join(''),
      usage: { input_tokens: 1840, output_tokens: 320, total_tokens: 2160 },
    }
  }

  respondApproval(runId, _approvalId, choice) {
    this.runs.get(runId)?.approval.resolve(choice)
    return Promise.resolve()
  }

  stopRun(runId) {
    const state = this.runs.get(runId)
    if (state) {
      state.stopped = true
      state.stopGate.resolve()
    }
    return Promise.resolve()
  }
}

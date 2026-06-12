/**
 * In-process mock of {@link GatewayClient}, implementing {@link GatewayClientLike}
 * with NO network at all. Injected into the BFF by the hermetic e2e launcher
 * (scripts/serve-mock-gateway.mjs) so the Playwright chat e2e drives a real
 * `/chat-run` socket against a scripted, time-delayed agent run — never the live
 * gateway.
 *
 * The scripted run (per the M1b plan / gateway contract vocabulary):
 *   1. message.delta × 3   — streamed text ("Taking a look " / "at the build " / "folder first.")
 *   2. tool.started/completed (bash) — an expandable tool chip
 *   3. approval.request    — then the stream PAUSES until respondApproval()/stopRun()
 *   4. (on allow) approval.responded → tool.started/completed (the approved
 *      command runs) → message.delta × 2 → run.completed
 *      (on deny)  approval.responded → message.delta → run.completed
 *      (on stop)  run.cancelled (faithful: the real gateway sends it after a stop)
 *
 * It is test-support (`*.test-support.ts`): excluded from the production build,
 * loaded only by the e2e launcher script (outside the built `src`), so it never
 * ships.
 */
import type { ApprovalChoice } from '@agent-deck/protocol'
import type { GatewayClientLike, GatewayEvent, StartRunArgs } from './gatewayClient'

/** A small delay so streamed tokens visibly arrive one-by-one in the browser. */
const STEP_MS = 60

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

/** A one-shot resolvable gate the approval/stop commands trip to un-pause the
 * stream that is awaiting an approval decision. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

interface RunState {
  /** Resolves with the user's approval choice once respondApproval is called. */
  approval: ReturnType<typeof deferred<ApprovalChoice>>
  /** Set when stopRun is called for this run. */
  stopped: boolean
  /** Trip to break the approval wait when the run is stopped. */
  stopGate: ReturnType<typeof deferred<void>>
  /** The user's input text for this run, captured at startRun so streamRun can
   * branch on the rich-content trigger phrases (additive — see RICH_CONTENT). */
  input: string
}

/**
 * ADDITIVE rich-content demos for the markdown e2e (e2e/agent-markdown.spec.ts)
 * and the release-journey e2e (e2e/release-journey.spec.ts, the `demo:code`
 * artifact). When the user's input contains one of these trigger phrases the mock
 * streams a single assistant message carrying the rich content (a GFM table, a
 * markdown image, or a named fenced code artifact) and finishes — NO tool chip,
 * NO approval. For ALL OTHER input the
 * scripted default run below is unchanged, so every existing chat spec is
 * unaffected. The 1×1 transparent PNG is inline (data: URL) so the <img> loads
 * with no network.
 */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQA/Tm6BAAAAAElFTkSuQmCC'

const RICH_CONTENT: { trigger: string; markdown: string }[] = [
  {
    trigger: 'demo:table',
    markdown: [
      'Here is the breakdown:',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Bravo | 2 |',
      '| Alpha | 10 |',
      '| Charlie | 1 |',
    ].join('\n'),
  },
  {
    trigger: 'demo:image',
    markdown: `Here is the chart:\n\n![sales chart](${PNG_1x1})`,
  },
  {
    // A NAMED fenced code artifact (filename in the info string → a CodeBlock with
    // the "Open in panel" affordance that opens the Work panel). Kept SHORT
    // (< AUTO_OPEN_LINES) so the CodeBlock's auto-open heuristic does NOT fire —
    // the release-journey e2e opens the Work panel explicitly via the button, so
    // the assertion stays deterministic. Used by e2e/release-journey.spec.ts.
    trigger: 'demo:code',
    markdown: [
      'Here is the helper:',
      '',
      '```typescript greet.ts',
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`',
      '}',
      '```',
    ].join('\n'),
  },
]

/** Match the first rich-content demo whose trigger the input contains. */
function matchRichContent(input: string): { markdown: string } | undefined {
  return RICH_CONTENT.find((d) => input.includes(d.trigger))
}

export class MockGatewayClient implements GatewayClientLike {
  private seq = 0
  private readonly runs = new Map<string, RunState>()

  startRun(args: StartRunArgs): Promise<{ runId: string }> {
    const runId = `run_mock${(++this.seq).toString().padStart(4, '0')}`
    this.runs.set(runId, {
      approval: deferred<ApprovalChoice>(),
      stopped: false,
      stopGate: deferred<void>(),
      input: args.input ?? '',
    })
    return Promise.resolve({ runId })
  }

  async *streamRun(
    runId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    const state = this.runs.get(runId)
    if (!state) return
    const t = Math.floor(Date.now() / 1000)

    const aborted = () => Boolean(signal?.aborted) || state.stopped
    /** On stop/abort, emit a faithful terminal frame (the real gateway sends
     * run.cancelled after a stop) so the UI leaves the running state. */
    const cancelled = (): GatewayEvent => ({
      event: 'run.cancelled',
      run_id: runId,
      timestamp: t + 99,
    })

    // 0. ADDITIVE rich-content demo path — when the user's input carries a
    //    trigger phrase ("demo:table" / "demo:image" / "demo:code") the agent
    //    streams the rich markdown and finishes. The DEFAULT path below (every
    //    other input) is untouched, so the existing chat specs are unaffected.
    const rich = matchRichContent(state.input)
    if (rich) {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield { event: 'message.delta', run_id: runId, timestamp: t, delta: rich.markdown }
      yield {
        event: 'run.completed',
        run_id: runId,
        timestamp: t + 40,
        output: rich.markdown,
        usage: { input_tokens: 8, output_tokens: 16, total_tokens: 24 },
      }
      return
    }

    // 1. streamed assistant text
    const opening = ['Taking a look ', 'at the build ', 'folder first.']
    for (let i = 0; i < opening.length; i++) {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield { event: 'message.delta', run_id: runId, timestamp: t + i, delta: opening[i] }
    }

    // 2. an expandable tool chip
    await sleep(STEP_MS, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'tool.started',
      run_id: runId,
      timestamp: t + 10,
      tool: 'bash',
      preview: 'ls -la',
    }
    await sleep(STEP_MS, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'tool.completed',
      run_id: runId,
      timestamp: t + 11,
      tool: 'bash',
      duration: 0.12,
      error: false,
    }

    // 3. an inline approval prompt — pause the stream until the user resolves it
    //    (or the run is stopped).
    await sleep(STEP_MS, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'approval.request',
      run_id: runId,
      timestamp: t + 20,
      command: 'rm -rf ./build',
      description: 'The agent wants to delete the build directory.',
      pattern_key: 'rm',
      pattern_keys: ['rm', 'rm -rf'],
      choices: ['once', 'session', 'always', 'deny'],
    }

    const choice = await Promise.race([
      state.approval.promise,
      state.stopGate.promise.then(() => null as ApprovalChoice | null),
    ])
    if (aborted() || choice === null) {
      // Stopped while awaiting approval → cancelled.
      yield cancelled()
      return
    }

    // 4. surface the resolution, then finish.
    yield {
      event: 'approval.responded',
      run_id: runId,
      timestamp: t + 31,
      choice,
      resolved: 1,
    }

    if (choice === 'deny') {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield {
        event: 'message.delta',
        run_id: runId,
        timestamp: t + 32,
        delta: ' Understood, I will not run that.',
      }
      yield {
        event: 'run.completed',
        run_id: runId,
        timestamp: t + 40,
        output: 'Taking a look at the build folder first. Understood, I will not run that.',
        usage: { input_tokens: 12, output_tokens: 9, total_tokens: 21 },
      }
      return
    }

    yield {
      event: 'tool.started',
      run_id: runId,
      timestamp: t + 31.5,
      tool: 'bash',
      preview: 'rm -rf ./build',
    }
    await sleep(STEP_MS * 16, signal)
    if (aborted()) {
      yield cancelled()
      return
    }
    yield {
      event: 'tool.completed',
      run_id: runId,
      timestamp: t + 31.8,
      tool: 'bash',
      duration: 0.46,
      error: false,
    }

    const closing = [' Build folder cleared.', ' The repo is tidy and ready to ship.']
    for (let i = 0; i < closing.length; i++) {
      await sleep(STEP_MS, signal)
      if (aborted()) {
        yield cancelled()
        return
      }
      yield { event: 'message.delta', run_id: runId, timestamp: t + 32 + i, delta: closing[i] }
    }
    yield {
      event: 'run.completed',
      run_id: runId,
      timestamp: t + 40,
      output:
        'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      usage: { input_tokens: 12, output_tokens: 11, total_tokens: 23 },
    }
  }

  respondApproval(
    runId: string,
    _approvalId: string | undefined,
    choice: ApprovalChoice,
  ): Promise<void> {
    void _approvalId
    this.runs.get(runId)?.approval.resolve(choice)
    return Promise.resolve()
  }

  stopRun(runId: string): Promise<void> {
    const state = this.runs.get(runId)
    if (state) {
      state.stopped = true
      state.stopGate.resolve()
    }
    return Promise.resolve()
  }

  getRunSession(_runId: string): Promise<{ sessionId: string | null }> {
    void _runId
    // Mirror stock hermes deriving a durable session id for a session-less run, so
    // the e2e exercises the production path: a fresh chat learns its id, the URL
    // becomes /chat/:id, and a reload mid-stream resumes the run (not a racing
    // history rehydration). Stable id keeps multi-turn continuity within a run.
    return Promise.resolve({ sessionId: 'sess-live' })
  }
}

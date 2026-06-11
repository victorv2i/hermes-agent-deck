import { describe, it, expect } from 'vitest'
import {
  ChatServerEvent,
  CONVERSATION_HISTORY_MAX_MESSAGES,
  CONVERSATION_HISTORY_MAX_CHARS,
} from '@agent-deck/protocol'
import {
  applyEvent,
  applyEvents,
  appendUserTurn,
  beginAssistantTurn,
  prepareRetry,
  prepareEdit,
  conversationHistoryForRun,
  historyTruncationStartIndex,
  initialChatState,
  type AssistantTurn,
  type ChatState,
  type Turn,
} from './chatStore'

const RUN = 'run_abc'

/** Every canned event is parsed through the protocol schema first, so the
 * fixtures double as a contract check: if the wire shape drifts, these fail. */
function ev(e: unknown): ChatServerEvent {
  return ChatServerEvent.parse(e)
}

function lastAssistant(state: ChatState): AssistantTurn {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i]
    if (t && t.role === 'assistant') return t
  }
  throw new Error('no assistant turn')
}

describe('chatStore reducer', () => {
  it('starts idle and empty', () => {
    expect(initialChatState.runStatus).toBe('idle')
    expect(initialChatState.turns).toEqual([])
    expect(initialChatState.lastCursor).toBe(0)
  })

  it('appends an optimistic user turn', () => {
    const s = appendUserTurn(initialChatState, 'hello there')
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0]).toMatchObject({ role: 'user', content: 'hello there' })
    // No attachments → the field is omitted (a plain text turn is unchanged).
    expect(s.turns[0]).not.toHaveProperty('attachments')
  })

  it('carries sent image attachments onto the user turn so they render in the transcript', () => {
    const att = {
      kind: 'image' as const,
      name: 'photo.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,AAAA',
    }
    // Prose + image.
    const s = appendUserTurn(initialChatState, 'look at this', [att])
    expect(s.turns[0]).toMatchObject({ content: 'look at this', attachments: [att] })
    // Image-only send: empty prose, the image still rides on the turn.
    const imageOnly = appendUserTurn(initialChatState, '', [att])
    expect(imageOnly.turns[0]).toMatchObject({ content: '', attachments: [att] })
  })

  it('beginAssistantTurn opens an empty streaming assistant turn (the pending caret)', () => {
    const withUser = appendUserTurn(initialChatState, 'do a thing')
    const s = beginAssistantTurn(withUser)
    expect(s.turns).toHaveLength(2)
    const a = lastAssistant(s)
    expect(a.role).toBe('assistant')
    expect(a.content).toBe('')
    expect(a.streaming).toBe(true)
    expect(a.toolCalls).toEqual([])
  })

  it('beginAssistantTurn is reused (not duplicated) by the first real stream frame', () => {
    // The optimistic turn must be the SAME turn the first token lands in — so a
    // pending caret seamlessly becomes the streaming reply, never two turns.
    const pending = beginAssistantTurn(appendUserTurn(initialChatState, 'hi'))
    const pendingId = lastAssistant(pending).id
    const streamed = applyEvents(
      pending,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.started', run_id: RUN, cursor: 2 },
        { event: 'message.delta', run_id: RUN, delta: 'hello', cursor: 3 },
      ].map(ev),
    )
    const assistants = streamed.turns.filter((t) => t.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(lastAssistant(streamed).id).toBe(pendingId)
    expect(lastAssistant(streamed).content).toBe('hello')
    expect(lastAssistant(streamed).streaming).toBe(true)
  })

  it('beginAssistantTurn is a no-op when an active streaming turn already exists', () => {
    const pending = beginAssistantTurn(appendUserTurn(initialChatState, 'hi'))
    const again = beginAssistantTurn(pending)
    expect(again.turns.filter((t) => t.role === 'assistant')).toHaveLength(1)
    expect(again).toBe(pending)
  })

  it('run.completed finalizes a pending (token-less) turn so the caret stops', () => {
    // A run that completes with no streamed text still flips the optimistic turn
    // out of `streaming`, so the caret/dots never persist after the run ends.
    const pending = beginAssistantTurn(appendUserTurn(initialChatState, 'hi'))
    const done = applyEvents(
      pending,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'run.completed', run_id: RUN, output: 'done', cursor: 2 },
      ].map(ev),
    )
    expect(done.runStatus).toBe('idle')
    expect(lastAssistant(done).streaming).toBe(false)
    expect(lastAssistant(done).content).toBe('done')
  })

  it('run.started sets running, clears prior error/approval, records runId', () => {
    const dirty: ChatState = {
      ...initialChatState,
      error: 'old',
      pendingApproval: {
        run_id: 'x',
        command: 'rm',
        description: 'd',
        choices: ['once', 'deny'],
      },
    }
    const s = applyEvent(dirty, ev({ event: 'run.started', run_id: RUN, cursor: 1 }))
    expect(s.runStatus).toBe('running')
    expect(s.runId).toBe(RUN)
    expect(s.error).toBeNull()
    expect(s.pendingApproval).toBeNull()
    expect(s.lastCursor).toBe(1)
  })

  it('a SECOND run in the same conversation streams (its per-run cursors are not dropped)', () => {
    // The BFF numbers cursors PER RUN (each run.started is cursor 1). The store's
    // lastCursor is conversation-global, so without a reset on run.started the
    // second run's low cursors would be <= the first run's watermark and silently
    // dropped — leaving every turn after the first blank. run.started must rebase
    // the watermark to the new run's sequence.
    const first = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: 'run_1', cursor: 1 },
        { event: 'message.delta', run_id: 'run_1', delta: 'first reply', cursor: 2 },
        { event: 'run.completed', run_id: 'run_1', output: 'first reply', cursor: 3 },
      ].map(ev),
    )
    expect(first.lastCursor).toBe(3)

    // A new user turn + a fresh run whose cursors restart at 1.
    const withSecondUser = appendUserTurn(first, 'ask again')
    const second = applyEvents(
      withSecondUser,
      [
        { event: 'run.started', run_id: 'run_2', cursor: 1 },
        { event: 'message.delta', run_id: 'run_2', delta: 'second reply', cursor: 2 },
        { event: 'run.completed', run_id: 'run_2', output: 'second reply', cursor: 3 },
      ].map(ev),
    )

    const assistants = second.turns.filter((t) => t.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect((assistants[1] as AssistantTurn).content).toBe('second reply')
  })

  it('message.delta accumulates into a single streaming assistant turn', () => {
    const seq = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'message.delta', run_id: RUN, delta: 'Hel', cursor: 2 },
      { event: 'message.delta', run_id: RUN, delta: 'lo, ', cursor: 3 },
      { event: 'message.delta', run_id: RUN, delta: 'world', cursor: 4 },
    ].map(ev)
    const s = applyEvents(initialChatState, seq)
    const assistantTurns = s.turns.filter((t) => t.role === 'assistant')
    expect(assistantTurns).toHaveLength(1)
    expect(lastAssistant(s).content).toBe('Hello, world')
    expect(lastAssistant(s).streaming).toBe(true)
    expect(s.lastCursor).toBe(4)
  })

  it('reasoning.available adds reasoning blocks to the assistant turn', () => {
    const seq = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'reasoning.available', run_id: RUN, text: 'thinking A', cursor: 2 },
      { event: 'message.delta', run_id: RUN, delta: 'hi', cursor: 3 },
      { event: 'reasoning.available', run_id: RUN, text: 'thinking B', cursor: 4 },
    ].map(ev)
    const s = applyEvents(initialChatState, seq)
    expect(lastAssistant(s).reasoning).toEqual(['thinking A', 'thinking B'])
  })

  it('run.completed finalizes the assistant turn with the terminal output + usage', () => {
    const seq = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'message.delta', run_id: RUN, delta: 'pon', cursor: 2 },
      {
        event: 'run.completed',
        run_id: RUN,
        output: 'pong',
        usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
        cursor: 3,
      },
    ].map(ev)
    const s = applyEvents(initialChatState, seq)
    expect(s.runStatus).toBe('idle')
    const a = lastAssistant(s)
    expect(a.streaming).toBe(false)
    expect(a.content).toBe('pong')
    expect(a.usage).toEqual({ input_tokens: 10, output_tokens: 1, total_tokens: 11 })
  })

  it('run.completed keeps streamed content when output is absent', () => {
    const seq = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'message.delta', run_id: RUN, delta: 'streamed only', cursor: 2 },
      { event: 'run.completed', run_id: RUN, cursor: 3 },
    ].map(ev)
    const s = applyEvents(initialChatState, seq)
    expect(lastAssistant(s).content).toBe('streamed only')
  })

  // --- tool round-trip ------------------------------------------------------
  it('tool round-trip: started → completed upserts a single card (running → completed)', () => {
    const afterStart = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', preview: 'ls -la', cursor: 2 },
      ].map(ev),
    )
    expect(lastAssistant(afterStart).toolCalls).toHaveLength(1)
    expect(lastAssistant(afterStart).toolCalls[0]).toMatchObject({
      tool: 'shell',
      status: 'running',
      preview: 'ls -la',
    })

    const afterDone = applyEvent(
      afterStart,
      ev({
        event: 'tool.completed',
        run_id: RUN,
        tool: 'shell',
        duration: 1.5,
        error: false,
        cursor: 3,
      }),
    )
    // Still ONE card — upserted in place, not duplicated.
    expect(lastAssistant(afterDone).toolCalls).toHaveLength(1)
    expect(lastAssistant(afterDone).toolCalls[0]).toMatchObject({
      tool: 'shell',
      status: 'completed',
      preview: 'ls -la', // preview preserved from the started frame
      duration: 1.5,
      error: false,
    })
  })

  it('tool.completed lifts the frame timestamp (seconds) into completedAt (ms)', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', cursor: 2 },
        {
          event: 'tool.completed',
          run_id: RUN,
          tool: 'shell',
          timestamp: 1_700_000_000,
          duration: 0.1,
          error: false,
          cursor: 3,
        },
      ].map(ev),
    )
    expect(lastAssistant(s).toolCalls[0]).toMatchObject({
      tool: 'shell',
      status: 'completed',
      completedAt: 1_700_000_000_000,
    })
  })

  it('tool.completed without a timestamp leaves completedAt unset — never fabricated', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', cursor: 2 },
        { event: 'tool.completed', run_id: RUN, tool: 'shell', duration: 0.1, cursor: 3 },
      ].map(ev),
    )
    expect(lastAssistant(s).toolCalls[0]?.completedAt).toBeUndefined()
  })

  it('tool.completed with error marks the card failed', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'tool.started', run_id: RUN, tool: 'web', cursor: 2 },
        {
          event: 'tool.completed',
          run_id: RUN,
          tool: 'web',
          duration: 0.2,
          error: true,
          cursor: 3,
        },
      ].map(ev),
    )
    expect(lastAssistant(s).toolCalls[0]).toMatchObject({
      tool: 'web',
      status: 'failed',
      error: true,
    })
  })

  it('a second call to the same tool after completion is a distinct card', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', cursor: 2 },
        { event: 'tool.completed', run_id: RUN, tool: 'shell', duration: 0.1, cursor: 3 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', cursor: 4 },
      ].map(ev),
    )
    const cards = lastAssistant(s).toolCalls
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ status: 'completed' })
    expect(cards[1]).toMatchObject({ status: 'running' })
  })

  // --- approval -------------------------------------------------------------
  it('approval.request sets pendingApproval; approval.responded clears it', () => {
    const reqd = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        {
          event: 'approval.request',
          run_id: RUN,
          approval_id: 'ap1',
          command: 'rm -rf build',
          description: 'Delete the build dir',
          pattern_key: 'rm:*',
          choices: ['once', 'session', 'always', 'deny'],
          cursor: 2,
        },
      ].map(ev),
    )
    expect(reqd.pendingApproval).toMatchObject({
      run_id: RUN,
      approval_id: 'ap1',
      command: 'rm -rf build',
      description: 'Delete the build dir',
      choices: ['once', 'session', 'always', 'deny'],
    })

    const resolved = applyEvent(
      reqd,
      ev({
        event: 'approval.responded',
        run_id: RUN,
        approval_id: 'ap1',
        choice: 'once',
        resolved: 1,
        cursor: 3,
      }),
    )
    expect(resolved.pendingApproval).toBeNull()
  })

  it('approval.responded for a different approval_id leaves the pending one intact', () => {
    const reqd = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        {
          event: 'approval.request',
          run_id: RUN,
          approval_id: 'ap1',
          command: 'cmd',
          description: 'd',
          choices: ['once', 'deny'],
          cursor: 2,
        },
      ].map(ev),
    )
    const other = applyEvent(
      reqd,
      ev({
        event: 'approval.responded',
        run_id: RUN,
        approval_id: 'ap2',
        choice: 'deny',
        cursor: 3,
      }),
    )
    expect(other.pendingApproval?.approval_id).toBe('ap1')
  })

  // --- run.failed -----------------------------------------------------------
  it('run.failed finalizes streaming, records the error, clears approval, returns to idle', () => {
    const reqd = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'partial', cursor: 2 },
        {
          event: 'approval.request',
          run_id: RUN,
          command: 'cmd',
          description: 'd',
          choices: ['once', 'deny'],
          cursor: 3,
        },
      ].map(ev),
    )
    const failed = applyEvent(
      reqd,
      ev({ event: 'run.failed', run_id: RUN, error: 'boom', cursor: 4 }),
    )
    expect(failed.runStatus).toBe('idle')
    expect(failed.error).toBe('boom')
    expect(failed.pendingApproval).toBeNull()
    const a = lastAssistant(failed)
    expect(a.streaming).toBe(false)
    expect(a.content).toBe('partial') // keep what streamed before the failure
  })

  it('run.cancelled finalizes streaming and returns to idle without an error', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'half', cursor: 2 },
        { event: 'run.cancelled', run_id: RUN, cursor: 3 },
      ].map(ev),
    )
    expect(s.runStatus).toBe('idle')
    expect(s.error).toBeNull()
    expect(lastAssistant(s).streaming).toBe(false)
  })

  // --- run.stopping (transient, no cursor) ----------------------------------
  it('run.stopping flips status to stopping without moving the cursor', () => {
    const running = applyEvent(
      initialChatState,
      ev({ event: 'run.started', run_id: RUN, cursor: 5 }),
    )
    const stopping = applyEvent(running, ev({ event: 'run.stopping', run_id: RUN }))
    expect(stopping.runStatus).toBe('stopping')
    expect(stopping.lastCursor).toBe(5) // unchanged — run.stopping carries no cursor
  })

  it('run.stopping is a no-op when idle', () => {
    const s = applyEvent(initialChatState, ev({ event: 'run.stopping', run_id: RUN }))
    expect(s.runStatus).toBe('idle')
  })

  // --- RESUME: replay tail must NOT duplicate -------------------------------
  it('resume replay of already-seen cursors is idempotent (no duplicated text/tools/reasoning)', () => {
    // Live phase: the client saw cursors 1..4 before the tab reloaded.
    const live = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'Hello ', cursor: 2 },
        { event: 'tool.started', run_id: RUN, tool: 'shell', preview: 'ls', cursor: 3 },
        { event: 'message.delta', run_id: RUN, delta: 'world', cursor: 4 },
      ].map(ev),
    )
    expect(live.lastCursor).toBe(4)
    expect(lastAssistant(live).content).toBe('Hello world')

    // Reconnect: the BFF replays the FULL buffered snapshot (cursors 1..6),
    // overlapping 1..4 the client already applied, then the genuinely-new
    // tail (5, 6). De-dup must drop 1..4 and apply only 5, 6 exactly once.
    const replayThenTail = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'message.delta', run_id: RUN, delta: 'Hello ', cursor: 2 },
      { event: 'tool.started', run_id: RUN, tool: 'shell', preview: 'ls', cursor: 3 },
      { event: 'message.delta', run_id: RUN, delta: 'world', cursor: 4 },
      { event: 'tool.completed', run_id: RUN, tool: 'shell', duration: 0.3, cursor: 5 },
      {
        event: 'run.completed',
        run_id: RUN,
        output: 'Hello world',
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        cursor: 6,
      },
    ].map(ev)
    const resumed = applyEvents(live, replayThenTail)

    // Text not duplicated.
    const a = lastAssistant(resumed)
    expect(a.content).toBe('Hello world')
    expect(resumed.turns.filter((t) => t.role === 'assistant')).toHaveLength(1)
    // Tool card not duplicated, and it transitioned to completed.
    expect(a.toolCalls).toHaveLength(1)
    expect(a.toolCalls[0]).toMatchObject({ tool: 'shell', status: 'completed', duration: 0.3 })
    // Run finalized.
    expect(resumed.runStatus).toBe('idle')
    expect(a.streaming).toBe(false)
    expect(resumed.lastCursor).toBe(6)
  })

  it('out-of-order / stale events below the watermark are ignored', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'A', cursor: 2 },
        { event: 'message.delta', run_id: RUN, delta: 'B', cursor: 3 },
      ].map(ev),
    )
    // A duplicate of cursor 2 arriving late must NOT re-append 'A'.
    const dup = applyEvent(s, ev({ event: 'message.delta', run_id: RUN, delta: 'A', cursor: 2 }))
    expect(lastAssistant(dup).content).toBe('AB')
    expect(dup.lastCursor).toBe(3)
  })

  // --- message actions (retry / edit-and-resend) ---------------------------

  function convo(): ChatState {
    const turns: Turn[] = [
      { id: 'u1', role: 'user', content: 'first question' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'first answer',
        toolCalls: [{ tool: 'read', status: 'completed' }],
        reasoning: ['thought'],
        streaming: false,
      },
      { id: 'u2', role: 'user', content: 'second question' },
      {
        id: 'a2',
        role: 'assistant',
        content: 'second answer',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
    ]
    return { ...initialChatState, turns, runId: 'old', lastCursor: 9 }
  }

  it('prepareRetry drops the assistant turn (and later turns) and re-runs the prompting user turn', () => {
    const plan = prepareRetry(convo(), 'a1')
    expect(plan).not.toBeNull()
    if (!plan) throw new Error('expected a plan')
    expect(plan.input).toBe('first question')
    // Trims back to (and including) the user turn that prompted a1.
    expect(plan.state.turns.map((t) => t.id)).toEqual(['u1'])
    // Run lifecycle is reset so the re-run starts clean.
    expect(plan.state.runId).toBeNull()
    expect(plan.state.lastCursor).toBe(0)
    expect(plan.state.runStatus).toBe('idle')
  })

  it('prepareRetry on the latest assistant turn keeps the whole conversation up to its user turn', () => {
    const plan = prepareRetry(convo(), 'a2')
    expect(plan?.input).toBe('second question')
    expect(plan?.state.turns.map((t) => t.id)).toEqual(['u1', 'a1', 'u2'])
  })

  it('prepareRetry returns null for an unknown turn or one with no preceding user turn', () => {
    expect(prepareRetry(convo(), 'nope')).toBeNull()
    // An assistant turn with no user turn before it (orphan) can't be retried.
    const orphan: ChatState = {
      ...initialChatState,
      turns: [
        {
          id: 'a0',
          role: 'assistant',
          content: 'x',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
    }
    expect(prepareRetry(orphan, 'a0')).toBeNull()
  })

  it('prepareEdit replaces the user turn text and drops everything after it', () => {
    const plan = prepareEdit(convo(), 'u1', '  edited question  ')
    expect(plan).not.toBeNull()
    if (!plan) throw new Error('expected a plan')
    expect(plan.input).toBe('edited question')
    expect(plan.state.turns).toHaveLength(1)
    const only = plan.state.turns[0]
    expect(only).toMatchObject({ id: 'u1', role: 'user', content: 'edited question' })
    expect(plan.state.runId).toBeNull()
  })

  it('prepareEdit returns null for an empty edit or an unknown/non-user turn', () => {
    expect(prepareEdit(convo(), 'u1', '   ')).toBeNull()
    expect(prepareEdit(convo(), 'missing', 'x')).toBeNull()
    // 'a1' is an assistant turn — edit only applies to user turns.
    expect(prepareEdit(convo(), 'a1', 'x')).toBeNull()
  })

  it('prepareRetry/prepareEdit carry the user turn’s image attachments into the plan', () => {
    const att = {
      kind: 'image' as const,
      name: 'shot.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,aGk=',
    }
    const withImage: ChatState = {
      ...initialChatState,
      turns: [
        { id: 'u1', role: 'user', content: 'what is this?', createdAt: 1234, attachments: [att] },
        {
          id: 'a1',
          role: 'assistant',
          content: 'a screenshot',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
    }
    // Retry: the prompting turn's attachments ride the plan for the re-run.
    expect(prepareRetry(withImage, 'a1')?.attachments).toEqual([att])
    // Edit: only the TEXT changes — attachments and createdAt stay on the turn
    // and the attachments ride the plan.
    const editPlan = prepareEdit(withImage, 'u1', 'what is this exactly?')
    expect(editPlan?.attachments).toEqual([att])
    expect(editPlan?.state.turns[0]).toMatchObject({
      id: 'u1',
      content: 'what is this exactly?',
      createdAt: 1234,
      attachments: [att],
    })
    // A text-only turn yields a plan with NO attachments key (byte-identical run).
    expect(prepareRetry(convo(), 'a1')?.attachments).toBeUndefined()
  })

  it('retry/edit preserve the resumed session identity', () => {
    const base = convo()
    const resumed: ChatState = { ...base, sessionTitle: 'My Session', sessionModel: 'hermes-4' }
    expect(prepareRetry(resumed, 'a1')?.state.sessionTitle).toBe('My Session')
    expect(prepareEdit(resumed, 'u1', 'edit')?.state.sessionModel).toBe('hermes-4')
  })

  describe('liveness watermarks (run-state honesty)', () => {
    const T = 1_780_000_000_000

    it('starts with no liveness claims at all', () => {
      expect(initialChatState.lastEventAt).toBeNull()
      expect(initialChatState.lastHeartbeatAt).toBeNull()
    })

    it('stamps lastEventAt on every accepted substantive event', () => {
      let s = applyEvent(initialChatState, ev({ event: 'run.started', run_id: RUN, cursor: 1 }), T)
      expect(s.lastEventAt).toBe(T)
      s = applyEvent(s, ev({ event: 'message.delta', run_id: RUN, delta: 'hi', cursor: 2 }), T + 5)
      expect(s.lastEventAt).toBe(T + 5)
      expect(s.lastHeartbeatAt).toBeNull()
    })

    it('a run.heartbeat stamps ONLY lastHeartbeatAt and changes nothing else', () => {
      const running = applyEvent(
        initialChatState,
        ev({ event: 'run.started', run_id: RUN, cursor: 1 }),
        T,
      )
      const s = applyEvent(running, ev({ event: 'run.heartbeat', run_id: RUN }), T + 30_000)
      expect(s.lastHeartbeatAt).toBe(T + 30_000)
      expect(s.lastEventAt).toBe(T) // untouched — a keepalive is not an event
      expect(s.turns).toEqual(running.turns)
      expect(s.runStatus).toBe('running')
      expect(s.lastCursor).toBe(running.lastCursor)
    })

    it('a heartbeat from a DIFFERENT run is ignored when a run id is known', () => {
      // A still-tailed wedged OLD run's keepalives must not mask the live run
      // as fresh ("Still thinking" on a dead stream would be a lie).
      const running = applyEvent(
        initialChatState,
        ev({ event: 'run.started', run_id: RUN, cursor: 1 }),
        T,
      )
      const s = applyEvent(running, ev({ event: 'run.heartbeat', run_id: 'stale-run' }), T + 30_000)
      expect(s).toBe(running)
      expect(s.lastHeartbeatAt).toBeNull()
    })

    it('a heartbeat still stamps when no run id is known (reload-resume adoption)', () => {
      // A resume with after_cursor>1 never replays run.started, so the store
      // may not know its run id yet. Keepalives must still count as liveness.
      expect(initialChatState.runId).toBeNull()
      const s = applyEvent(initialChatState, ev({ event: 'run.heartbeat', run_id: RUN }), T + 10)
      expect(s.lastHeartbeatAt).toBe(T + 10)
    })

    it('drops stream frames from a DIFFERENT run (no scrambled bubble)', () => {
      // A stray second run that never announced itself via run.started must not
      // merge its deltas/terminal frames into the active turn.
      let s = applyEvent(initialChatState, ev({ event: 'run.started', run_id: RUN, cursor: 1 }), T)
      s = applyEvent(s, ev({ event: 'message.delta', run_id: RUN, delta: 'mine ', cursor: 2 }), T)
      const afterStray = applyEvent(
        s,
        ev({ event: 'message.delta', run_id: 'stray-run', delta: 'INTRUDER', cursor: 3 }),
        T + 1,
      )
      expect(afterStray).toBe(s)
      expect(lastAssistant(afterStray).content).toBe('mine ')
      // A stray terminal frame can't finalize the live turn or flip the status.
      const afterStrayDone = applyEvent(
        s,
        ev({ event: 'run.completed', run_id: 'stray-run', output: 'nope', cursor: 4 }),
        T + 2,
      )
      expect(afterStrayDone).toBe(s)
      expect(afterStrayDone.runStatus).toBe('running')
      expect(lastAssistant(afterStrayDone).streaming).toBe(true)
    })

    it('a NEW run announced via run.started still adopts (the legitimate switch path)', () => {
      let s = applyEvent(initialChatState, ev({ event: 'run.started', run_id: RUN, cursor: 1 }), T)
      s = applyEvent(s, ev({ event: 'run.completed', run_id: RUN, output: 'one', cursor: 2 }), T)
      s = applyEvent(s, ev({ event: 'run.started', run_id: 'run-2', cursor: 1 }), T + 10)
      expect(s.runId).toBe('run-2')
      s = applyEvent(s, ev({ event: 'message.delta', run_id: 'run-2', delta: 'two', cursor: 2 }), T + 11)
      expect(lastAssistant(s).content).toBe('two')
    })

    it('stream frames still apply when no run id is known (reload-resume adoption)', () => {
      // A resume with after_cursor>1 never replays run.started; content frames
      // must still land while the run id is unknown.
      const s = applyEvent(
        initialChatState,
        ev({ event: 'message.delta', run_id: RUN, delta: 'resumed', cursor: 7 }),
        T,
      )
      expect(lastAssistant(s).content).toBe('resumed')
    })

    it('a dropped duplicate (resume replay) does NOT refresh lastEventAt', () => {
      let s = applyEvent(initialChatState, ev({ event: 'run.started', run_id: RUN, cursor: 1 }), T)
      s = applyEvent(s, ev({ event: 'message.delta', run_id: RUN, delta: 'a', cursor: 2 }), T + 1)
      // Replay of cursor 2 much later: already seen, so no fresh-signal claim.
      const replayed = applyEvent(
        s,
        ev({ event: 'message.delta', run_id: RUN, delta: 'a', cursor: 2 }),
        T + 60_000,
      )
      expect(replayed).toBe(s)
      expect(replayed.lastEventAt).toBe(T + 1)
    })
  })

  it('a fresh resume into an empty store replays the whole run faithfully', () => {
    // Simulates: user opens the app on an in-flight run with no local state.
    const snapshot = [
      { event: 'run.started', run_id: RUN, cursor: 1 },
      { event: 'reasoning.available', run_id: RUN, text: 'plan', cursor: 2 },
      { event: 'message.delta', run_id: RUN, delta: 'done', cursor: 3 },
      { event: 'run.completed', run_id: RUN, output: 'done', cursor: 4 },
    ].map(ev)
    const s = applyEvents(initialChatState, snapshot)
    expect(s.runId).toBe(RUN)
    expect(lastAssistant(s).content).toBe('done')
    expect(lastAssistant(s).reasoning).toEqual(['plan'])
    expect(s.runStatus).toBe('idle')
    expect(s.lastCursor).toBe(4)
  })
})

describe('conversationHistoryForRun', () => {
  const user = (id: string, content: string): Turn => ({ id, role: 'user', content })
  const assistant = (id: string, content: string, streaming = false): Turn => ({
    id,
    role: 'assistant',
    content,
    toolCalls: [],
    reasoning: [],
    streaming,
  })

  it('excludes the trailing current-input user turn and maps prior turns to {role, content}', () => {
    const turns: Turn[] = [
      user('u1', 'Reply with exactly: BLUE.'),
      assistant('a1', 'BLUE'),
      user('u2', 'What word did I ask you to reply with?'),
    ]
    expect(conversationHistoryForRun(turns, 'What word did I ask you to reply with?')).toEqual([
      { role: 'user', content: 'Reply with exactly: BLUE.' },
      { role: 'assistant', content: 'BLUE' },
    ])
  })

  it('returns empty for a first send (only the current input in the store)', () => {
    expect(conversationHistoryForRun([user('u1', 'hi')], 'hi')).toEqual([])
  })

  it('skips streaming and empty assistant turns (text-only payload)', () => {
    const turns: Turn[] = [
      user('u1', 'first'),
      assistant('a1', '', true), // optimistic placeholder
      assistant('a2', '   '), // settled but empty
      user('u2', 'second'),
    ]
    expect(conversationHistoryForRun(turns, 'second')).toEqual([{ role: 'user', content: 'first' }])
  })

  it('caps to the most recent CONVERSATION_HISTORY_MAX_MESSAGES messages, oldest dropped first', () => {
    const total = CONVERSATION_HISTORY_MAX_MESSAGES + 20
    const turns: Turn[] = []
    for (let i = 0; i < total; i++) turns.push(user(`u${i}`, `msg-${i}`))
    turns.push(user('cur', 'current'))
    const history = conversationHistoryForRun(turns, 'current')
    expect(history).toHaveLength(CONVERSATION_HISTORY_MAX_MESSAGES)
    expect(history[0]).toEqual({ role: 'user', content: 'msg-20' })
    expect(history.at(-1)).toEqual({ role: 'user', content: `msg-${total - 1}` })
  })

  it('caps by total chars, keeping the newest messages and always at least one', () => {
    const big = 'x'.repeat(CONVERSATION_HISTORY_MAX_CHARS)
    const turns: Turn[] = [user('u1', big), assistant('a1', 'recent answer'), user('u2', 'current')]
    // The giant old turn falls out of the window; the recent one stays.
    expect(conversationHistoryForRun(turns, 'current')).toEqual([
      { role: 'assistant', content: 'recent answer' },
    ])
    // A single oversized prior turn is still sent (never an empty history when
    // prior context exists).
    expect(conversationHistoryForRun([user('u1', big), user('u2', 'current')], 'current')).toEqual([
      { role: 'user', content: big },
    ])
  })
})

describe('historyTruncationStartIndex', () => {
  const user = (id: string, content: string): Turn => ({ id, role: 'user', content })
  const assistant = (id: string, content: string, streaming = false): Turn => ({
    id,
    role: 'assistant',
    content,
    toolCalls: [],
    reasoning: [],
    streaming,
  })

  it('returns null when the whole transcript fits under the caps (the common case)', () => {
    const turns: Turn[] = [user('u1', 'hi'), assistant('a1', 'hello'), user('u2', 'more')]
    expect(historyTruncationStartIndex(turns)).toBeNull()
    expect(historyTruncationStartIndex([])).toBeNull()
  })

  it('returns the index of the OLDEST turn still sent when the message cap bites', () => {
    const total = CONVERSATION_HISTORY_MAX_MESSAGES + 5
    const turns: Turn[] = []
    for (let i = 0; i < total; i++) turns.push(user(`u${i}`, `msg-${i}`))
    // The newest CONVERSATION_HISTORY_MAX_MESSAGES turns ride; the boundary is
    // the first of them (index 5).
    expect(historyTruncationStartIndex(turns)).toBe(5)
  })

  it('returns the boundary when the char cap bites, matching the payload capping', () => {
    const half = 'x'.repeat(Math.ceil(CONVERSATION_HISTORY_MAX_CHARS / 2))
    const turns: Turn[] = [user('u1', half), assistant('a1', half), user('u2', half)]
    // Newest two fit exactly at/under the cap; the oldest falls out.
    expect(historyTruncationStartIndex(turns)).toBe(1)
  })

  it('skips streaming and empty turns exactly like the payload builder', () => {
    const total = CONVERSATION_HISTORY_MAX_MESSAGES + 1
    const turns: Turn[] = [assistant('a0', '', true), assistant('a00', '   ')]
    for (let i = 0; i < total; i++) turns.push(user(`u${i}`, `msg-${i}`))
    // One real turn over the cap: the oldest REAL turn (index 2 + 1) is dropped,
    // so the boundary is the next candidate (index 3).
    expect(historyTruncationStartIndex(turns)).toBe(3)
  })
})

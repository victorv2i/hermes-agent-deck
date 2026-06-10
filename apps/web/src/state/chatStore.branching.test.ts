import { describe, it, expect } from 'vitest'
import { ChatServerEvent } from '@agent-deck/protocol'
import {
  applyEvent,
  applyEvents,
  appendUserTurn,
  prepareRetry,
  prepareEdit,
  forkFromTurn,
  selectBranch,
  activeTurns,
  seedTurns as seedTurnsPure,
  hydrateBranchState,
  initialChatState,
  type ChatState,
  type Turn,
} from './chatStore'

/**
 * Lane D — conversation branching ("Fork from here") graph reducer tests.
 *
 * The graph is an ADDITIVE layer beside the existing `Turn[]` projection:
 * `state.turns` always equals the ACTIVE branch's path, and forking is a
 * non-destructive new branch rooted at a settled message. The original
 * continuation stays reachable on its own branch.
 */

const RUN = 'run_branch'

function ev(e: unknown): ChatServerEvent {
  return ChatServerEvent.parse(e)
}

/** A settled four-turn conversation: u1 → a1 → u2 → a2. */
function convo(): ChatState {
  const turns: Turn[] = [
    { id: 'u1', role: 'user', content: 'first question' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'first answer',
      toolCalls: [],
      reasoning: [],
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
  return { ...initialChatState, turns }
}

describe('chatStore — conversation branching graph', () => {
  // 1.
  it('forkFromTurn from an assistant message creates a second branch and keeps the original descendants reachable', () => {
    const base = convo()
    const fork = forkFromTurn(base, 'a1')
    expect(fork).not.toBeNull()
    if (!fork) throw new Error('expected a fork plan')

    // The active branch changed to a NEW branch id (not the original).
    expect(fork.state.activeBranchId).toBeTruthy()
    expect(fork.state.activeBranchId).not.toBe(base.activeBranchId ?? null)

    // The forked branch's path is the ancestor chain up to (and including) a1.
    expect(activeTurns(fork.state).map((t) => t.id)).toEqual(['u1', 'a1'])

    // The ORIGINAL continuation (u2, a2) is still reachable by selecting its branch.
    const branches = fork.state.branches ?? {}
    const originalId = Object.keys(branches).find((id) => id !== fork.state.activeBranchId)
    expect(originalId).toBeTruthy()
    const restored = selectBranch(fork.state, originalId!)
    expect(activeTurns(restored).map((t) => t.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  // 2.
  it('activeTurns projects only the selected branch path', () => {
    const fork = forkFromTurn(convo(), 'a1')!
    // The store's `turns` mirror the active branch projection.
    expect(fork.state.turns.map((t) => t.id)).toEqual(['u1', 'a1'])
    expect(activeTurns(fork.state).map((t) => t.id)).toEqual(['u1', 'a1'])
  })

  // 3.
  it('sending after a fork appends the optimistic user turn + assistant head to the fork branch, not the original', () => {
    const fork = forkFromTurn(convo(), 'a1')!
    const sent = appendUserTurn(fork.state, 'a divergent follow-up')
    // The new user turn lands on the fork path.
    expect(sent.turns.map((t) => t.content)).toEqual([
      'first question',
      'first answer',
      'a divergent follow-up',
    ])
    // The original branch is untouched: its descendants are still the old ones.
    const branches = sent.branches ?? {}
    const originalId = Object.keys(branches).find((id) => id !== sent.activeBranchId)!
    const restored = selectBranch(sent, originalId)
    expect(restored.turns.map((t) => t.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  // 4.
  it('incoming message.delta / terminal events update the assistant node for the branch that owns the active run', () => {
    const fork = forkFromTurn(convo(), 'a1')!
    const sent = appendUserTurn(fork.state, 'diverge')
    const streamed = applyEvents(
      sent,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'forked reply', cursor: 2 },
        { event: 'run.completed', run_id: RUN, output: 'forked reply', cursor: 3 },
      ].map(ev),
    )
    // The fork branch now carries the streamed reply as its head.
    const turns = activeTurns(streamed)
    expect(turns.at(-1)).toMatchObject({ role: 'assistant', content: 'forked reply' })
    expect(streamed.activeBranchId).toBe(fork.state.activeBranchId)
    // Switching back to the original shows the OLD reply, never the forked one.
    const originalId = Object.keys(streamed.branches ?? {}).find(
      (id) => id !== streamed.activeBranchId,
    )!
    expect(activeTurns(selectBranch(streamed, originalId)).map((t) => t.content)).not.toContain(
      'forked reply',
    )
  })

  // 5.
  it('cursor de-dupe remains per active run and does not drop a fork branch first frames', () => {
    // The original branch ran to cursor 9; a fork begins a fresh run whose
    // cursors restart at 1 — those low cursors must NOT be dropped by the stale
    // watermark.
    const base: ChatState = { ...convo(), lastCursor: 9, runId: 'old_run' }
    const fork = forkFromTurn(base, 'a1')!
    const sent = appendUserTurn(fork.state, 'diverge')
    const streamed = applyEvents(
      sent,
      [
        { event: 'run.started', run_id: 'fork_run', cursor: 1 },
        { event: 'message.delta', run_id: 'fork_run', delta: 'fresh', cursor: 2 },
      ].map(ev),
    )
    expect(activeTurns(streamed).at(-1)).toMatchObject({ content: 'fresh' })
    expect(streamed.lastCursor).toBe(2)
  })

  // 6.
  it('forking while a run is not idle returns null and does not move activeBranchId', () => {
    const running: ChatState = { ...convo(), runStatus: 'running' }
    expect(forkFromTurn(running, 'a1')).toBeNull()
    const stopping: ChatState = { ...convo(), runStatus: 'stopping' }
    expect(forkFromTurn(stopping, 'a1')).toBeNull()
    // A streaming assistant head cannot be forked even when status reads idle.
    const streamingHead: ChatState = {
      ...convo(),
      turns: [
        { id: 'u1', role: 'user', content: 'q' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'partial',
          toolCalls: [],
          reasoning: [],
          streaming: true,
        },
      ],
    }
    expect(forkFromTurn(streamingHead, 'a1')).toBeNull()
    // A pending approval owns the branch — fork disabled.
    const pending: ChatState = {
      ...convo(),
      pendingApproval: { run_id: RUN, command: 'rm', description: 'd', choices: ['once', 'deny'] },
    }
    expect(forkFromTurn(pending, 'a1')).toBeNull()
  })

  // 7.
  it('seedTurns creates one clean linear branch, resets run lifecycle, keeps title/model identity', () => {
    const seeded = seedTurnsPure(
      [
        { id: 'h-sess1-1', role: 'user', content: 'where were we?' },
        {
          id: 'h-sess1-2',
          role: 'assistant',
          content: 'here is the plan',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
      { title: 'My Session', model: 'hermes-4' },
    )
    // One branch, projecting the seeded history.
    expect(Object.keys(seeded.branches ?? {})).toHaveLength(1)
    expect(activeTurns(seeded).map((t) => t.id)).toEqual(['h-sess1-1', 'h-sess1-2'])
    // Run lifecycle reset, identity preserved.
    expect(seeded.runStatus).toBe('idle')
    expect(seeded.runId).toBeNull()
    expect(seeded.lastCursor).toBe(0)
    expect(seeded.sessionTitle).toBe('My Session')
    expect(seeded.sessionModel).toBe('hermes-4')
  })

  // 7b.
  it('seedTurns sanitizes a skill/cron preamble title so the chat header reads human', () => {
    const seeded = seedTurnsPure([{ id: 'h-sess2-1', role: 'user', content: 'hi' }], {
      title:
        '[IMPORTANT: The user has invoked the "outlook-email" skill. Follow its instructions.]',
      model: 'hermes-4',
    })
    expect(seeded.sessionTitle).toBe('Ran the outlook-email skill')
  })

  // 8.
  it('retry/edit still trim the ACTIVE branch exactly as before (regression)', () => {
    // On a forked branch, retry trims back to the prompting user turn — only on
    // the active branch, leaving siblings intact.
    const fork = forkFromTurn(convo(), 'a1')!
    const withFollowup = appendUserTurn(fork.state, 'follow-up')
    const followupTurns = activeTurns(withFollowup)
    // Add a settled assistant reply on the fork so there is something to retry.
    const replied: ChatState = {
      ...withFollowup,
      turns: [
        ...followupTurns,
        {
          id: 'fa1',
          role: 'assistant',
          content: 'fork answer',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
    }
    const plan = prepareRetry(replied, 'fa1')
    expect(plan).not.toBeNull()
    expect(plan!.input).toBe('follow-up')
    // Trimmed back to the fork path + the prompting user turn.
    expect(plan!.state.turns.map((t) => t.id)).toEqual(['u1', 'a1', plan!.state.turns.at(-1)!.id])
    expect(plan!.state.turns.at(-1)).toMatchObject({ role: 'user', content: 'follow-up' })

    // Edit on the original linear convo still drops everything after the edited turn.
    const editPlan = prepareEdit(convo(), 'u2', 'reworded')
    expect(editPlan!.state.turns.map((t) => t.id)).toEqual(['u1', 'a1', 'u2'])
    expect(editPlan!.state.turns.at(-1)).toMatchObject({ content: 'reworded' })
  })

  // 9.
  it('hydration rejects malformed local branch metadata and falls back to a safe single empty branch', () => {
    // Garbage in → a clean empty state, never a throw.
    expect(() => hydrateBranchState({ nodes: 'nope', branches: 42 })).not.toThrow()
    const safe = hydrateBranchState({ nodes: 'nope', branches: 42 })
    expect(safe.turns).toEqual([])
    expect(safe.activeBranchId === null || safe.activeBranchId === undefined).toBe(true)
    expect(activeTurns(safe)).toEqual([])
    // A null/undefined blob is also safe.
    expect(hydrateBranchState(null).turns).toEqual([])
    expect(hydrateBranchState(undefined).turns).toEqual([])
  })

  // Disabled-action helper: a fork attempt on a turn that isn't settled, or an
  // unknown id, returns null (never throws).
  it('forkFromTurn returns null for an unknown turn id', () => {
    expect(forkFromTurn(convo(), 'does-not-exist')).toBeNull()
  })

  // Live events still flow when there is NO graph yet (plain linear chat): the
  // graph is lazily created only on the first fork, so the un-forked path is
  // byte-identical to today.
  it('a plain (un-forked) conversation needs no graph and still streams', () => {
    const s = applyEvents(
      initialChatState,
      [
        { event: 'run.started', run_id: RUN, cursor: 1 },
        { event: 'message.delta', run_id: RUN, delta: 'hi', cursor: 2 },
      ].map(ev),
    )
    expect(s.branches).toBeUndefined()
    expect(activeTurns(s).map((t) => t.role)).toEqual(['assistant'])
    expect(
      applyEvent(s, ev({ event: 'message.delta', run_id: RUN, delta: '!', cursor: 3 })).turns.at(
        -1,
      ),
    ).toMatchObject({ content: 'hi!' })
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { ChatServerEvent } from '@agent-deck/protocol'
import { useChatStore } from './useChatStore'
import { initialChatState, type Turn } from './chatStore'

function ev(e: unknown): ChatServerEvent {
  return ChatServerEvent.parse(e)
}

const CONVO: Turn[] = [
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

describe('useChatStore (zustand binding)', () => {
  beforeEach(() => {
    // Reset state fields only (keep the action methods on the store).
    useChatStore.setState({ ...initialChatState })
  })

  it('addUserMessage appends an optimistic user turn', () => {
    useChatStore.getState().addUserMessage('hi')
    const { turns } = useChatStore.getState()
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ role: 'user', content: 'hi' })
  })

  it('beginAssistantTurn opens an optimistic streaming turn for the pending caret', () => {
    const { addUserMessage, beginAssistantTurn } = useChatStore.getState()
    addUserMessage('go')
    beginAssistantTurn()
    const { turns } = useChatStore.getState()
    expect(turns).toHaveLength(2)
    const a = turns[1]
    if (!a || a.role !== 'assistant') throw new Error('expected an assistant turn')
    expect(a.streaming).toBe(true)
    expect(a.content).toBe('')
  })

  it('setError finalizes a stuck streaming turn (a rejected run never leaves "thinking…" forever)', () => {
    const { addUserMessage, beginAssistantTurn, setError } = useChatStore.getState()
    addUserMessage('go')
    beginAssistantTurn() // optimistic streaming caret, as a real send does
    expect(useChatStore.getState().turns[1]).toMatchObject({ role: 'assistant', streaming: true })

    // A command.error (e.g. the gateway rejected the run) surfaces via setError.
    setError('Couldn’t reach the agent.')
    const { turns, runStatus, error } = useChatStore.getState()
    expect(error).toBe('Couldn’t reach the agent.')
    expect(runStatus).toBe('idle')
    // The placeholder is dropped OUT of streaming so the caret/dots don't persist.
    expect(turns[1]).toMatchObject({ role: 'assistant', streaming: false })
  })

  it('ingest threads events through the pure reducer', () => {
    const { ingest } = useChatStore.getState()
    ingest(ev({ event: 'run.started', run_id: 'run_1', cursor: 1 }))
    ingest(ev({ event: 'message.delta', run_id: 'run_1', delta: 'yo', cursor: 2 }))
    const s = useChatStore.getState()
    expect(s.runStatus).toBe('running')
    const assistant = s.turns.find((t) => t.role === 'assistant')
    expect(assistant && assistant.role === 'assistant' ? assistant.content : '').toBe('yo')
    expect(s.lastCursor).toBe(2)
  })

  it('reset returns to the initial state', () => {
    const { addUserMessage, reset } = useChatStore.getState()
    addUserMessage('keep?')
    reset()
    expect(useChatStore.getState().turns).toEqual([])
    expect(useChatStore.getState().runStatus).toBe('idle')
  })

  // --- conversation branching (Lane D) -------------------------------------
  describe('fork-from-here actions', () => {
    it('forkFromTurn swaps the active branch (ancestor path) and returns the honesty copy', () => {
      useChatStore.setState({ turns: CONVO })
      const copy = useChatStore.getState().forkFromTurn('a1')
      // Returns the local-fork honesty copy (never null for a settled mid-message).
      expect(copy).not.toBeNull()
      expect(copy).toMatch(/local until you send it/i)
      // The projection is now the ancestor path only.
      expect(useChatStore.getState().turns.map((t) => t.id)).toEqual(['u1', 'a1'])
      expect(useChatStore.getState().activeBranchId).toBeTruthy()
    })

    it('forkFromTurn returns null and does not move the projection while a run is in flight', () => {
      useChatStore.setState({ turns: CONVO, runStatus: 'running' })
      const copy = useChatStore.getState().forkFromTurn('a1')
      expect(copy).toBeNull()
      // Projection untouched.
      expect(useChatStore.getState().turns.map((t) => t.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    })

    it('selectBranch switches the projection without mutating the graph nodes', () => {
      useChatStore.setState({ turns: CONVO })
      useChatStore.getState().forkFromTurn('a1')
      const afterFork = useChatStore.getState()
      const nodesBefore = afterFork.nodes
      const originalId = Object.keys(afterFork.branches ?? {}).find(
        (id) => id !== afterFork.activeBranchId,
      )!

      useChatStore.getState().selectBranch(originalId)
      const restored = useChatStore.getState()
      // The original full path is projected again …
      expect(restored.turns.map((t) => t.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
      // … and the graph nodes object identity is unchanged (no node mutation).
      expect(restored.nodes).toBe(nodesBefore)
    })

    it('reset clears local branch state and the active Hermes session identity', () => {
      useChatStore.setState({
        turns: CONVO,
        sessionTitle: 'Resumed',
        sessionModel: 'hermes-4',
      })
      useChatStore.getState().forkFromTurn('a1')
      expect(useChatStore.getState().branches).toBeTruthy()

      useChatStore.getState().reset()
      const s = useChatStore.getState()
      expect(s.turns).toEqual([])
      expect(s.branches).toBeUndefined()
      expect(s.nodes).toBeUndefined()
      expect(s.activeBranchId === null || s.activeBranchId === undefined).toBe(true)
      expect(s.sessionTitle).toBeNull()
      expect(s.sessionModel).toBeNull()
    })
  })
})

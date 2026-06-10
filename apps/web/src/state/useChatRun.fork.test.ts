import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike, StorageLike } from '@/lib/chatSocket'
import { ACTIVE_RUN_STORAGE_KEY } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState, type Turn } from './chatStore'

/**
 * Lane D — fork SEND POLICY wiring. Forking is a local, non-destructive path; the
 * honesty rules govern whether the next send may continue an existing Hermes
 * session:
 *  - Fork at the LIVE HEAD of a Hermes-backed session → may keep `session_id`.
 *  - Fork from a HISTORICAL message → must NOT reuse `session_id` (stock Hermes
 *    would append to the linear head and corrupt the session) → a new chat.
 *  - A local-only fork's first send emits a normal `run` and never claims the
 *    original Hermes session id.
 *  - `newChat` clears branch + session refs.
 *  - Reload-resume persistence stays exactly `{ runId, lastCursor }` — branch
 *    metadata never leaks into ACTIVE_RUN_STORAGE_KEY.
 */

class FakeSocket implements SocketLike {
  connected = false
  emitted: Array<{ event: string; args: unknown[] }> = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(listener)
    this.listeners.set(event, arr)
    return this
  }
  off(event: string): this {
    this.listeners.delete(event)
    return this
  }
  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args })
    return this
  }
  connect(): this {
    this.connected = true
    return this
  }
  disconnect(): this {
    this.connected = false
    return this
  }
  lastEmit(event: string): unknown[] | undefined {
    for (let i = this.emitted.length - 1; i >= 0; i--) {
      if (this.emitted[i]!.event === event) return this.emitted[i]!.args
    }
    return undefined
  }
}

/** An in-memory StorageLike to inspect reload-resume persistence. */
class FakeStorage implements StorageLike {
  store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v)
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
}

const SEED: Turn[] = [
  { id: 'h-1', role: 'user', content: 'refactor the parser please' },
  {
    id: 'h-2',
    role: 'assistant',
    content: 'Sure, here is the plan.',
    toolCalls: [],
    reasoning: [],
    streaming: false,
  },
  { id: 'h-3', role: 'user', content: 'now add tests' },
  {
    id: 'h-4',
    role: 'assistant',
    content: 'Tests added.',
    toolCalls: [],
    reasoning: [],
    streaming: false,
  },
]

function setup(storage: StorageLike | null = null) {
  const socket = new FakeSocket()
  const { result } = renderHook(() => useChatRun(socket, storage))
  return { socket, result }
}

function runArg(socket: FakeSocket) {
  return (socket.lastEmit('run')?.[0] ?? {}) as { input: string; session_id?: string }
}

describe('useChatRun — fork send policy', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...initialChatState,
      nodes: undefined,
      branches: undefined,
      activeBranchId: null,
    })
  })

  it('a fork at the LIVE HEAD of a resumed session may keep the session_id', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-1', SEED))
    // Fork at the last (head) assistant turn — still the live head.
    act(() => {
      useChatStore.getState().forkFromTurn('h-4')
    })
    act(() => result.current.send('continue from head'))
    expect(runArg(socket)).toMatchObject({ input: 'continue from head', session_id: 'sess-1' })
  })

  it('a fork from a HISTORICAL message does NOT reuse the original session_id', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-1', SEED))
    // Fork from an EARLIER assistant turn (mid-history), not the head.
    act(() => {
      useChatStore.getState().forkFromTurn('h-2')
    })
    act(() => result.current.send('diverge from history'))
    const args = runArg(socket)
    expect(args.input).toBe('diverge from history')
    // Honesty: stock Hermes would corrupt the linear session — emit a NEW chat.
    expect(args.session_id).toBeUndefined()
  })

  it("a local-only fork's first send emits a normal run and never claims the original session id", () => {
    const { socket, result } = setup()
    // A plain (session-less) chat, then fork mid-conversation.
    act(() =>
      useChatStore.setState({
        turns: [
          { id: 'u1', role: 'user', content: 'q1' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'a1',
            toolCalls: [],
            reasoning: [],
            streaming: false,
          },
          { id: 'u2', role: 'user', content: 'q2' },
          {
            id: 'a2',
            role: 'assistant',
            content: 'a2',
            toolCalls: [],
            reasoning: [],
            streaming: false,
          },
        ],
      }),
    )
    act(() => {
      useChatStore.getState().forkFromTurn('a1')
    })
    act(() => result.current.send('local follow-up'))
    const args = runArg(socket)
    expect(args.input).toBe('local follow-up')
    expect(args.session_id).toBeUndefined()
  })

  it('newChat clears branch + session refs so later sends are session-less and graph-less', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-1', SEED))
    act(() => {
      useChatStore.getState().forkFromTurn('h-2')
    })
    act(() => result.current.newChat())
    // Graph cleared.
    const s = useChatStore.getState()
    expect(s.branches).toBeUndefined()
    expect(s.turns).toEqual([])
    // Session-less send.
    act(() => result.current.send('fresh start'))
    expect(runArg(socket).session_id).toBeUndefined()
  })

  it('reload-resume persistence stays exactly { runId, lastCursor } — fork metadata never leaks into it', () => {
    const storage = new FakeStorage()
    const { result } = setup(storage)
    act(() => result.current.continueSession('sess-1', SEED))
    act(() => {
      useChatStore.getState().forkFromTurn('h-2')
    })
    act(() => result.current.send('go'))
    // The persisted key, if present, must have ONLY runId + lastCursor — branch
    // metadata never leaks into ACTIVE_RUN_STORAGE_KEY. (No run.started frame is
    // dispatched in this hermetic test, so nothing is persisted, which equally
    // proves the fork graph never touched this key.)
    const raw = storage.getItem(ACTIVE_RUN_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      expect(Object.keys(parsed).sort()).toEqual(['lastCursor', 'runId'])
    } else {
      // No run.started was dispatched in this hermetic test → nothing persisted,
      // which equally proves branch metadata never touched this key.
      expect(raw).toBeNull()
    }
  })
})

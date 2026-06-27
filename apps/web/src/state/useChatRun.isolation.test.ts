import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState } from './chatStore'

/**
 * New-chat isolation: the chat socket is a single app-lifetime instance, so
 * starting a New chat (or otherwise abandoning the current conversation) while a
 * run is STILL in flight must stop that run's streamed frames from rendering into
 * the fresh, empty transcript. Regression test for the bug where an agent's
 * tool calls / tokens leaked from the session you left into the new chat you just
 * opened. The 42b32a3 scope-fix only dropped FOREIGN runs (a cron / another
 * device); the run you yourself started is not foreign, so abandoning it needs an
 * explicit detach.
 */

/** A scriptable socket.io stand-in: records outbound emits, no network. */
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

  /** Fire an inbound server frame to the ChatSocket's registered listeners. */
  dispatch(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

function setup() {
  const socket = new FakeSocket()
  // storage: null keeps the socket hermetic (no sessionStorage resume).
  const { result } = renderHook(() => useChatRun(socket, null))
  return { socket, result }
}

describe('useChatRun: new-chat isolation from an in-flight run', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
  })

  it('newChat stops a still-running run from leaking its frames into the fresh chat', () => {
    const { socket, result } = setup()

    // Session A: send a message; the run starts and the agent begins working.
    act(() => result.current.send('refactor the parser'))
    act(() =>
      socket.dispatch('run.started', {
        event: 'run.started',
        run_id: 'run_A',
        session_id: 'sess-A',
        cursor: 1,
      }),
    )
    act(() =>
      socket.dispatch('tool.started', {
        event: 'tool.started',
        run_id: 'run_A',
        tool: 'bash',
        cursor: 2,
      }),
    )
    // Session A genuinely has content streaming in.
    expect(useChatStore.getState().turns.length).toBeGreaterThan(0)

    // The user opens a NEW chat while run_A is STILL working.
    act(() => result.current.newChat())
    expect(useChatStore.getState().turns).toEqual([])

    // run_A keeps streaming (the agent did not stop); none of this may leak in.
    act(() =>
      socket.dispatch('tool.started', {
        event: 'tool.started',
        run_id: 'run_A',
        tool: 'edit_file',
        cursor: 3,
      }),
    )
    act(() =>
      socket.dispatch('message.delta', {
        event: 'message.delta',
        run_id: 'run_A',
        delta: 'this belongs to the old session',
        cursor: 4,
      }),
    )

    expect(useChatStore.getState().turns).toEqual([])
  })

  it('continueSession (switching to a history session) also stops an in-flight run from leaking in', () => {
    const { socket, result } = setup()

    // Session A is mid-run and streaming.
    act(() => result.current.send('keep working on A'))
    act(() => socket.dispatch('run.started', { event: 'run.started', run_id: 'run_A', cursor: 1 }))
    act(() =>
      socket.dispatch('tool.started', {
        event: 'tool.started',
        run_id: 'run_A',
        tool: 'bash',
        cursor: 2,
      }),
    )

    // User jumps to a DIFFERENT history session B (continue this session).
    const priorTurns = [
      { id: 'h-1', role: 'user' as const, content: 'older question' },
      {
        id: 'h-2',
        role: 'assistant' as const,
        content: 'older answer',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
    ]
    act(() => result.current.continueSession('sess-B', priorTurns))
    expect(useChatStore.getState().turns).toEqual(priorTurns)

    // run_A is still working, so its frames must not append to B's transcript.
    act(() =>
      socket.dispatch('message.delta', {
        event: 'message.delta',
        run_id: 'run_A',
        delta: 'leak from A',
        cursor: 3,
      }),
    )
    expect(useChatStore.getState().turns).toEqual(priorTurns)
  })

  it('after newChat, a freshly sent run tails normally (detach does not wedge the socket)', () => {
    const { socket, result } = setup()

    act(() => result.current.send('first'))
    act(() => socket.dispatch('run.started', { event: 'run.started', run_id: 'run_A', cursor: 1 }))
    act(() => result.current.newChat())

    // A brand new send must start and tail its own run cleanly.
    act(() => result.current.send('second'))
    act(() =>
      socket.dispatch('run.started', {
        event: 'run.started',
        run_id: 'run_B',
        session_id: 'sess-B',
        cursor: 1,
      }),
    )
    act(() =>
      socket.dispatch('message.delta', {
        event: 'message.delta',
        run_id: 'run_B',
        delta: 'hello from B',
        cursor: 2,
      }),
    )

    expect(result.current.activeSessionId).toBe('sess-B')
    const turns = useChatStore.getState().turns
    expect(turns.some((t) => t.role === 'assistant' && t.content.includes('hello from B'))).toBe(
      true,
    )
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState, type Turn } from './chatStore'

/**
 * Resume-across-sessions wiring: after `continueSession(id, turns)`, the chat
 * store shows the prior transcript and the next `send` forwards `session_id` on
 * the `run` command — so the new turn lands in the SAME hermes session. A fresh
 * `newChat` clears that, so subsequent runs are session-less again.
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

  lastEmit(event: string): unknown[] | undefined {
    for (let i = this.emitted.length - 1; i >= 0; i--) {
      if (this.emitted[i]!.event === event) return this.emitted[i]!.args
    }
    return undefined
  }
}

const PRIOR_TURNS: Turn[] = [
  { id: 'h-1', role: 'user', content: 'refactor the parser please' },
  {
    id: 'h-2',
    role: 'assistant',
    content: 'Sure, here is the plan.',
    toolCalls: [],
    reasoning: [],
    streaming: false,
  },
]

function setup() {
  const socket = new FakeSocket()
  // storage: null keeps the socket hermetic (no sessionStorage resume).
  const { result } = renderHook(() => useChatRun(socket, null))
  return { socket, result }
}

describe('useChatRun — continue-session resume wiring', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
  })

  it('seeds the prior transcript into the chat store', () => {
    const { result } = setup()
    act(() => result.current.continueSession('sess-1', PRIOR_TURNS))
    expect(useChatStore.getState().turns).toEqual(PRIOR_TURNS)
  })

  it('carries the resumed session identity (title · model) for the live header', () => {
    const { result } = setup()
    act(() =>
      result.current.continueSession('sess-1', PRIOR_TURNS, {
        title: 'Refactor the auth flow',
        model: 'openai/gpt-5.5',
      }),
    )
    const s = useChatStore.getState()
    expect(s.sessionTitle).toBe('Refactor the auth flow')
    expect(s.sessionModel).toBe('openai/gpt-5.5')
  })

  it('forwards session_id on the next run after continueSession', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-1', PRIOR_TURNS))
    act(() => result.current.send('keep going'))

    const args = socket.lastEmit('run')
    expect(args?.[0]).toMatchObject({ input: 'keep going', session_id: 'sess-1' })
    // The optimistic user turn is appended after the seeded history, immediately
    // followed by the optimistic streaming assistant turn (the pending caret).
    const turns = useChatStore.getState().turns
    expect(turns[turns.length - 2]).toMatchObject({ role: 'user', content: 'keep going' })
    expect(turns[turns.length - 1]).toMatchObject({ role: 'assistant', streaming: true })
  })

  it('does NOT forward session_id for an ordinary send (no active session)', () => {
    const { socket, result } = setup()
    act(() => result.current.send('hello'))
    const args = socket.lastEmit('run') as [{ input: string; session_id?: string }]
    expect(args[0].input).toBe('hello')
    expect(args[0].session_id).toBeUndefined()
  })

  it('captures the durable session id from run.started (a fresh chat becomes refresh-restorable)', () => {
    // A new chat starts session-less; the BFF surfaces the gateway-derived id on
    // run.started. Capturing it into activeSessionId is what lets the chat route
    // put it in the URL so a refresh can rehydrate it.
    const { socket, result } = setup()
    expect(result.current.activeSessionId).toBeNull()
    act(() => result.current.send('hi')) // start OUR run so its run.started is tailed
    act(() => {
      socket.dispatch('run.started', {
        event: 'run.started',
        run_id: 'run_1',
        session_id: 'api-xyz',
        cursor: 1,
      })
    })
    expect(result.current.activeSessionId).toBe('api-xyz')

    // …and the NEXT send forwards that captured id, so turn 2 continues the SAME
    // hermes session (new-chat continuity, not a fresh session per turn).
    act(() => result.current.send('and again'))
    expect(socket.lastEmit('run')?.[0]).toMatchObject({ input: 'and again', session_id: 'api-xyz' })
  })

  it('newChat clears the resumed session so later sends are session-less', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-1', PRIOR_TURNS))
    act(() => result.current.newChat())
    expect(useChatStore.getState().turns).toEqual([])

    act(() => result.current.send('fresh start'))
    const args = socket.lastEmit('run') as [{ input: string; session_id?: string }]
    expect(args[0].input).toBe('fresh start')
    expect(args[0].session_id).toBeUndefined()
  })
})

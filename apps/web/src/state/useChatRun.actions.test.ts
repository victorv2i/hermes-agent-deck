import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState, type Turn } from './chatStore'

/**
 * Message-action + per-run-model wiring (T1.2 / T1.4): the composer picker's
 * chosen model rides on the `run` command, and Retry / Edit re-issue a run after
 * trimming the conversation in the store.
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

  lastEmit(event: string): unknown[] | undefined {
    for (let i = this.emitted.length - 1; i >= 0; i--) {
      if (this.emitted[i]!.event === event) return this.emitted[i]!.args
    }
    return undefined
  }
  countEmit(event: string): number {
    return this.emitted.filter((e) => e.event === event).length
  }
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
]

function setup() {
  const socket = new FakeSocket()
  const { result } = renderHook(() => useChatRun(socket, null))
  return { socket, result }
}

function runArg(socket: FakeSocket) {
  return (socket.lastEmit('run')?.[0] ?? {}) as {
    input: string
    model?: string
    session_id?: string
  }
}

describe('useChatRun — per-run model + message actions', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
  })

  it('send forwards the chosen model on the run command', () => {
    const { socket, result } = setup()
    act(() => result.current.send('hello', 'openai/gpt-5.5'))
    expect(runArg(socket)).toMatchObject({ input: 'hello', model: 'openai/gpt-5.5' })
  })

  it('send omits model when none is chosen (gateway uses the active model)', () => {
    const { socket, result } = setup()
    act(() => result.current.send('hello'))
    expect(runArg(socket).model).toBeUndefined()
  })

  it('send threads image attachments onto BOTH the run command and the transcript turn', () => {
    const { socket, result } = setup()
    const att = {
      kind: 'image' as const,
      name: 'shot.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,AAAA',
    }
    act(() => result.current.send('what is this?', undefined, [att]))
    // The gateway run carries the image...
    expect((runArg(socket) as { attachments?: unknown[] }).attachments).toEqual([att])
    // ...AND the optimistic user turn carries it, so it renders in the bubble
    // (the regression: attachments previously reached the run but never the turn).
    const turn = useChatStore.getState().turns[0] as { attachments?: unknown[] }
    expect(turn.attachments).toEqual([att])
  })

  it('send with an image and no prose still rides the image on the turn (empty content)', () => {
    const { result } = setup()
    const att = {
      kind: 'image' as const,
      name: 'only.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,BBBB',
    }
    act(() => result.current.send('', undefined, [att]))
    const turn = useChatStore.getState().turns[0] as { content: string; attachments?: unknown[] }
    expect(turn.content).toBe('')
    expect(turn.attachments).toEqual([att])
  })

  it('retry drops the assistant turn, re-runs the prompting user turn, and carries the model', () => {
    const { socket, result } = setup()
    act(() => useChatStore.setState({ turns: CONVO }))
    act(() => result.current.retry('a1', 'anthropic/claude'))

    // Re-issued the user prompt with the chosen model.
    expect(runArg(socket)).toMatchObject({ input: 'first question', model: 'anthropic/claude' })
    // The conversation was trimmed to the user turn + a fresh optimistic
    // streaming assistant turn (the pending caret).
    const turns = useChatStore.getState().turns
    expect(turns[0]).toMatchObject({ id: 'u1', role: 'user' })
    expect(turns[turns.length - 1]).toMatchObject({ role: 'assistant', streaming: true })
  })

  it('retry is a no-op (no run emitted) when the turn cannot be retried', () => {
    const { socket, result } = setup()
    act(() => useChatStore.setState({ turns: CONVO }))
    act(() => result.current.retry('does-not-exist'))
    expect(socket.countEmit('run')).toBe(0)
  })

  it('editTurn replaces the user text, trims later turns, and re-runs', () => {
    const { socket, result } = setup()
    act(() => useChatStore.setState({ turns: CONVO }))
    act(() => result.current.editTurn('u1', 'edited question'))

    expect(runArg(socket).input).toBe('edited question')
    const turns = useChatStore.getState().turns
    expect(turns[0]).toMatchObject({ id: 'u1', role: 'user', content: 'edited question' })
    expect(turns[turns.length - 1]).toMatchObject({ role: 'assistant', streaming: true })
  })

  it('editTurn is a no-op for an empty edit', () => {
    const { socket, result } = setup()
    act(() => useChatStore.setState({ turns: CONVO }))
    act(() => result.current.editTurn('u1', '   '))
    expect(socket.countEmit('run')).toBe(0)
    // Conversation untouched.
    expect(useChatStore.getState().turns).toEqual(CONVO)
  })

  it('retry RESENDS the prompting user turn’s image attachments (no silent text-only re-ask)', () => {
    const { socket, result } = setup()
    const att = {
      kind: 'image' as const,
      name: 'graph.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,aGk=',
    }
    act(() =>
      useChatStore.setState({
        turns: [
          { id: 'u1', role: 'user', content: 'what is in this image?', attachments: [att] },
          {
            id: 'a1',
            role: 'assistant',
            content: 'a graph',
            toolCalls: [],
            reasoning: [],
            streaming: false,
          },
        ],
      }),
    )
    act(() => result.current.retry('a1'))
    const arg = runArg(socket) as { input: string; attachments?: unknown[] }
    expect(arg.input).toBe('what is in this image?')
    expect(arg.attachments).toEqual([att])
  })

  it('editTurn keeps the turn’s image attachments on the re-run', () => {
    const { socket, result } = setup()
    const att = {
      kind: 'image' as const,
      name: 'graph.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,aGk=',
    }
    act(() =>
      useChatStore.setState({
        turns: [{ id: 'u1', role: 'user', content: 'describe this', attachments: [att] }],
      }),
    )
    act(() => result.current.editTurn('u1', 'describe this in detail'))
    const arg = runArg(socket) as { input: string; attachments?: unknown[] }
    expect(arg.input).toBe('describe this in detail')
    expect(arg.attachments).toEqual([att])
    // The transcript turn keeps its image too.
    expect(useChatStore.getState().turns[0]).toMatchObject({
      content: 'describe this in detail',
      attachments: [att],
    })
  })

  it('retry within a resumed session keeps forwarding session_id', () => {
    const { socket, result } = setup()
    act(() => result.current.continueSession('sess-9', CONVO))
    act(() => result.current.retry('a1'))
    expect(runArg(socket)).toMatchObject({ input: 'first question', session_id: 'sess-9' })
  })
})

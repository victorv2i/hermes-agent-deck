import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState, type PendingApproval } from './chatStore'

/**
 * A4 (approval re-surface): `respondApproval` optimistically clears the pending
 * approval before the fire-and-forget emit. If the gateway then rejects the
 * response (a `command.error { command: 'approval.respond' }` frame), the run is
 * STILL blocked gateway-side but the client has lost its Allow/Deny — a silent
 * dead-end. The hook must restore the just-cleared approval and toast, while a
 * normal `approval.responded` still clears it exactly once.
 */

const toastError = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

/** A scriptable socket.io stand-in that can both record emits and dispatch
 * inbound frames (so a test can fire a `command.error`). */
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
  dispatch(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
  countEmit(event: string): number {
    return this.emitted.filter((e) => e.event === event).length
  }
}

const APPROVAL: PendingApproval = {
  run_id: 'run_1',
  approval_id: 'ap_1',
  command: 'rm -rf /tmp/cache',
  description: 'Delete the build cache',
  choices: ['once', 'session', 'always', 'deny'],
}

function seedRunningApproval() {
  useChatStore.setState({
    ...initialChatState,
    runStatus: 'running',
    runId: 'run_1',
    pendingApproval: APPROVAL,
  })
}

describe('useChatRun — A4 approval re-surface on server failure', () => {
  beforeEach(() => {
    toastError.mockClear()
    useChatStore.setState({ ...initialChatState })
  })

  it('emits approval.respond and optimistically clears the pending approval', () => {
    const socket = new FakeSocket()
    const { result } = renderHook(() => useChatRun(socket, null))
    act(() => seedRunningApproval())

    act(() => result.current.respondApproval('once'))

    expect(socket.countEmit('approval.respond')).toBe(1)
    expect(useChatStore.getState().pendingApproval).toBeNull()
  })

  it('re-surfaces the just-cleared approval and toasts when the gateway rejects it', () => {
    const socket = new FakeSocket()
    const { result } = renderHook(() => useChatRun(socket, null))
    act(() => seedRunningApproval())
    act(() => result.current.respondApproval('once'))
    expect(useChatStore.getState().pendingApproval).toBeNull()

    // The gateway reports the approval.respond failed.
    act(() => {
      socket.dispatch('command.error', {
        command: 'approval.respond',
        message: 'gateway timeout',
      })
    })

    const state = useChatStore.getState()
    // The approval is BACK so the operator can retry the decision.
    expect(state.pendingApproval).toEqual(APPROVAL)
    // The run is still blocked gateway-side — do NOT slam it to idle or raise the
    // generic "couldn't reach the agent" error banner (that path clears the
    // approval again and is for run-level rejections).
    expect(state.runStatus).toBe('running')
    expect(state.error).toBeNull()
    // A targeted toast tells the user it didn't go through.
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('a normal approval.responded clears exactly once (no re-surface)', () => {
    const socket = new FakeSocket()
    const { result } = renderHook(() => useChatRun(socket, null))
    // Tail OUR run (run_1) so its approval.responded frame reaches the store.
    act(() => result.current.send('go'))
    act(() => socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 }))
    act(() => seedRunningApproval())
    act(() => result.current.respondApproval('once'))

    // The gateway acknowledges — the store reducer clears it on the frame.
    act(() => {
      socket.dispatch('approval.responded', {
        event: 'approval.responded',
        run_id: 'run_1',
        approval_id: 'ap_1',
        choice: 'once',
      })
    })
    expect(useChatStore.getState().pendingApproval).toBeNull()

    // A later, unrelated command.error must NOT resurrect a stale approval.
    act(() => {
      socket.dispatch('command.error', { command: 'approval.respond', message: 'late noise' })
    })
    expect(useChatStore.getState().pendingApproval).toBeNull()
  })

  it('a non-approval command.error still uses the generic error path (unchanged)', () => {
    const socket = new FakeSocket()
    renderHook(() => useChatRun(socket, null))
    act(() => useChatStore.setState({ runStatus: 'running' }))

    act(() => {
      socket.dispatch('command.error', { command: 'run', message: 'Gateway unavailable' })
    })

    const state = useChatStore.getState()
    expect(state.error).toContain('Gateway unavailable')
    expect(state.runStatus).toBe('idle')
    // The approval toast is NOT fired for a run-level error.
    expect(toastError).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SocketLike } from '@/lib/chatSocket'
import { useChatRun } from './useChatRun'
import { useChatStore } from './useChatStore'
import { initialChatState } from './chatStore'

/**
 * I2 (chat error surfacing): a `command.error` frame from the BFF (e.g. the
 * gateway is down and rejects the run) must surface a visible store error and
 * reset runStatus to idle, instead of leaving the UI in a silent dead-end where
 * the composer looks "running" forever.
 */

/** A scriptable socket.io stand-in that lets a test fire a `command.error`. */
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
}

describe('useChatRun — I2 command.error surfacing', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState })
  })

  it('surfaces a visible error and resets runStatus to idle on command.error', () => {
    const socket = new FakeSocket()
    renderHook(() => useChatRun(socket, null))

    // Simulate a run that the gateway then rejects.
    act(() => {
      useChatStore.setState({ runStatus: 'running' })
    })

    act(() => {
      socket.dispatch('command.error', { command: 'run', message: 'Gateway unavailable' })
    })

    const state = useChatStore.getState()
    expect(state.error).toContain('Gateway unavailable')
    expect(state.runStatus).toBe('idle')
  })
})

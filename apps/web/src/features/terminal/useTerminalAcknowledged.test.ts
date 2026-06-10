import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useTerminalAcknowledged,
  TERMINAL_ACK_KEY,
  type AckStorage,
} from './useTerminalAcknowledged'

function memStorage(seed?: Record<string, string>): AckStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('useTerminalAcknowledged', () => {
  it('starts un-acknowledged when storage has no record', () => {
    const { result } = renderHook(() => useTerminalAcknowledged(memStorage()))
    expect(result.current[0]).toBe(false)
  })

  it('starts acknowledged when storage records a prior acknowledgement', () => {
    const store = memStorage({ [TERMINAL_ACK_KEY]: '1' })
    const { result } = renderHook(() => useTerminalAcknowledged(store))
    expect(result.current[0]).toBe(true)
  })

  it('acknowledge() flips state and persists to storage', () => {
    const store = memStorage()
    const { result } = renderHook(() => useTerminalAcknowledged(store))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(store.data.get(TERMINAL_ACK_KEY)).toBe('1')
  })

  it('still unblocks in-session when storage is null (no persistence)', () => {
    const { result } = renderHook(() => useTerminalAcknowledged(null))
    expect(result.current[0]).toBe(false)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
  })
})

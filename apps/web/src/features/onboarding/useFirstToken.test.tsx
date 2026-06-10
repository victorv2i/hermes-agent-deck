import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { hasFirstToken } from './useFirstToken'
import type { Turn } from '@/state/chatStore'
import { useFirstToken } from './useFirstToken'
import { useChatStore } from '@/state/useChatStore'

afterEach(() => {
  vi.restoreAllMocks()
  useChatStore.getState().reset()
})

function userTurn(content: string): Turn {
  return { id: 'u1', role: 'user', content }
}
function assistantTurn(content: string, streaming = true): Turn {
  return { id: 'a1', role: 'assistant', content, streaming, toolCalls: [], reasoning: [] }
}

describe('hasFirstToken — a GENUINE streamed token, not the optimistic placeholder', () => {
  it('is false with no turns', () => {
    expect(hasFirstToken([])).toBe(false)
  })

  it('is false for the optimistic empty streaming turn (the caret, pre-token)', () => {
    // beginAssistantTurn opens an empty `streaming:true` turn before any token.
    expect(hasFirstToken([userTurn('hi'), assistantTurn('')])).toBe(false)
  })

  it('is TRUE once the assistant turn has streamed real content', () => {
    expect(hasFirstToken([userTurn('hi'), assistantTurn('H')])).toBe(true)
  })

  it('is true for a finalized assistant turn too (token already landed)', () => {
    expect(hasFirstToken([userTurn('hi'), assistantTurn('Hello there', false)])).toBe(true)
  })
})

describe('useFirstToken — fires the callback exactly once on the first real token', () => {
  it('calls onFirstToken when a delta lands, and not on the empty optimistic turn', () => {
    const onFirstToken = vi.fn()
    renderHook(() => useFirstToken(onFirstToken))

    // Optimistic empty streaming turn → no fire yet.
    act(() => {
      useChatStore.setState({ turns: [userTurn('hi'), assistantTurn('')] })
    })
    expect(onFirstToken).not.toHaveBeenCalled()

    // First real streamed token → fire once.
    act(() => {
      useChatStore.setState({ turns: [userTurn('hi'), assistantTurn('H')] })
    })
    expect(onFirstToken).toHaveBeenCalledTimes(1)

    // Further tokens never re-fire.
    act(() => {
      useChatStore.setState({ turns: [userTurn('hi'), assistantTurn('He')] })
    })
    expect(onFirstToken).toHaveBeenCalledTimes(1)
  })
})

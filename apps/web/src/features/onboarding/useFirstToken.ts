/**
 * `useFirstToken` — fire a callback the instant the agent streams its FIRST real
 * token in the first-chat rung. That is the honest "your agent is alive" moment
 * the wizard waits for: it (and nothing earlier) fires `markOnboarded()`, which
 * closes the wizard for good.
 *
 * It must NOT fire on the optimistic empty streaming turn that
 * `beginAssistantTurn` opens before any token (the pulsing caret) — only on a
 * genuine streamed `message.delta`. So {@link hasFirstToken} checks for an
 * assistant turn with non-empty content.
 */
import { useEffect, useRef } from 'react'
import { useChatStore } from '@/state/useChatStore'
import type { Turn } from '@/state/chatStore'

/** True once any assistant turn carries real streamed content (not the empty placeholder). */
export function hasFirstToken(turns: Turn[]): boolean {
  return turns.some((t) => t.role === 'assistant' && t.content.length > 0)
}

/** Call `onFirstToken` exactly once when the first genuine token streams in. */
export function useFirstToken(onFirstToken: () => void): void {
  const turns = useChatStore((s) => s.turns)
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    if (hasFirstToken(turns)) {
      firedRef.current = true
      onFirstToken()
    }
  }, [turns, onFirstToken])
}

import type { Turn, AssistantTurn } from '@/state/chatStore'
import type { SessionMessage } from './types'

/**
 * Project a persisted session transcript (the BFF's flat SessionMessage list,
 * straight off state.db) into the chat store's `Turn[]` so the History view can
 * render it with the EXACT same components as the live chat (Message → Markdown
 * / ToolCard / ReasoningBlock). This is the bridge that lets M2 reuse M1b's
 * conversation vocabulary verbatim — read-only, no streaming.
 *
 * Rules:
 *  - `user` rows → a UserTurn.
 *  - `assistant` rows → an AssistantTurn (content + reasoning + tool chips).
 *    Tool-call names on the assistant row become completed ToolCards. Empty
 *    assistant rows that only carry tool calls/reasoning still render (so a
 *    tool-only turn is visible).
 *  - `tool` (result) rows are attached to the preceding assistant turn as a
 *    completed ToolCard carrying the result preview — never their own turn.
 *  - `system` rows are dropped (not part of the visible conversation).
 *  - Blank rows with no content, reasoning, or tools are skipped.
 */
export function transcriptToTurns(messages: SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  let lastAssistant: AssistantTurn | null = null

  for (const msg of messages) {
    const role = msg.role
    if (role === 'user') {
      lastAssistant = null
      if (msg.content.trim() === '') continue
      turns.push({ id: `h-${msg.id}`, role: 'user', content: msg.content, ...createdAt(msg) })
      continue
    }

    if (role === 'assistant') {
      const toolCalls = msg.tool_calls.map((tool) => ({
        tool,
        status: 'completed' as const,
      }))
      const reasoning = msg.reasoning ? [msg.reasoning] : []
      // Skip a row that carries nothing visible at all.
      if (msg.content.trim() === '' && toolCalls.length === 0 && reasoning.length === 0) {
        continue
      }
      const turn: AssistantTurn = {
        id: `h-${msg.id}`,
        role: 'assistant',
        content: msg.content,
        toolCalls,
        reasoning,
        streaming: false,
        ...createdAt(msg),
      }
      turns.push(turn)
      lastAssistant = turn
      continue
    }

    if (role === 'tool') {
      // Attach the tool result to the assistant turn that requested it, as a
      // completed card whose preview is the (truncated) result content.
      const name = msg.tool_name ?? 'tool'
      const preview = previewOf(msg.content)
      if (lastAssistant) {
        const existing = lastAssistant.toolCalls.find((c) => c.tool === name && !c.preview)
        if (existing) {
          existing.preview = preview
        } else {
          lastAssistant.toolCalls.push({ tool: name, status: 'completed', preview })
        }
      } else {
        // Orphan tool result (no preceding assistant) — surface it on its own
        // minimal assistant turn so it isn't silently lost.
        const turn: AssistantTurn = {
          id: `h-${msg.id}`,
          role: 'assistant',
          content: '',
          toolCalls: [{ tool: name, status: 'completed', preview }],
          reasoning: [],
          streaming: false,
        }
        turns.push(turn)
        lastAssistant = turn
      }
      continue
    }

    // system / unknown roles are not part of the visible conversation.
  }

  return turns
}

/** Lift a persisted message timestamp (unix seconds, nullable) into the turn's
 * `createdAt` (epoch ms). Returns an empty object when absent so the spread adds
 * nothing — we never fabricate a time (T3.5). */
function createdAt(msg: SessionMessage): { createdAt?: number } {
  return typeof msg.timestamp === 'number' ? { createdAt: msg.timestamp * 1000 } : {}
}

/** Single-line, length-capped preview for a tool result chip. */
function previewOf(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine
}

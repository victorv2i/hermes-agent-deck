/**
 * Trust-layer tests for Message.tsx:
 * - Item 5: streaming dots appear BEFORE tool chips (in-progress reads as in-progress)
 * - Item 3: RefinementRow on the LAST completed assistant message, visible (not hover-only)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { type Turn, FORK_COPY } from '@/state/chatStore'
import { Message } from './Message'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderMessage(turn: Turn, props: Partial<React.ComponentProps<typeof Message>> = {}) {
  return render(
    <ThemeProvider>
      <Message turn={turn} {...props} />
    </ThemeProvider>,
  )
}

const streamingWithTools: Turn = {
  id: 'a1',
  role: 'assistant',
  content: '',
  toolCalls: [{ tool: 'bash', status: 'running' }],
  reasoning: [],
  streaming: true,
}

describe('Message — streaming indicator order (item 5)', () => {
  it('renders the live status indicator BEFORE completed tool chips in the DOM', () => {
    const { container } = renderMessage(streamingWithTools)

    // The live tool-status chip should be present (ToolStatusChip)
    const statusChip = container.querySelector('[data-testid="tool-status-chip"]')
    expect(statusChip).not.toBeNull()

    // The completed/collapsible tool chip trigger should be present
    const toolTrigger = container.querySelector('[data-testid="toolcard-trigger"]')
    expect(toolTrigger).not.toBeNull()

    // The streaming indicator must come BEFORE the tool card in DOM order
    // (DOCUMENT_POSITION_FOLLOWING = 4, means toolTrigger follows statusChip)
    const statusFirst =
      statusChip!.compareDocumentPosition(toolTrigger!) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(statusFirst).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows the tool status chip when a tool is running with no tokens yet', () => {
    renderMessage(streamingWithTools)
    // No tokens: should show live tool status chip
    expect(screen.getByTestId('tool-status-chip')).toBeInTheDocument()
  })

  it('shows pulsing dots when streaming with no tokens and no running tool', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCalls: [],
      reasoning: [],
      streaming: true,
    })
    expect(screen.getByTestId('stream-caret')).toBeInTheDocument()
  })
})

describe('Message — RefinementRow on last completed assistant turn (item 3)', () => {
  it('shows RefinementRow on a completed assistant turn with showRefinement=true', () => {
    renderMessage(
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is the answer.',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
      {
        showRefinement: true,
        onRetry: vi.fn(),
        onSend: vi.fn(),
        actionsDisabled: false,
      },
    )
    // The refinement row is visible (not hover-only)
    expect(screen.getByRole('button', { name: /shorter/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more detail/i })).toBeInTheDocument()
  })

  it('does not show RefinementRow when showRefinement is false', () => {
    renderMessage(
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is the answer.',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
      {
        showRefinement: false,
        onRetry: vi.fn(),
        onSend: vi.fn(),
      },
    )
    expect(screen.queryByRole('button', { name: /shorter/i })).not.toBeInTheDocument()
  })

  it('does not show RefinementRow on a streaming turn', () => {
    renderMessage(
      {
        id: 'a1',
        role: 'assistant',
        content: 'partial',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      },
      {
        showRefinement: true,
        onRetry: vi.fn(),
        onSend: vi.fn(),
      },
    )
    expect(screen.queryByRole('button', { name: /shorter/i })).not.toBeInTheDocument()
  })
})

// --- Fork honesty copy (Lane D) ----------------------------------------------
// Local means local: the fork copy must never claim a Hermes-persisted branch /
// DAG / saved session. It must say the fork is local until you send it, and that
// a historical fork starts a NEW chat (the earlier turns are reference-only).
describe('Message — fork honesty copy', () => {
  it('uses the exact, plain action label "Fork from here"', () => {
    renderMessage(
      {
        id: 'a1',
        role: 'assistant',
        content: 'an answer',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
      { onFork: vi.fn() },
    )
    expect(screen.getByRole('button', { name: FORK_COPY.action })).toBeInTheDocument()
    expect(FORK_COPY.action).toBe('Fork from here')
  })

  it('never claims a Hermes-persisted DAG or saved branch anywhere in the copy', () => {
    const all = Object.values(FORK_COPY).join(' ').toLowerCase()
    // No dishonest persistence claims.
    expect(all).not.toMatch(/persisted|\bdag\b|saved to hermes|hermes session is saved/)
    // It DOES affirm the original is still saved (true — local copy, never deleted).
    expect(FORK_COPY.localBanner.toLowerCase()).toMatch(/original chat is still saved/)
    // The historical-fork copy is honest that the next message starts a new chat
    // AND that the earlier messages still ride along as context (they are sent
    // as conversation_history on every run — never claim "reference only").
    expect(FORK_COPY.newChatContext.toLowerCase()).toMatch(/new chat/)
    expect(FORK_COPY.newChatContext.toLowerCase()).toMatch(/sent along as context/)
    expect(FORK_COPY.newChatContext.toLowerCase()).not.toMatch(/reference only/)
    // The pre-send copy is honest that the fork is local.
    expect(FORK_COPY.beforeSend.toLowerCase()).toMatch(/local until you send/)
  })
})

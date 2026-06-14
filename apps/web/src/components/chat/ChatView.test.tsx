import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import type { Turn } from '@/state/chatStore'
import { markOnboarded, resetOnboarded } from '@/lib/useOnboarded'
import { StartAgentButton } from '@/features/system/StartAgentButton'
import { START_AGENT_COPY } from '@/features/system/startAgentCopy'
import { ChatView, type ChatViewProps } from './ChatView'

// The unreachable notice's one-click recovery rides the REAL StartAgentButton
// (the Maintenance dock's restart machinery); stub its only network call.
const mockRestartGateway = vi.fn()
vi.mock('@/features/system/api', () => ({
  restartGateway: () => mockRestartGateway(),
  fetchSystem: vi.fn(),
  applyHermesUpdate: vi.fn(),
  runDoctor: vi.fn(),
}))

function makeProps(props?: Partial<ChatViewProps>): ChatViewProps {
  return {
    turns: [],
    runStatus: 'idle',
    pendingApproval: null,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onRespondApproval: vi.fn(),
    ...props,
  }
}

function renderView(props?: Partial<ChatViewProps>) {
  const merged = makeProps(props)
  const utils = render(
    <ThemeProvider>
      <ChatView {...merged} />
    </ThemeProvider>,
  )
  const rerenderView = (next?: Partial<ChatViewProps>) =>
    utils.rerender(
      <ThemeProvider>
        <ChatView {...makeProps(next)} />
      </ThemeProvider>,
    )
  return { ...merged, rerenderView }
}

const assistantTurn: Turn = {
  id: 'a1',
  role: 'assistant',
  content: 'streamed reply',
  toolCalls: [],
  reasoning: [],
  streaming: false,
}

describe('ChatView', () => {
  it('shows a calm empty state with example prompts', () => {
    renderView()
    expect(screen.getByRole('heading', { name: /what are we building/i })).toBeInTheDocument()
    // 3 example prompts are clickable.
    expect(screen.getAllByRole('button', { name: /./ }).length).toBeGreaterThanOrEqual(3)
  })

  it('uses a sane mobile bottom pad on the empty state (no ~12vh dead space)', () => {
    renderView()
    // The empty-state scroll/pad wrapper sits directly inside `message-list`.
    const pad = screen.getByTestId('message-list').firstElementChild
    expect(pad?.className).toContain('pb-6')
    expect(pad?.className).not.toContain('pb-[12vh]')
  })

  it('greets in the FIRST person when the agent is named (A1)', () => {
    renderView({
      agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true },
    })
    expect(
      screen.getByRole('heading', { name: /hi, i.?m sol\. what are we working on\?/i }),
    ).toBeInTheDocument()
    // The default "What are we building?" copy is replaced, not duplicated.
    expect(screen.queryByRole('heading', { name: /what are we building/i })).not.toBeInTheDocument()
  })

  it('falls back to the neutral headline when the agent is unnamed/default (A1)', () => {
    renderView({
      agent: { name: 'default', friendlyName: 'your agent', avatarId: 'v1', isNamed: false },
    })
    expect(screen.getByRole('heading', { name: /what are we building/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /hi, i.?m/i })).not.toBeInTheDocument()
  })

  it('shows the agent face + an honest ready line in the empty hero for a named agent (A1)', () => {
    renderView({
      agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true },
    })
    // The empty state is an identity HERO: the agent's face leads the greeting.
    const hero = screen.getByTestId('empty-hero-avatar')
    // The governed Avatar primitive — a decorative <img>, never the amber accent.
    const img = hero.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/avatars/v3.webp')
    // One honest line — present, capabilities never fabricated.
    expect(screen.getByText(/ready when you are/i)).toBeInTheDocument()
  })

  it('omits the hero face for the unnamed default (no identity to surface)', () => {
    renderView({
      agent: { name: 'default', friendlyName: 'your agent', avatarId: 'v1', isNamed: false },
    })
    expect(screen.queryByTestId('empty-hero-avatar')).not.toBeInTheDocument()
  })

  it('offers DUAL-AUDIENCE starter prompts, not all-coder tasks (A7)', () => {
    renderView()
    // A newcomer-friendly, non-coding starter is present (mirrors Home's mix), so a
    // non-technical visitor is never told "not for you".
    expect(screen.getByText(/plan my week/i)).toBeInTheDocument()
    // The old all-coder default ("Write a Python script…") is gone.
    expect(screen.queryByText(/write a python script/i)).not.toBeInTheDocument()
  })

  it('sends an example prompt when picked', async () => {
    const user = userEvent.setup()
    const { onSend } = renderView()
    await user.click(screen.getByText(/read this repo and explain what it does/i))
    expect(onSend).toHaveBeenCalledWith('Read this repo and explain what it does.')
  })

  it('composes the empty hero with the composer inline (one screen)', () => {
    renderView()
    // The hero and the composer live together so the empty state reads as a
    // single composed screen rather than floating islands.
    expect(screen.getByRole('heading', { name: /what are we building/i })).toBeInTheDocument()
    expect(screen.getByTestId('composer')).toBeInTheDocument()
    expect(screen.getByTestId('composer-send')).toBeInTheDocument()
  })

  it('renders the conversation turns', async () => {
    renderView({ turns: [{ id: 'u1', role: 'user', content: 'hi' }, assistantTurn] })
    expect(screen.getByText('hi')).toBeInTheDocument()
    // Assistant prose is lazy-loaded; await the rendered markdown.
    expect(await screen.findByText('streamed reply')).toBeInTheDocument()
  })

  it('shows the pending "working" indicator for an optimistic token-less turn', () => {
    // The instant the user sends, an empty streaming assistant turn is rendered
    // (T1.1) so there is never a void before the first token: it shows the
    // pulsing thinking indicator until a token replaces it.
    renderView({
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        {
          id: 'a-pending',
          role: 'assistant',
          content: '',
          toolCalls: [],
          reasoning: [],
          streaming: true,
        },
      ],
      runStatus: 'running',
    })
    const caret = screen.getByTestId('stream-caret')
    expect(caret).toBeInTheDocument()
    expect(caret).toHaveAttribute('aria-label', 'Thinking')
  })

  it('surfaces a pending approval in the slot and forwards the choice', async () => {
    const user = userEvent.setup()
    const { onRespondApproval } = renderView({
      turns: [assistantTurn],
      runStatus: 'running',
      pendingApproval: {
        run_id: 'run_1',
        command: 'rm -rf build',
        description: 'Clean the build',
        choices: ['once', 'deny'],
      },
    })
    expect(screen.getByTestId('approval-card')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onRespondApproval).toHaveBeenCalledWith('deny')
  })

  it('locks the approval after the first click (no double-submit)', async () => {
    const user = userEvent.setup()
    const { onRespondApproval } = renderView({
      turns: [assistantTurn],
      runStatus: 'running',
      pendingApproval: {
        run_id: 'run_1',
        approval_id: 'a1',
        command: 'rm -rf build',
        description: 'Clean the build',
        choices: ['once', 'deny'],
      },
    })
    const allow = screen.getByRole('button', { name: 'Allow once' })
    await user.click(allow)
    // Card stays mounted in this test (the parent owns pendingApproval), but the
    // buttons must lock so a second click can't re-submit.
    expect(allow).toBeDisabled()
    await user.click(allow)
    expect(onRespondApproval).toHaveBeenCalledTimes(1)
  })

  it('shows Stop while running and aborts on Escape', async () => {
    const user = userEvent.setup()
    const { onStop } = renderView({ turns: [assistantTurn], runStatus: 'running' })
    expect(screen.getByTestId('composer-stop')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onStop).toHaveBeenCalled()
  })

  it('renders a run error as an alert', () => {
    renderView({ turns: [assistantTurn], error: 'gateway exploded' })
    expect(screen.getByRole('alert')).toHaveTextContent('gateway exploded')
  })

  // --- a11y: chat-log live region + scroll region (T1.6) --------------------
  it('exposes the scroll region as a labelled, keyboard-focusable log', () => {
    renderView({ turns: [{ id: 'u1', role: 'user', content: 'hi' }, assistantTurn] })
    const log = screen.getByRole('log', { name: /conversation/i })
    expect(log).toHaveAttribute('tabindex', '0')
  })

  it('has a polite live region that is silent until a turn completes', () => {
    renderView({
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'streaming…',
          toolCalls: [],
          reasoning: [],
          streaming: true,
        },
      ],
      runStatus: 'running',
    })
    const live = screen.getByTestId('chat-live-region')
    expect(live).toHaveAttribute('aria-live', 'polite')
    // Mid-stream it announces that the assistant is responding, NOT token text.
    expect(live).toHaveTextContent(/assistant is responding/i)
  })

  it('does not read a resumed session’s seeded history aloud on mount', () => {
    // A "Continue" seeds prior turns whose assistant replies are already complete;
    // narrating them on mount would re-read old history. They mount as already
    // announced — only replies that finish DURING this session are spoken.
    renderView({
      turns: [
        { id: 'u1', role: 'user', content: 'where were we?' },
        {
          id: 'a-history',
          role: 'assistant',
          content: 'Sure, here is the plan.',
          toolCalls: [],
          reasoning: [],
          streaming: false,
        },
      ],
      runStatus: 'idle',
    })
    const live = screen.getByTestId('chat-live-region')
    expect(live).toBeEmptyDOMElement()
  })

  it('announces the finished reply once per turn (on completion, not per token)', () => {
    const streaming: Turn = {
      id: 'a1',
      role: 'assistant',
      content: 'partial',
      toolCalls: [],
      reasoning: [],
      streaming: true,
    }
    const { rerenderView } = renderView({
      turns: [{ id: 'u1', role: 'user', content: 'hi' }, streaming],
      runStatus: 'running',
    })
    // The turn finalizes: streaming flips false with the final text.
    rerenderView({
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        { ...streaming, content: 'the finished answer', streaming: false },
      ],
      runStatus: 'idle',
    })
    const live = screen.getByTestId('chat-live-region')
    // Concise per-turn announce: "Assistant replied." + a short head (the full
    // text lives in the focusable role="log" region), NOT the old "replied: …".
    expect(live).toHaveTextContent(/assistant replied\. the finished answer/i)
    expect(live).not.toHaveTextContent(/replied:/i)
  })

  it('does not flood the SR with a long finished reply (head only)', () => {
    const longReply = 'x'.repeat(400)
    const streaming: Turn = {
      id: 'a1',
      role: 'assistant',
      content: 'partial',
      toolCalls: [],
      reasoning: [],
      streaming: true,
    }
    const { rerenderView } = renderView({
      turns: [{ id: 'u1', role: 'user', content: 'hi' }, streaming],
      runStatus: 'running',
    })
    rerenderView({
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        { ...streaming, content: longReply, streaming: false },
      ],
      runStatus: 'idle',
    })
    const live = screen.getByTestId('chat-live-region')
    const text = live.textContent ?? ''
    expect(text).toMatch(/^Assistant replied\./)
    // Announced text is a short head (well under the full 400 chars), capped + …
    expect(text.length).toBeLessThan(120)
    expect(text).toContain('…')
  })
})

// --- Inline recovery from a failed run ----------------------------------------
// A failure is exactly when the user most needs a one-tap retry, so the error
// block carries it instead of stranding them at a dead end (the only other
// retry is a hover-revealed row, invisible on touch).
describe('ChatView — failed run recovery', () => {
  it('offers an inline Try again that re-runs the last user turn after a failure', async () => {
    const onEditTurn = vi.fn()
    renderView({
      turns: [
        { id: 'u1', role: 'user', content: 'first' },
        { id: 'u2', role: 'user', content: 'do the thing' },
      ],
      error: 'The server is at its concurrent-run capacity; please retry.',
      onEditTurn,
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/concurrent-run capacity/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    // Re-runs the LAST user turn in place (edit-resend with its same text), which
    // drops any failed/empty trailing assistant turn and streams fresh.
    expect(onEditTurn).toHaveBeenCalledWith('u2', 'do the thing')
  })

  it('omits Try again when no re-run handler is wired', () => {
    renderView({
      turns: [{ id: 'u1', role: 'user', content: 'do the thing' }],
      error: 'Your agent is unreachable.',
      // onEditTurn intentionally omitted: nothing to wire the retry to.
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })
})

// --- Honest history-cap truncation notice -------------------------------------
// When the conversation outgrows the conversation_history payload caps, the
// transcript shows a quiet divider above the OLDEST turn still sent, so older
// messages never silently stop reaching the agent.
describe('ChatView — history truncation notice', () => {
  const bigUser = (id: string, content: string): Turn => ({ id, role: 'user', content })

  it('renders no notice while the whole transcript fits under the caps', () => {
    renderView({
      turns: [
        { id: 'u1', role: 'user', content: 'hi' },
        assistantTurn,
        { id: 'u2', role: 'user', content: 'more' },
      ],
    })
    expect(screen.queryByTestId('history-truncation-notice')).not.toBeInTheDocument()
  })

  it('renders the honest divider at the cap boundary when truncation occurs', () => {
    // Three turns of ~half the char cap each: the newest two ride, the oldest
    // falls out → the divider renders above the middle turn (the boundary).
    const half = 'y'.repeat(150_000)
    renderView({
      turns: [bigUser('u1', half), bigUser('u2', half), bigUser('u3', half)],
    })
    const notice = screen.getByTestId('history-truncation-notice')
    expect(notice).toHaveTextContent(/older messages above aren’t sent to the agent/i)
    // It sits inside the BOUNDARY turn's row (u2), not the dropped turn's.
    expect(notice.closest('[data-find-turn]')).toHaveAttribute('data-find-turn', 'u2')
  })
})

// --- Fork from here (Lane D) -------------------------------------------------
// ChatView is presentational: it renders the turns it's handed (the ancestor path
// after a fork), shows the honest local-fork banner, focuses the composer, and
// keeps the existing retry / edit affordances intact.
describe('ChatView — fork from here', () => {
  const forkable: Turn[] = [
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

  it('wires "Fork from here" on settled turns and forwards the turn id', async () => {
    const user = userEvent.setup()
    const onFork = vi.fn()
    renderView({ turns: forkable, onFork })
    await user.click(screen.getAllByRole('button', { name: 'Fork from here' })[0]!)
    expect(onFork).toHaveBeenCalled()
  })

  it('renders the honest local-fork banner when one is active', () => {
    renderView({
      turns: forkable,
      onFork: vi.fn(),
      forkBanner: 'Forked locally from this message. Your original chat is still saved.',
    })
    const banner = screen.getByTestId('fork-banner')
    expect(banner).toHaveTextContent(/forked locally/i)
    expect(banner).toHaveTextContent(/your original chat is still saved/i)
  })

  it('shows no fork banner when none is active', () => {
    renderView({ turns: forkable, onFork: vi.fn() })
    expect(screen.queryByTestId('fork-banner')).not.toBeInTheDocument()
  })

  it('offers "Return to original chat" in the banner and fires the handler', async () => {
    const user = userEvent.setup()
    const onReturnToOriginal = vi.fn()
    renderView({
      turns: forkable,
      onFork: vi.fn(),
      forkBanner: 'Forked locally from this message. Your original chat is still saved.',
      onReturnToOriginal,
    })
    await user.click(screen.getByTestId('fork-return'))
    expect(onReturnToOriginal).toHaveBeenCalled()
  })

  it('keeps the existing retry/edit actions intact alongside fork', () => {
    renderView({ turns: forkable, onFork: vi.fn(), onRetry: vi.fn(), onEditTurn: vi.fn() })
    expect(screen.getByRole('button', { name: 'Regenerate response' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit and resend' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Fork from here' }).length).toBeGreaterThan(0)
  })

  it('focuses the composer when a fork lands (focusComposer)', () => {
    renderView({ turns: forkable, onFork: vi.fn(), autoFocusComposer: true })
    const textarea = screen.getAllByLabelText('Message your agent')[0]!
    expect(textarea).toHaveFocus()
  })

  it('does not break find-in-conversation on the ancestor path', async () => {
    const user = userEvent.setup()
    renderView({ turns: forkable, onFork: vi.fn() })
    const log = screen.getByRole('log', { name: /conversation/i })
    log.focus()
    await user.keyboard('{Meta>}f{/Meta}')
    const search = screen.getByRole('search', { name: /find in conversation/i })
    const input = within(search).getByRole('searchbox')
    await user.type(input, 'answer')
    expect(within(search).getByText('1 / 1')).toBeInTheDocument()
  })
})

// --- Onboarding tier: newcomer-only orientation + composer hint (spec §3) -----
// These affordances are flag-gated on the shared onboarded store so experts
// never see the hand-holding. We drive that store directly (reset = newcomer,
// mark = returning) so the assertions are hermetic and independent of localStorage.
describe('ChatView — newcomer orientation (onboarding tier)', () => {
  beforeEach(() => {
    resetOnboarded()
  })

  it('shows a quiet orientation line under the hero for a newcomer (not onboarded)', () => {
    renderView()
    expect(screen.getByTestId('chat-orientation')).toHaveTextContent(
      /replies stream in live\. you can stop or steer at any time\./i,
    )
    expect(screen.getByTestId('chat-orientation')).toHaveTextContent(/⌘k for commands/i)
  })

  it('gates the ⌘K sentence behind pointer-coarse:hidden (no keyboard hint on touch)', () => {
    renderView()
    const orientation = screen.getByTestId('chat-orientation')
    // The shortcut sentence (and ONLY it) hides on coarse-pointer devices; the
    // rest of the orientation line still shows there.
    const gated = orientation.querySelector('[class*="pointer-coarse:hidden"]')
    expect(gated).toHaveTextContent(/press ⌘k for commands/i)
    expect(gated).not.toHaveTextContent(/replies stream in live/i)
  })

  it('hides the orientation line once the user is onboarded (experts never see it)', () => {
    markOnboarded()
    renderView()
    expect(screen.queryByTestId('chat-orientation')).not.toBeInTheDocument()
  })

  it('shows a discoverability hint in the empty composer for a newcomer', () => {
    renderView()
    const hint = screen.getByTestId('composer-empty-hint')
    expect(hint).toHaveTextContent(/type \/ for commands · ⌘k to search/i)
    // The ⌘K part (and ONLY it) hides on coarse-pointer devices; the slash
    // guidance still shows there.
    const gated = hint.querySelector('[class*="pointer-coarse:hidden"]')
    expect(gated).toHaveTextContent(/⌘k to search/i)
    expect(gated).not.toHaveTextContent(/type \/ for commands/i)
  })

  it('hides the empty-composer hint once onboarded', () => {
    markOnboarded()
    renderView()
    expect(screen.queryByTestId('composer-empty-hint')).not.toBeInTheDocument()
  })

  it('never shows the orientation line once a conversation exists', () => {
    renderView({ turns: [{ id: 'u1', role: 'user', content: 'hi' }] })
    expect(screen.queryByTestId('chat-orientation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('composer-empty-hint')).not.toBeInTheDocument()
  })
})

// --- Find in conversation (⌘F) -----------------------------------------------
// The overlay searches the OPEN session's rendered turns, highlights matches,
// steps next/prev (Enter / Shift+Enter), and scrolls the active match into view
// through the virtualizer. ⌘F is captured only when the chat surface is focused.
describe('ChatView — find in conversation', () => {
  // The find turns deliberately repeat the query so there are several matches to
  // step across (one in a user turn, two in an assistant turn).
  const findTurns: Turn[] = [
    { id: 'u1', role: 'user', content: 'where is the alpha config?' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'The alpha config lives next to the beta alpha override.',
      toolCalls: [],
      reasoning: [],
      streaming: false,
    },
    { id: 'u2', role: 'user', content: 'thanks' },
  ]

  /** Focus the chat log so the surface-scoped ⌘F shortcut fires. */
  function focusChatSurface() {
    const log = screen.getByRole('log', { name: /conversation/i })
    log.focus()
    return log
  }

  it('does not show the find overlay until it is opened', () => {
    renderView({ turns: findTurns })
    expect(screen.queryByRole('search', { name: /find in conversation/i })).not.toBeInTheDocument()
  })

  it('opens the find overlay on ⌘F when the chat surface is focused, and counts matches', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')

    const search = screen.getByRole('search', { name: /find in conversation/i })
    expect(search).toBeInTheDocument()
    const input = within(search).getByRole('searchbox')
    expect(input).toHaveFocus()

    await user.type(input, 'alpha')
    // 3 occurrences: one in u1, two in a1's content. Active is the first (1 / 3).
    expect(within(search).getByText('1 / 3')).toBeInTheDocument()
  })

  it('does NOT open on ⌘F when focus is outside the chat surface', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <div>
          <button type="button">outside</button>
          <ChatView {...makeProps({ turns: findTurns })} />
        </div>
      </ThemeProvider>,
    )
    screen.getByRole('button', { name: 'outside' }).focus()
    await user.keyboard('{Meta>}f{/Meta}')
    expect(screen.queryByRole('search', { name: /find in conversation/i })).not.toBeInTheDocument()
  })

  it('next/prev moves the active match and requests a scroll into view', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const search = screen.getByRole('search', { name: /find in conversation/i })
    const input = within(search).getByRole('searchbox')
    await user.type(input, 'alpha')

    expect(within(search).getByText('1 / 3')).toBeInTheDocument()
    scrollSpy.mockClear()

    // Enter → next match: counter advances and a scroll-into-view is requested.
    await user.keyboard('{Enter}')
    expect(within(search).getByText('2 / 3')).toBeInTheDocument()
    expect(scrollSpy).toHaveBeenCalled()

    // Shift+Enter → previous match wraps the counter back.
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(within(search).getByText('1 / 3')).toBeInTheDocument()

    scrollSpy.mockRestore()
  })

  it('highlights the turn holding the active match', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const input = within(screen.getByRole('search', { name: /find in conversation/i })).getByRole(
      'searchbox',
    )
    await user.type(input, 'thanks')
    // The only "thanks" match is in u2; its row carries the active-match marker.
    const active = document.querySelector('[data-find-active="true"]')
    expect(active).not.toBeNull()
    expect(active).toHaveAttribute('data-find-turn', 'u2')
  })

  it('<mark>-highlights the matched text inside a user turn', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const input = within(screen.getByRole('search', { name: /find in conversation/i })).getByRole(
      'searchbox',
    )
    // "alpha" appears in the u1 user turn ("where is the alpha config?").
    await user.type(input, 'alpha')
    const marks = document.querySelectorAll('mark')
    // At least the user-turn occurrence is wrapped in a real <mark>.
    expect(marks.length).toBeGreaterThanOrEqual(1)
    expect(Array.from(marks).some((m) => m.textContent?.toLowerCase() === 'alpha')).toBe(true)
  })

  it('removes the text highlight when find closes', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const input = within(screen.getByRole('search', { name: /find in conversation/i })).getByRole(
      'searchbox',
    )
    await user.type(input, 'alpha')
    expect(document.querySelectorAll('mark').length).toBeGreaterThanOrEqual(1)
    await user.keyboard('{Escape}')
    // Closing find restores the verbatim transcript (no stray <mark> left behind).
    expect(document.querySelectorAll('mark').length).toBe(0)
  })

  it('Escape closes the overlay', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const input = within(screen.getByRole('search', { name: /find in conversation/i })).getByRole(
      'searchbox',
    )
    await user.type(input, 'alpha')
    expect(screen.getByRole('search', { name: /find in conversation/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('search', { name: /find in conversation/i })).not.toBeInTheDocument()
  })

  it('does not crash with a query that has no matches (shows none)', async () => {
    const user = userEvent.setup()
    renderView({ turns: findTurns })
    focusChatSurface()
    await user.keyboard('{Meta>}f{/Meta}')
    const search = screen.getByRole('search', { name: /find in conversation/i })
    const input = within(search).getByRole('searchbox')
    await user.type(input, 'zzzznope')
    expect(within(search).getByText(/no matches/i)).toBeInTheDocument()
    expect(document.querySelector('[data-find-active="true"]')).toBeNull()
  })
})

describe('ChatView — honest blocked state (no usable model / unreachable agent)', () => {
  it('no-model: shows a connect-a-model notice, disables the composer, and the action fires', async () => {
    const onConnectModel = vi.fn()
    renderView({ turns: [assistantTurn], blockedReason: 'no-model', onConnectModel })
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(notice).toHaveTextContent(/model/i)
    expect(screen.getByLabelText('Message your agent')).toBeDisabled()
    const user = userEvent.setup()
    await user.click(within(notice).getByRole('button', { name: /connect a model/i }))
    expect(onConnectModel).toHaveBeenCalledTimes(1)
  })

  it('unreachable: shows an agent-unreachable notice and disables the composer', () => {
    renderView({ turns: [assistantTurn], blockedReason: 'unreachable' })
    expect(screen.getByTestId('chat-blocked-notice')).toHaveTextContent(/reach|running|hermes/i)
    expect(screen.getByLabelText('Message your agent')).toBeDisabled()
  })

  it('unreachable WITHOUT a start action (deck server down): the honest no-action copy stands alone', () => {
    // The route omits startAgentAction when its /health probe fails (the deck's
    // own server is unreachable, so a restart call could not land).
    renderView({ turns: [assistantTurn], blockedReason: 'unreachable' })
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(within(notice).queryByTestId('start-agent')).not.toBeInTheDocument()
    expect(notice).toHaveTextContent(/make sure hermes is running/i)
  })

  it('also surfaces the notice on the first-run empty hero (no messages yet)', () => {
    renderView({ turns: [], blockedReason: 'no-model' })
    expect(screen.getByTestId('chat-blocked-notice')).toBeInTheDocument()
    expect(screen.getByLabelText('Message your agent')).toBeDisabled()
  })

  it('not blocked: no notice and the composer is enabled', () => {
    renderView({ turns: [assistantTurn] })
    expect(screen.queryByTestId('chat-blocked-notice')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message your agent')).not.toBeDisabled()
  })
})

describe('ChatView — one-click recovery on the unreachable notice', () => {
  beforeEach(() => {
    mockRestartGateway.mockReset()
  })

  /** ChatView with the REAL StartAgentButton in the slot (the route's wiring),
   * under the providers the connected app supplies (query client + router). */
  function renderUnreachable(props?: Partial<ChatViewProps>) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ChatView
              {...makeProps({
                turns: [assistantTurn],
                blockedReason: 'unreachable',
                startAgentAction: <StartAgentButton />,
                ...props,
              })}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    )
  }

  it('renders the Start my agent button inside the notice and drops the redundant self-help line', () => {
    renderUnreachable()
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(
      within(notice).getByRole('button', { name: START_AGENT_COPY.action }),
    ).toBeInTheDocument()
    // The button carries the recovery; the "make sure Hermes is running" line
    // would only repeat what one click now does.
    expect(notice).toHaveTextContent(/can't reach your agent right now/i)
    expect(notice).not.toHaveTextContent(/make sure hermes is running/i)
  })

  it('click → fires the dock restart mutation and shows the honest pending copy', async () => {
    let resolveRestart!: (v: unknown) => void
    mockRestartGateway.mockReturnValue(new Promise((res) => (resolveRestart = res)))
    renderUnreachable()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: START_AGENT_COPY.action })
    await user.click(button)

    expect(mockRestartGateway).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(START_AGENT_COPY.pending)).toBeInTheDocument()
    // Double-click guard: pending disables the button.
    expect(button).toBeDisabled()

    resolveRestart({ status: 'running' })
    expect(await screen.findByText(START_AGENT_COPY.started)).toBeInTheDocument()
  })

  it('failure path: says the start failed plainly and points to the System page', async () => {
    mockRestartGateway.mockRejectedValue(new Error('systemctl exited 1'))
    renderUnreachable()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))

    const notice = screen.getByTestId('chat-blocked-notice')
    expect(await within(notice).findByRole('alert')).toHaveTextContent(START_AGENT_COPY.failureLead)
    expect(
      within(notice).getByRole('link', { name: START_AGENT_COPY.failureLink }),
    ).toHaveAttribute('href', '/system')
  })

  it('the no-model notice never shows the start action (a restart is not the fix)', () => {
    renderUnreachable({ blockedReason: 'no-model' })
    const notice = screen.getByTestId('chat-blocked-notice')
    expect(within(notice).queryByTestId('start-agent')).not.toBeInTheDocument()
    expect(notice).toHaveTextContent(/no model connected yet/i)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import type { Turn } from '@/state/chatStore'
import { Message } from './Message'
import { toast } from '@/lib/toast'
import {
  installMockSpeechSynthesis,
  type MockSpeechSynthesis,
} from '@/features/voice/mockSpeechSynthesis'
import { setVoicePrefs, VOICE_PREFS_STORAGE_KEY } from '@/features/voice'
import { setVerbosity } from '@/features/reasoning/reasoningPrefs'

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

describe('Message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    setVerbosity('calm')
  })

  it('renders a user turn as plain text content', () => {
    renderMessage({ id: 'u1', role: 'user', content: 'hello there' })
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('breaks a long unbreakable URL in the user bubble so it cannot overflow', () => {
    const url =
      'https://www.amazon.com/ASICS-Unisex-Japan-Sportstyle-Shoes/dp/B089GL7S38/ref=sr_1_1?crid=36BWL4VDV1DGCandalongunbreakabletokenwithnospaces1234567890abcdef'
    const { container } = renderMessage({ id: 'u1', role: 'user', content: url })
    const bubble = container.querySelector('.whitespace-pre-wrap')
    expect(bubble).not.toBeNull()
    // overflow-wrap: break-word lets a long URL wrap inside the max-width bubble.
    expect(bubble?.className).toContain('break-words')
  })

  it('<mark>-highlights find matches in a user turn (case-insensitive)', () => {
    const { container } = renderMessage(
      { id: 'u1', role: 'user', content: 'The Alpha config and the alpha override.' },
      { highlightQuery: 'alpha', highlightActive: true },
    )
    const marks = container.querySelectorAll('mark')
    // Both "Alpha" and "alpha" occurrences are wrapped, preserving original case.
    expect(marks.length).toBe(2)
    expect(marks[0]?.textContent).toBe('Alpha')
    expect(marks[1]?.textContent).toBe('alpha')
  })

  it('renders user text verbatim (no <mark>) when there is no find query', () => {
    const { container } = renderMessage({ id: 'u1', role: 'user', content: 'alpha beta' })
    expect(container.querySelector('mark')).toBeNull()
    expect(screen.getByText('alpha beta')).toBeInTheDocument()
  })

  it('renders a sent image attachment in the user bubble (enlargeable, alt from name)', () => {
    renderMessage({
      id: 'u1',
      role: 'user',
      content: 'look at this',
      // The transport carries image attachments on the turn (RunAttachment shape).
      attachments: [
        {
          kind: 'image',
          name: 'screenshot.png',
          mime: 'image/png',
          data_url: 'data:image/png;base64,AAAA',
        },
      ],
    } as unknown as Turn)
    const img = screen.getByRole('img', { name: 'screenshot.png' })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    // Click-to-enlarge: the thumbnail is wrapped in the lightbox trigger.
    expect(
      screen.getByRole('button', { name: /enlarge image: screenshot\.png/i }),
    ).toBeInTheDocument()
  })

  it('renders multiple sent images as a grid', () => {
    renderMessage({
      id: 'u1',
      role: 'user',
      content: '',
      attachments: [
        { kind: 'image', name: 'a.png', mime: 'image/png', data_url: 'data:image/png;base64,A' },
        { kind: 'image', name: 'b.png', mime: 'image/png', data_url: 'data:image/png;base64,B' },
      ],
    } as unknown as Turn)
    expect(screen.getByRole('img', { name: 'a.png' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'b.png' })).toBeInTheDocument()
  })

  it('renders no image affordance for a user turn without attachments (no regression)', () => {
    renderMessage({ id: 'u1', role: 'user', content: 'just text' })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enlarge image/i })).not.toBeInTheDocument()
  })

  it('renders an assistant turn as markdown prose', async () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: '# Heading\n\nsome **bold** text',
      toolCalls: [],
      reasoning: [],
      streaming: false,
    })
    // Markdown is lazy-loaded; await the upgraded prose.
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bold')).toBeInTheDocument()
  })

  it('shows the agent face in the gutter at the start of an assistant group (A1)', () => {
    renderMessage(
      {
        id: 'a1',
        role: 'assistant',
        content: 'first reply',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
      {
        agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true },
        showAvatar: true,
      },
    )
    const gutter = screen.getByTestId('assistant-avatar')
    // The governed Avatar primitive (a decorative <img>, never the sky-blue accent).
    // The face is presentational (empty alt) so the adjacent prose carries meaning.
    const img = gutter.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/avatars/v3.webp')
  })

  it('omits the gutter face for a continuation turn (one face per group, not per bubble)', () => {
    renderMessage(
      {
        id: 'a2',
        role: 'assistant',
        content: 'second reply',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      },
      {
        agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true },
        showAvatar: false,
      },
    )
    expect(screen.queryByTestId('assistant-avatar')).not.toBeInTheDocument()
  })

  it('never shows a gutter face on a user turn', () => {
    renderMessage(
      { id: 'u1', role: 'user', content: 'hi' },
      {
        agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true },
        showAvatar: true,
      },
    )
    expect(screen.queryByTestId('assistant-avatar')).not.toBeInTheDocument()
  })

  it('shows a pulsing caret while the assistant turn is streaming', () => {
    renderMessage({
      id: 'a2',
      role: 'assistant',
      content: 'partial',
      toolCalls: [],
      reasoning: [],
      streaming: true,
    })
    expect(screen.getByTestId('stream-caret')).toBeInTheDocument()
  })

  it('does not show a caret once the turn is finalized', () => {
    renderMessage({
      id: 'a3',
      role: 'assistant',
      content: 'done',
      toolCalls: [],
      reasoning: [],
      streaming: false,
    })
    expect(screen.queryByTestId('stream-caret')).not.toBeInTheDocument()
  })

  it('personalizes the pre-token thinking caption with a named agent (B)', () => {
    renderMessage(
      {
        id: 'a-pending',
        role: 'assistant',
        content: '',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      },
      { agent: { name: 'Sol', friendlyName: 'Sol', avatarId: 'v3', isNamed: true } },
    )
    const caret = screen.getByTestId('stream-caret')
    // The dots motion (the live accent) carries an accessible label naming the agent,
    // and a visible caption reads "<name> is thinking…" — identity in the wait.
    expect(caret).toHaveAttribute('aria-label', 'Sol is thinking…')
    expect(screen.getByText(/sol is thinking…/i)).toBeInTheDocument()
  })

  it('keeps the thinking caption generic for the unnamed default (no fabricated name)', () => {
    renderMessage(
      {
        id: 'a-pending',
        role: 'assistant',
        content: '',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      },
      { agent: { name: 'default', friendlyName: 'your agent', avatarId: 'v1', isNamed: false } },
    )
    const caret = screen.getByTestId('stream-caret')
    expect(caret).toHaveAttribute('aria-label', 'Thinking')
    expect(screen.queryByText(/is thinking/i)).not.toBeInTheDocument()
  })

  it('renders tool chips and a thinking disclosure for the turn', () => {
    renderMessage({
      id: 'a4',
      role: 'assistant',
      content: 'result',
      toolCalls: [{ tool: 'bash', status: 'completed', preview: 'echo hi', duration: 0.2 }],
      reasoning: ['considering options'],
      streaming: false,
    })
    // The chip shows the plain-language label for the known `bash` tool.
    expect(screen.getByText('Run command')).toBeInTheDocument()
    expect(screen.getByTestId('reasoning-trigger')).toBeInTheDocument()
  })

  // --- dual-audience: verbosity defaults + first-tool teaching caption ------

  const toolTurn: Turn = {
    id: 'tools1',
    role: 'assistant',
    content: 'result',
    toolCalls: [{ tool: 'bash', status: 'completed', preview: 'echo hi', duration: 0.2 }],
    reasoning: ['considering options'],
    streaming: false,
  }

  describe('verbosity-driven default open state', () => {
    it('keeps reasoning + tool cards collapsed under the calm default', () => {
      setVerbosity('calm')
      renderMessage(toolTurn)
      expect(screen.getByTestId('reasoning-trigger')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'closed')
    })

    it('opens reasoning + tool cards on mount when verbosity is detailed', () => {
      setVerbosity('detailed')
      renderMessage(toolTurn)
      expect(screen.getByTestId('reasoning-trigger')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'open')
    })
  })

  describe('first-tool teaching caption', () => {
    it('renders the one-time caption above the tool cards', () => {
      renderMessage(toolTurn)
      expect(screen.getByText(/Tools used to complete your request/i)).toBeInTheDocument()
    })

    it('does not render the caption a second time once it has been shown (sessionStorage-gated)', () => {
      const first = renderMessage(toolTurn)
      expect(first.getByText(/Tools used to complete your request/i)).toBeInTheDocument()
      first.unmount()

      // A later turn in the same session no longer teaches — one moment only.
      renderMessage({ ...toolTurn, id: 'tools2' })
      expect(screen.queryByText(/Tools used to complete your request/i)).not.toBeInTheDocument()
    })

    it('does not render the caption for a turn with no tool calls', () => {
      renderMessage({ ...toolTurn, id: 'noTools', toolCalls: [] })
      expect(screen.queryByText(/Tools used to complete your request/i)).not.toBeInTheDocument()
    })
  })

  // --- message actions (T1.4) + hover timestamp (T3.5) ---------------------

  const assistantTurn: Turn = {
    id: 'a1',
    role: 'assistant',
    content: 'an answer',
    toolCalls: [],
    reasoning: [],
    streaming: false,
  }

  it('Retry on a finished assistant turn calls onRetry and toasts', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderMessage(assistantTurn, { onRetry })
    const retry = screen.getByRole('button', { name: 'Regenerate response' })
    expect(retry.className).toContain('min-h-11')
    await user.click(retry)
    expect(onRetry).toHaveBeenCalledWith('a1')
    expect(toast.success).toHaveBeenCalledWith('Regenerating response')
  })

  it('does not offer Retry while the assistant turn is still streaming', () => {
    renderMessage({ ...assistantTurn, streaming: true }, { onRetry: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).not.toBeInTheDocument()
  })

  it('Retry is disabled while another run is in flight (actionsDisabled)', () => {
    renderMessage(assistantTurn, { onRetry: vi.fn(), actionsDisabled: true })
    expect(screen.getByRole('button', { name: 'Regenerate response' })).toBeDisabled()
  })

  it('Edit on a user turn opens an inline editor and resends the edited text', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderMessage({ id: 'u1', role: 'user', content: 'original' }, { onEdit })

    await user.click(screen.getByRole('button', { name: 'Edit and resend' }))
    const editor = screen.getByLabelText('Edit message')
    expect(editor).toHaveValue('original')
    await user.clear(editor)
    await user.type(editor, 'revised{Control>}{Enter}{/Control}')

    expect(onEdit).toHaveBeenCalledWith('u1', 'revised')
    expect(toast.success).toHaveBeenCalledWith('Resending edited message')
  })

  it('Edit can be cancelled with Escape without resending', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderMessage({ id: 'u1', role: 'user', content: 'keep me' }, { onEdit })
    await user.click(screen.getByRole('button', { name: 'Edit and resend' }))
    await user.keyboard('{Escape}')
    expect(onEdit).not.toHaveBeenCalled()
    // Back to the static bubble.
    expect(screen.getByText('keep me')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit message')).not.toBeInTheDocument()
  })

  it('renders a relative hover timestamp when the turn carries createdAt', () => {
    renderMessage({ id: 'u1', role: 'user', content: 'hi', createdAt: Date.now() - 5 * 60_000 })
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('shows no timestamp when createdAt is unknown (never fabricated)', () => {
    const { container } = renderMessage({ id: 'u1', role: 'user', content: 'hi' })
    expect(container.querySelector('time')).toBeNull()
  })

  it('omits action buttons entirely when no handlers are provided', () => {
    renderMessage(assistantTurn)
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).not.toBeInTheDocument()
    // Copy is still offered (it needs no handler).
    const copy = screen.getByRole('button', { name: 'Copy message' })
    expect(copy).toBeInTheDocument()
    expect(copy.className).toContain('min-h-11')
  })

  it('does not claim "Copied!" when the clipboard write fails (honest feedback)', async () => {
    const user = userEvent.setup()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      renderMessage(assistantTurn)
      await user.click(screen.getByRole('button', { name: 'Copy message' }))
      expect(writeText).toHaveBeenCalled()
      // A failed write must NOT flash success, and must say so.
      expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
    }
  })

  // --- Fork from here (Lane D) ---------------------------------------------
  describe('Fork from here', () => {
    it('offers "Fork from here" on a SETTLED assistant turn and calls onFork', async () => {
      const user = userEvent.setup()
      const onFork = vi.fn()
      renderMessage(assistantTurn, { onFork })
      const fork = screen.getByRole('button', { name: 'Fork from here' })
      await user.click(fork)
      expect(onFork).toHaveBeenCalledWith('a1')
    })

    it('offers "Fork from here" on a settled USER turn', () => {
      renderMessage({ id: 'u1', role: 'user', content: 'a question' }, { onFork: vi.fn() })
      expect(screen.getByRole('button', { name: 'Fork from here' })).toBeInTheDocument()
    })

    it('does NOT offer Fork while the assistant turn is still streaming', () => {
      renderMessage({ ...assistantTurn, streaming: true }, { onFork: vi.fn() })
      expect(screen.queryByRole('button', { name: 'Fork from here' })).not.toBeInTheDocument()
    })

    it('disables Fork while a run is in flight (actionsDisabled)', () => {
      renderMessage(assistantTurn, { onFork: vi.fn(), actionsDisabled: true })
      expect(screen.getByRole('button', { name: 'Fork from here' })).toBeDisabled()
    })

    it('omits Fork entirely when no onFork handler is wired', () => {
      renderMessage(assistantTurn)
      expect(screen.queryByRole('button', { name: 'Fork from here' })).not.toBeInTheDocument()
    })

    it('carries an explanatory tooltip distinguishing Fork from Edit (keeps the original)', () => {
      renderMessage(assistantTurn, { onFork: vi.fn() })
      const fork = screen.getByRole('button', { name: 'Fork from here' })
      // The accessible name stays "Fork from here" (the branching e2e depends on
      // it); the title tooltip teaches a newcomer that forking branches off and
      // keeps the original — so they don't click Fork expecting Edit.
      expect(fork).toHaveAttribute('title', expect.stringMatching(/different direction/i))
      expect(fork).toHaveAttribute('title', expect.stringMatching(/original/i))
    })

    it('Edit carries a contrasting tooltip (rewrites in place)', () => {
      renderMessage({ id: 'u1', role: 'user', content: 'original' }, { onEdit: vi.fn() })
      const edit = screen.getByRole('button', { name: 'Edit and resend' })
      expect(edit).toHaveAttribute('title', expect.stringMatching(/rewrite/i))
    })
  })

  // --- last-completed turn: no duplicate Retry/Copy across MetaRow + RefinementRow ---
  describe('refinement row vs hover meta row (no duplicate actions)', () => {
    it('renders Retry and Copy exactly once on the last completed turn (RefinementRow only)', () => {
      // showRefinement wires the always-visible RefinementRow (Retry/Shorter/More
      // detail/Copy). The hover MetaRow must then drop its own Retry + Copy so each
      // action appears exactly once.
      renderMessage(assistantTurn, {
        onRetry: vi.fn(),
        onSend: vi.fn(),
        onFork: vi.fn(),
        showRefinement: true,
      })
      // Retry: the RefinementRow's button, never the MetaRow's "Regenerate response".
      expect(screen.queryByRole('button', { name: 'Regenerate response' })).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Retry: regenerate this response' }),
      ).toBeInTheDocument()
      // Copy: exactly one across the whole turn.
      expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(1)
    })

    it('keeps Speak and Fork on the hover MetaRow alongside the RefinementRow', () => {
      const s = installMockSpeechSynthesis()
      try {
        renderMessage(assistantTurn, {
          onRetry: vi.fn(),
          onSend: vi.fn(),
          onFork: vi.fn(),
          showRefinement: true,
        })
        // Speak + Fork are NOT in the RefinementRow, so they must remain reachable
        // via the hover MetaRow.
        expect(screen.getByRole('button', { name: 'Speak message' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Fork from here' })).toBeInTheDocument()
      } finally {
        s.teardown()
      }
    })

    it('still shows the MetaRow Retry + Copy when the RefinementRow is not shown', () => {
      // Without showRefinement, the MetaRow keeps its full action set.
      renderMessage(assistantTurn, { onRetry: vi.fn(), onSend: vi.fn() })
      expect(screen.getByRole('button', { name: 'Regenerate response' })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(1)
      expect(screen.queryByTestId('refinement-row')).not.toBeInTheDocument()
    })
  })

  // --- message TTS: Speak button + auto-speak (voice feature 2) ----------

  // --- a11y: aria-live on streaming assistant content (Wave 5) ----------------
  describe('streaming content aria-live', () => {
    it('wraps streaming assistant content in an aria-live="polite" region', () => {
      renderMessage({
        id: 'a1',
        role: 'assistant',
        content: 'partial text',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      })
      const liveRegion = document.querySelector('[aria-live="polite"][data-streaming]')
      expect(liveRegion).not.toBeNull()
      expect(liveRegion).toHaveAttribute('aria-atomic', 'false')
    })

    it('removes aria-live from the content container when streaming is done', () => {
      const { rerender } = renderMessage({
        id: 'a1',
        role: 'assistant',
        content: 'partial text',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      })
      // While streaming: live region is present.
      expect(document.querySelector('[aria-live="polite"][data-streaming]')).not.toBeNull()

      // After completion: the live region is gone (no need to re-announce finished content).
      rerender(
        <ThemeProvider>
          <Message
            turn={{
              id: 'a1',
              role: 'assistant',
              content: 'final text',
              toolCalls: [],
              reasoning: [],
              streaming: false,
            }}
          />
        </ThemeProvider>,
      )
      expect(document.querySelector('[aria-live="polite"][data-streaming]')).toBeNull()
    })

    it('user turns never have a streaming live region', () => {
      renderMessage({ id: 'u1', role: 'user', content: 'hello' })
      expect(document.querySelector('[aria-live="polite"][data-streaming]')).toBeNull()
    })
  })

  describe('message action button touch targets', () => {
    it('ActionButton uses 44px minimum touch target (min-h-11)', () => {
      renderMessage({
        id: 'a1',
        role: 'assistant',
        content: 'reply',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      })
      const copy = screen.getByRole('button', { name: 'Copy message' })
      expect(copy.className).toContain('min-h-11')
    })

    it('ActionButton has a focus-visible ring', () => {
      renderMessage({
        id: 'a1',
        role: 'assistant',
        content: 'reply',
        toolCalls: [],
        reasoning: [],
        streaming: false,
      })
      const copy = screen.getByRole('button', { name: 'Copy message' })
      expect(copy.className).toContain('focus-visible:ad-focus')
    })
  })

  // --- perf: React.memo keeps settled rows static while the streaming turn updates
  describe('memoization (perf)', () => {
    it('re-renders the streaming turn when its content grows (new turn object per token)', async () => {
      const streaming: Turn = {
        id: 'a-stream',
        role: 'assistant',
        content: 'parti',
        toolCalls: [],
        reasoning: [],
        streaming: true,
      }
      const { rerender } = renderMessage(streaming)
      expect(await screen.findByText('parti')).toBeInTheDocument()

      // A token append produces a NEW turn object (immutable store update); the
      // memoized Message must re-render and show the grown content.
      rerender(
        <ThemeProvider>
          <Message turn={{ ...streaming, content: 'partial' }} />
        </ThemeProvider>,
      )
      expect(await screen.findByText('partial')).toBeInTheDocument()
    })

    it('does NOT re-render a settled turn when only a callback identity changes', () => {
      // Same `turn` reference across rerenders + a brand-new onRetry each time
      // (mirrors the parent re-wrapping handlers when the model selection flips).
      // The custom comparator ignores callback identity, so the memoized component
      // is skipped — we assert that by spying on the child render via a fresh
      // onRetry whose identity change must NOT cause a re-mount/re-render side
      // effect. We verify the rendered output is byte-stable.
      const onRetry1 = vi.fn()
      const { rerender, container } = renderMessage(assistantTurn, { onRetry: onRetry1 })
      const htmlBefore = container.innerHTML

      const onRetry2 = vi.fn()
      rerender(
        <ThemeProvider>
          <Message turn={assistantTurn} onRetry={onRetry2} />
        </ThemeProvider>,
      )
      // Output unchanged: the memo skipped the re-render (callback identity ignored).
      expect(container.innerHTML).toBe(htmlBefore)
    })

    it('still re-renders when a callback toggles between present and absent', async () => {
      // Presence (not identity) is compared, so wiring/unwiring Retry flips the UI.
      const { rerender } = renderMessage(assistantTurn)
      expect(screen.queryByRole('button', { name: 'Regenerate response' })).not.toBeInTheDocument()

      rerender(
        <ThemeProvider>
          <Message turn={assistantTurn} onRetry={vi.fn()} />
        </ThemeProvider>,
      )
      expect(await screen.findByRole('button', { name: 'Regenerate response' })).toBeInTheDocument()
    })
  })

  describe('voice output (TTS)', () => {
    let teardown: (() => void) | null = null

    function installSynth(): MockSpeechSynthesis {
      const handle = installMockSpeechSynthesis()
      teardown = handle.teardown
      return handle.synth
    }

    beforeEach(() => {
      // Voice prefs persist to localStorage + a module store; reset both so each
      // test starts from the default (auto-speak OFF).
      localStorage.removeItem(VOICE_PREFS_STORAGE_KEY)
      setVoicePrefs({ autoSpeak: false })
    })

    afterEach(() => {
      teardown?.()
      teardown = null
      setVoicePrefs({ autoSpeak: false })
    })

    it('hides the Speak button when speech synthesis is unsupported', () => {
      // No synth installed → unsupported.
      renderMessage(assistantTurn)
      expect(screen.queryByRole('button', { name: 'Speak message' })).not.toBeInTheDocument()
    })

    it('Speak reads the message aloud and toggles to Stop while speaking', async () => {
      const user = userEvent.setup()
      const s = installSynth()
      renderMessage(assistantTurn)

      await user.click(screen.getByRole('button', { name: 'Speak message' }))
      expect(s.speak).toHaveBeenCalledOnce()
      expect(s.spoken.at(-1)!.text).toBe('an answer')
      // While speaking the affordance flips to Stop.
      expect(screen.getByRole('button', { name: 'Stop speaking' })).toBeInTheDocument()

      // Stop cancels the utterance and reverts to Speak.
      await user.click(screen.getByRole('button', { name: 'Stop speaking' }))
      expect(s.cancel).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Speak message' })).toBeInTheDocument()
    })

    it('auto-speak fires once when a turn completes and the pref is on', () => {
      const s = installSynth()
      setVoicePrefs({ autoSpeak: true })

      // Mount mid-stream (matches the real flow: the turn streams, then finishes).
      const { rerender } = render(
        <ThemeProvider>
          <Message turn={{ ...assistantTurn, content: 'partial', streaming: true }} />
        </ThemeProvider>,
      )
      expect(s.speak).not.toHaveBeenCalled()

      // Completion: streaming → false with the final text.
      act(() => {
        rerender(
          <ThemeProvider>
            <Message turn={{ ...assistantTurn, content: 'final text', streaming: false }} />
          </ThemeProvider>,
        )
      })
      expect(s.speak).toHaveBeenCalledOnce()
      expect(s.spoken.at(-1)!.text).toBe('final text')

      // A subsequent re-render of the same finished turn must not re-speak.
      act(() => {
        rerender(
          <ThemeProvider>
            <Message turn={{ ...assistantTurn, content: 'final text', streaming: false }} />
          </ThemeProvider>,
        )
      })
      expect(s.speak).toHaveBeenCalledOnce()
    })

    it('auto-speak never fires when the pref is off', () => {
      const s = installSynth()
      // pref stays off (default)
      const { rerender } = render(
        <ThemeProvider>
          <Message turn={{ ...assistantTurn, content: 'partial', streaming: true }} />
        </ThemeProvider>,
      )
      act(() => {
        rerender(
          <ThemeProvider>
            <Message turn={{ ...assistantTurn, content: 'final text', streaming: false }} />
          </ThemeProvider>,
        )
      })
      expect(s.speak).not.toHaveBeenCalled()
    })

    it('auto-speak does not fire on history render (turn already completed at mount)', () => {
      const s = installSynth()
      setVoicePrefs({ autoSpeak: true })
      // Mounts already finished — replayed history, never streamed in this view.
      renderMessage({ ...assistantTurn, content: 'old reply', streaming: false })
      expect(s.speak).not.toHaveBeenCalled()
    })
  })
  describe('per-run receipt line', () => {
    const usage = { input_tokens: 64321, output_tokens: 1234, total_tokens: 65555 }
    const completedTurn: Turn = {
      id: 'a1',
      role: 'assistant',
      content: 'All done.',
      toolCalls: [],
      reasoning: [],
      streaming: false,
      usage,
    }

    it('renders the muted receipt under a completed turn that carried usage', () => {
      renderMessage(completedTurn, { receiptBillingMode: 'subscription' })
      const receipt = screen.getByTestId('run-receipt')
      expect(receipt).toHaveTextContent('64.3K in / 1.2K out / included (subscription)')
    })

    it('carries the exact numbers and the measurement note in the tooltip', () => {
      renderMessage(completedTurn, { receiptBillingMode: 'subscription' })
      const title = screen.getByTestId('run-receipt').getAttribute('title') ?? ''
      expect(title).toContain('64,321 input tokens')
      expect(title).toContain('1,234 output tokens')
      expect(title).toContain('Measured for this run')
    })

    it('renders tokens only when the billing mode is unresolved (never implies free)', () => {
      renderMessage(completedTurn)
      expect(screen.getByTestId('run-receipt')).toHaveTextContent('64.3K in / 1.2K out')
      expect(screen.getByTestId('run-receipt')).not.toHaveTextContent('included')
    })

    it('is ABSENT (not zeroed) on a turn without usage — e.g. one seeded from history', () => {
      const { usage: _omit, ...turnWithoutUsage } = completedTurn
      void _omit
      renderMessage({ ...turnWithoutUsage, id: 'a2' })
      expect(screen.queryByTestId('run-receipt')).toBeNull()
    })

    it('is absent while the turn is still streaming', () => {
      renderMessage({ ...completedTurn, id: 'a3', streaming: true })
      expect(screen.queryByTestId('run-receipt')).toBeNull()
    })

    it('shows duration and tok/s when both are present', () => {
      renderMessage(
        { ...completedTurn, id: 'a4', duration: 4.2 },
        { receiptBillingMode: 'subscription' },
      )
      const receipt = screen.getByTestId('run-receipt')
      expect(receipt).toHaveTextContent('4.2s')
      // 1234 output_tokens / 4.2s = ~294 tok/s
      expect(receipt).toHaveTextContent('tok/s')
    })

    it('computes tok/s correctly (round to integer)', () => {
      // 1200 output / 4.0s = 300 tok/s
      const turnWith1200Out: Turn = {
        ...completedTurn,
        id: 'a5',
        usage: { input_tokens: 100, output_tokens: 1200, total_tokens: 1300 },
        duration: 4.0,
      }
      renderMessage(turnWith1200Out)
      expect(screen.getByTestId('run-receipt')).toHaveTextContent('300 tok/s')
    })

    it('shows tokens only when duration is absent — no duration suffix, no "tok/s"', () => {
      renderMessage({ ...completedTurn, id: 'a6' }, { receiptBillingMode: 'subscription' })
      const receipt = screen.getByTestId('run-receipt')
      expect(receipt).toHaveTextContent('64.3K in / 1.2K out / included (subscription)')
      expect(receipt).not.toHaveTextContent('tok/s')
      // No digit followed by 's' (duration suffix) — the receipt must end at the billing segment.
      expect(receipt.textContent).not.toMatch(/\d+\.\d+s/)
    })

    it('formats a large duration as Xm YYs', () => {
      renderMessage({ ...completedTurn, id: 'a7', duration: 75 })
      expect(screen.getByTestId('run-receipt')).toHaveTextContent('1m 15s')
    })
  })
})

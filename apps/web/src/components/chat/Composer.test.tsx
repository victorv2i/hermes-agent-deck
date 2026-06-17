import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import { toast } from '@/lib/toast'
import { setSendKeyPref } from '@/features/chat-input/sendKeyPref'
import {
  installMockSpeechRecognition,
  MockSpeechRecognition,
} from '@/features/voice/mockSpeechRecognition'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// Every test starts from a clean, deterministic client state: the default
// (enter-sends) key preference and an empty draft store. Voice + the files API
// are feature-detected/mocked per test, so the base composer has no mic and no
// mention picker unless a test installs them.
beforeEach(() => {
  setSendKeyPref('enter')
  localStorage.clear()
  vi.mocked(toast.info).mockClear()
  vi.mocked(toast.error).mockClear()
})

describe('Composer', () => {
  it('sends the trimmed text and clears on click', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Composer onSend={onSend} onStop={() => {}} />)
    const input = screen.getByLabelText('Message your agent')
    await user.type(input, '  hello agent  ')
    await user.click(screen.getByTestId('composer-send'))
    expect(onSend).toHaveBeenCalledWith('hello agent')
    expect(input).toHaveValue('')
  })

  it('sends on plain Enter in the default (enter-sends) mode', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Composer onSend={onSend} onStop={() => {}} />)
    const input = screen.getByLabelText('Message your agent')
    await user.type(input, 'via enter')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('via enter')
  })

  it('inserts a newline (does not send) on Shift+Enter', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Composer onSend={onSend} onStop={() => {}} />)
    const input = screen.getByLabelText('Message your agent')
    await user.type(input, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('line one\nline two')
  })

  it('does not send empty/whitespace input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Composer onSend={onSend} onStop={() => {}} />)
    await user.type(screen.getByLabelText('Message your agent'), '   ')
    expect(screen.getByTestId('composer-send')).toBeDisabled()
    await user.click(screen.getByTestId('composer-send'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows Send when idle and Stop (abort) while running', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const { rerender } = render(<Composer onSend={() => {}} onStop={onStop} running={false} />)
    expect(screen.getByTestId('composer-send')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-stop')).not.toBeInTheDocument()

    rerender(<Composer onSend={() => {}} onStop={onStop} running />)
    // The Send→Stop control MORPHS (AnimatePresence mode="wait"), so the new Stop
    // button mounts once the Send glyph finishes exiting — assert async.
    const stop = await screen.findByTestId('composer-stop')
    expect(stop).toBeInTheDocument()
    expect(screen.queryByTestId('composer-send')).not.toBeInTheDocument()
    await user.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('gives the Send/Stop buttons press tactility (active:scale, B2)', async () => {
    const { rerender } = render(<Composer onSend={() => {}} onStop={() => {}} running={false} />)
    // The raw primary control scales down on press and transitions transform.
    const send = screen.getByTestId('composer-send')
    expect(send).toHaveClass('active:scale-95')
    expect(send.className).toContain('transition-[transform,background-color]')

    rerender(<Composer onSend={() => {}} onStop={() => {}} running />)
    // Stop mounts after the Send glyph exits the morph (mode="wait").
    const stop = await screen.findByTestId('composer-stop')
    expect(stop).toHaveClass('active:scale-95')
    expect(stop.className).toContain('transition-[transform,background-color]')
  })

  it('shows the model picker (when models are supplied) and an honest context ring', () => {
    render(
      <Composer
        onSend={() => {}}
        onStop={() => {}}
        models={[
          {
            id: 'hermes-4',
            qualifiedId: 'nous/hermes-4',
            label: 'Hermes 4',
            provider: 'nous',
            active: true,
            usable: true,
            source: 'config',
          },
        ]}
        model="nous/hermes-4"
        onModelChange={() => {}}
        contextTokens={12_500}
      />,
    )
    expect(screen.getByTestId('model-picker-trigger')).toHaveTextContent('Hermes 4')
    // No model limit is known, so the ring is honest/approximate (no false %).
    const ring = screen.getByTestId('context-ring')
    expect(ring).toHaveAttribute('data-approx', 'true')
    expect(ring.getAttribute('aria-label')).toMatch(/12\.5K tokens.*approx/i)
  })

  it('hides the model picker when no models are available', () => {
    render(<Composer onSend={() => {}} onStop={() => {}} />)
    expect(screen.queryByTestId('model-picker-trigger')).not.toBeInTheDocument()
  })

  it('shows the ⌘↵ send hint while typing a normal message', async () => {
    const user = userEvent.setup()
    render(<Composer onSend={() => {}} onStop={() => {}} />)
    const hint = screen.getByTestId('composer-hint')
    await user.type(screen.getByLabelText('Message your agent'), 'hello')
    expect(hint).toHaveTextContent('to send')
  })

  it('shows ↵ to send in enter mode (the default)', async () => {
    setSendKeyPref('enter')
    const user = userEvent.setup()
    render(<Composer onSend={() => {}} onStop={() => {}} />)
    const hint = screen.getByTestId('composer-hint')
    await user.type(screen.getByLabelText('Message your agent'), 'hello')
    expect(hint).toHaveTextContent('↵')
    expect(hint).not.toHaveTextContent('⌘↵')
  })

  it('shows ⌘↵ to send in mod-enter mode', async () => {
    setSendKeyPref('mod-enter')
    const user = userEvent.setup()
    render(<Composer onSend={() => {}} onStop={() => {}} />)
    const hint = screen.getByTestId('composer-hint')
    await user.type(screen.getByLabelText('Message your agent'), 'hello')
    expect(hint).toHaveTextContent('⌘↵')
  })

  describe('slash-command menu', () => {
    const MODELS = [
      {
        id: 'hermes-4',
        qualifiedId: 'nous/hermes-4',
        label: 'Hermes 4',
        provider: 'nous',
        active: true,
        usable: true,
        source: 'config',
      },
    ]

    function renderWithSlash(over?: Partial<React.ComponentProps<typeof Composer>>) {
      const props = {
        onSend: vi.fn(),
        onStop: vi.fn(),
        onNewChat: vi.fn(),
        onClearChat: vi.fn(),
        onToggleTheme: vi.fn(),
        models: MODELS,
        model: 'hermes-4',
        onModelChange: vi.fn(),
        ...over,
      }
      render(<Composer {...props} />)
      return props
    }

    it('opens a keyboard-navigable command menu when the input is "/"', async () => {
      const user = userEvent.setup()
      renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/')
      const menu = screen.getByRole('listbox', { name: /commands/i })
      expect(menu).toBeInTheDocument()
      // Every wired UI command shows.
      const modelOption = screen.getByRole('option', { name: /Switch model/i })
      expect(modelOption).toBeInTheDocument()
      expect(modelOption.className).toContain('min-h-11')
      expect(screen.getByRole('option', { name: /New chat/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Clear chat/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Toggle theme/i })).toBeInTheDocument()
      // The retired Run-panel/Activity command is gone (drawer removed).
      expect(screen.queryByRole('option', { name: /Run panel/i })).not.toBeInTheDocument()
    })

    it('shows a one-line hint for each command and a section label', async () => {
      const user = userEvent.setup()
      renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/')
      // A section label orients the user that these are local UI commands.
      expect(screen.getByText('Commands', { selector: 'p' })).toBeInTheDocument()
      // Each command explains what running it does, so a newcomer isn't guessing.
      expect(screen.getByText('Choose the model for the next run')).toBeInTheDocument()
      expect(screen.getByText('Start a fresh conversation')).toBeInTheDocument()
      expect(screen.getByText('Clear the current conversation')).toBeInTheDocument()
      expect(screen.getByText('Switch between dark and light')).toBeInTheDocument()
    })

    it('filters the menu as the query is typed', async () => {
      const user = userEvent.setup()
      renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/cl')
      expect(screen.getByRole('option', { name: /Clear chat/i })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /New chat/i })).not.toBeInTheDocument()
    })

    it('hides a command whose handler is not wired (no inert rows)', async () => {
      const user = userEvent.setup()
      // No onClearChat → the /clear row must not render.
      render(
        <Composer
          onSend={vi.fn()}
          onStop={vi.fn()}
          onNewChat={vi.fn()}
          models={MODELS}
          model="hermes-4"
          onModelChange={vi.fn()}
        />,
      )
      await user.type(screen.getByLabelText('Message your agent'), '/')
      expect(screen.queryByRole('option', { name: /Clear chat/i })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: /New chat/i })).toBeInTheDocument()
    })

    it('runs a command on Enter (and does NOT send it as a message)', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '/new')
      await user.keyboard('{Enter}')
      expect(props.onNewChat).toHaveBeenCalledTimes(1)
      expect(props.onSend).not.toHaveBeenCalled()
      // The command text is consumed, not left in the field.
      expect(input).toHaveValue('')
    })

    it('runs the highlighted command after ArrowDown navigation', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '/')
      // First row (/model) is highlighted; move down to /new and run it.
      await user.keyboard('{ArrowDown}{Enter}')
      expect(props.onNewChat).toHaveBeenCalledTimes(1)
      expect(props.onSend).not.toHaveBeenCalled()
    })

    it('runs a command on click', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/')
      await user.click(screen.getByRole('option', { name: /Clear chat/i }))
      expect(props.onClearChat).toHaveBeenCalledTimes(1)
    })

    it('toggles theme via /theme', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/theme')
      await user.keyboard('{Enter}')
      expect(props.onToggleTheme).toHaveBeenCalledTimes(1)
    })

    it('opens the model picker via /model', async () => {
      const user = userEvent.setup()
      renderWithSlash()
      await user.type(screen.getByLabelText('Message your agent'), '/model')
      await user.keyboard('{Enter}')
      // The ModelPicker's listbox opens.
      expect(await screen.findByRole('listbox', { name: /select a model/i })).toBeInTheDocument()
    })

    it('Esc closes the menu and keeps the text so it can be sent verbatim', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '/model')
      expect(screen.getByRole('listbox', { name: /commands/i })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox', { name: /commands/i })).not.toBeInTheDocument()
      // Text preserved; a following Enter now SENDS it verbatim.
      expect(input).toHaveValue('/model')
      await user.keyboard('{Enter}')
      expect(props.onSend).toHaveBeenCalledWith('/model')
    })

    it('does NOT open the menu for a real message that merely starts with "/"', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash()
      const input = screen.getByLabelText('Message your agent')
      // A space means prose — no menu, and Enter sends verbatim.
      await user.type(input, '/note to self')
      expect(screen.queryByRole('listbox', { name: /commands/i })).not.toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(props.onSend).toHaveBeenCalledWith('/note to self')
    })

    it('offers no command menu on a bare composer (only onSend wired) — every command needs its handler', async () => {
      const user = userEvent.setup()
      // Every slash command is a local UI action gated on its own host handler,
      // so a plain composer with none wired shows no menu (no inert rows).
      render(<Composer onSend={vi.fn()} onStop={vi.fn()} />)
      await user.type(screen.getByLabelText('Message your agent'), '/')
      expect(screen.queryByRole('listbox', { name: /commands/i })).not.toBeInTheDocument()
    })

    // --- /usage (a local UI action that opens the Usage view) ---
    it('opens the Usage view via /usage (a local UI action, no agent run)', async () => {
      const user = userEvent.setup()
      const props = renderWithSlash({ onOpenUsage: vi.fn() })
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '/usage')
      await user.keyboard('{Enter}')
      expect(props.onOpenUsage).toHaveBeenCalledTimes(1)
      // It does NOT send a message to the agent; /usage is purely navigation.
      expect(props.onSend).not.toHaveBeenCalled()
      expect(input).toHaveValue('')
    })

    it('hides /usage when no onOpenUsage handler is wired (no inert row)', async () => {
      const user = userEvent.setup()
      renderWithSlash() // renderWithSlash does not wire onOpenUsage
      await user.type(screen.getByLabelText('Message your agent'), '/usage')
      expect(screen.queryByRole('option', { name: /View usage/i })).not.toBeInTheDocument()
    })
  })

  // --- (c) Send-key preference (useSendKeyPref + shouldSend) -------------------
  describe('send-key preference', () => {
    it('in mod-enter mode, plain Enter inserts a newline (does not send)', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      setSendKeyPref('mod-enter')
      render(<Composer onSend={onSend} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'line one{Enter}line two')
      expect(onSend).not.toHaveBeenCalled()
      expect(input).toHaveValue('line one\nline two')
    })

    it('in mod-enter mode, Cmd/Ctrl+Enter sends', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      setSendKeyPref('mod-enter')
      render(<Composer onSend={onSend} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'send me')
      await user.keyboard('{Control>}{Enter}{/Control}')
      expect(onSend).toHaveBeenCalledWith('send me')
    })

    it('in enter mode, Cmd/Ctrl+Enter does NOT send (it is the newline key)', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      // Default mode (enter sends) → the modifier combo is the newline, so the
      // composer must NOT submit on it (the browser handles the newline insert;
      // we only assert we don't hijack the combo into a send).
      render(<Composer onSend={onSend} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'draft text')
      await user.keyboard('{Control>}{Enter}{/Control}')
      expect(onSend).not.toHaveBeenCalled()
    })
  })

  // --- (b) Draft persistence (useDraft) ---------------------------------------
  describe('draft persistence', () => {
    it('restores the saved draft for the active session on mount', () => {
      localStorage.setItem('agent-deck:draft:s1', 'half-written thought')
      render(<Composer onSend={vi.fn()} onStop={() => {}} sessionKey="s1" />)
      expect(screen.getByLabelText('Message your agent')).toHaveValue('half-written thought')
    })

    it('persists the composer text under the session key as it changes', async () => {
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} sessionKey="s2" />)
      await user.type(screen.getByLabelText('Message your agent'), 'remember me')
      // The store debounces writes (~400ms); poll until storage reflects it.
      await waitFor(() => expect(localStorage.getItem('agent-deck:draft:s2')).toBe('remember me'))
    })

    it('clears the persisted draft on send', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      localStorage.setItem('agent-deck:draft:s3', 'queued')
      render(<Composer onSend={onSend} onStop={() => {}} sessionKey="s3" />)
      const input = screen.getByLabelText('Message your agent')
      expect(input).toHaveValue('queued')
      await user.click(screen.getByTestId('composer-send'))
      expect(onSend).toHaveBeenCalledWith('queued')
      expect(input).toHaveValue('')
      expect(localStorage.getItem('agent-deck:draft:s3')).toBeNull()
    })

    it('keeps separate drafts per session (new-chat uses the :new sentinel)', () => {
      localStorage.setItem('agent-deck:draft:new', 'unsent new chat')
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      expect(screen.getByLabelText('Message your agent')).toHaveValue('unsent new chat')
    })
  })

  // --- (a) Voice DICTATION (useDictation → useSpeechRecognition) ---------------
  describe('voice input', () => {
    let teardown: (() => void) | null = null
    afterEach(() => {
      teardown?.()
      teardown = null
      vi.unstubAllGlobals()
    })

    /** jsdom defaults to a non-secure context; pin it for these tests. */
    function setSecureContext(secure: boolean) {
      vi.stubGlobal('isSecureContext', secure)
    }

    it('shows the mic DISABLED with an honest tooltip where Web Speech is unsupported', () => {
      // No SpeechRecognition installed → mic is present but disabled (honest),
      // not hidden, so the user understands voice input is unavailable.
      setSecureContext(true)
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      expect(mic).toBeDisabled()
      expect(mic).toHaveAttribute('aria-label', expect.stringMatching(/voice input/i))
      expect(mic).toHaveAttribute('title', expect.stringMatching(/voice input/i))
    })

    it('shows the mic DISABLED with a secure-context tooltip on an insecure origin', () => {
      // The API exists but the page is http:// → voice input can't run; the mic
      // is disabled and the tooltip explains it needs a secure connection.
      teardown = installMockSpeechRecognition()
      setSecureContext(false)
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      expect(mic).toBeDisabled()
      expect(mic).toHaveAttribute('title', expect.stringMatching(/secure|https/i))
    })

    it('does not start recording when the mic is disabled (unavailable)', async () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(false)
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      await user.click(mic)
      // Disabled control: no session begins, no pressed/listening state.
      expect(MockSpeechRecognition.last).toBeUndefined()
      expect(mic).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows the mic ENABLED when the API is supported on a secure origin', () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      expect(mic).toBeEnabled()
      expect(mic).toHaveAttribute('aria-label', 'Start voice input')
    })

    it('starts recording on tap and reflects a pressed/listening state', async () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      expect(mic).toHaveAttribute('aria-pressed', 'false')
      await user.click(mic)
      expect(mic).toHaveAttribute('aria-pressed', 'true')
      expect(mic).toHaveAttribute('aria-label', 'Stop voice input')
      // A polite live region announces the recording state for AT.
      expect(screen.getByRole('status')).toHaveTextContent('Listening')
    })

    it('appends the recognized transcript into the composer', async () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'note:')
      await user.click(screen.getByTestId('composer-mic'))
      // Drive a final recognition result.
      act(() => MockSpeechRecognition.last!.emitResult([{ transcript: 'buy milk', isFinal: true }]))
      // The transcript is appended after the existing text (space-joined).
      expect(input).toHaveValue('note: buy milk')
    })

    it('stops recording on a second tap', async () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      await user.click(mic)
      expect(mic).toHaveAttribute('aria-pressed', 'true')
      await user.click(mic)
      expect(mic).toHaveAttribute('aria-pressed', 'false')
    })
  })

  // --- (b) Voice DICTATION via SERVER-STT (Web Speech absent) ------------------
  // When the browser has no Web Speech API (Firefox, many Chromium-on-Linux),
  // dictation falls back to recording the mic + posting to the BFF. The mic stays
  // ENABLED (the bug this fixes: it used to be a dead, "unsupported" button).
  describe('voice input (server-STT fallback)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    /** A controllable MediaRecorder so the test can finish a recording on stop. */
    class MockMediaRecorder {
      static isTypeSupported = () => true
      static last: MockMediaRecorder | undefined
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start = () => {
        this.state = 'recording'
      }
      stop = () => {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['bytes'], { type: this.mimeType }) })
        this.onstop?.()
      }
      constructor() {
        MockMediaRecorder.last = this
      }
    }

    function installServerCapture() {
      vi.stubGlobal('isSecureContext', true)
      const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
      vi.stubGlobal('navigator', {
        ...navigator,
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      })
      vi.stubGlobal('MediaRecorder', MockMediaRecorder)
      // NO Web Speech API installed → useDictation chooses the server path.
    }

    it('shows the mic ENABLED (server mode) when Web Speech is absent but capture exists', () => {
      installServerCapture()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      expect(mic).toBeEnabled()
      expect(mic).toHaveAttribute('aria-label', 'Start voice input')
    })

    it('records, transcribes via the BFF, and inserts the transcript', async () => {
      const voiceApi = await import('@/features/voice/api')
      vi.spyOn(voiceApi, 'transcribeAudio').mockResolvedValue({ transcript: 'hands free text' })
      installServerCapture()
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      const mic = screen.getByTestId('composer-mic')

      await user.click(mic) // grant + start capture
      await waitFor(() => expect(mic).toHaveAttribute('aria-pressed', 'true'))
      await user.click(mic) // stop → recorder.onstop → transcribe → insert
      await waitFor(() => expect(input).toHaveValue('hands free text'))
    })

    it('toasts honestly when transcription fails', async () => {
      vi.spyOn(await import('@/features/voice/api'), 'transcribeAudio').mockRejectedValue(
        new Error('502'),
      )
      installServerCapture()
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const mic = screen.getByTestId('composer-mic')
      await user.click(mic)
      await waitFor(() => expect(mic).toHaveAttribute('aria-pressed', 'true'))
      await user.click(mic)
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/transcribe/i)),
      )
    })
  })

  // --- (d) @-mention workspace files (useFileMentions → /api/agent-deck/files) -
  describe('@-mention workspace files', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    /** Stub the files BFF so the mention picker has files to offer. */
    function stubFilesFetch(entries: Array<{ name: string; path: string; type: 'file' | 'dir' }>) {
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('/files/roots')) {
          return json({
            roots: [
              {
                id: 'workspace',
                label: 'Workspace',
                description: '',
                path: '/ws',
                readOnly: false,
              },
            ],
          })
        }
        if (/\/files\?/.test(url)) {
          return json({
            root: 'workspace',
            path: '',
            entries: entries.map((e) => ({
              ...e,
              modified: null,
              size: null,
              suppressed: false,
              reason: null,
              preview: e.type === 'file' ? 'full' : null,
            })),
            truncated: false,
          })
        }
        return new Response('not found', { status: 404 })
      })
      vi.stubGlobal('fetch', fetchMock)
    }

    it('opens the file picker when @ is typed and inserts the chosen path', async () => {
      stubFilesFetch([
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        { name: 'app.tsx', path: 'src/app.tsx', type: 'file' },
      ])
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'see @')
      const picker = await screen.findByRole('listbox', { name: /mention a workspace file/i })
      // The fetched files appear as options.
      const option = await within(picker).findByRole('option', { name: /index\.ts/i })
      await user.click(option)
      // The workspace-relative path is inserted in place of the @-token.
      await waitFor(() => expect(input).toHaveValue('see @src/index.ts '))
      // Picker closes after selection.
      expect(
        screen.queryByRole('listbox', { name: /mention a workspace file/i }),
      ).not.toBeInTheDocument()
    })

    it('does not open the picker for an @ that is not a fresh token (e.g. email)', async () => {
      stubFilesFetch([{ name: 'index.ts', path: 'src/index.ts', type: 'file' }])
      const user = userEvent.setup()
      render(<Composer onSend={vi.fn()} onStop={() => {}} />)
      await user.type(screen.getByLabelText('Message your agent'), 'me@host')
      expect(
        screen.queryByRole('listbox', { name: /mention a workspace file/i }),
      ).not.toBeInTheDocument()
    })

    it('Esc closes the mention picker without sending', async () => {
      stubFilesFetch([{ name: 'index.ts', path: 'src/index.ts', type: 'file' }])
      const onSend = vi.fn()
      const user = userEvent.setup()
      render(<Composer onSend={onSend} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '@')
      await screen.findByRole('listbox', { name: /mention a workspace file/i })
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('listbox', { name: /mention a workspace file/i }),
      ).not.toBeInTheDocument()
      expect(onSend).not.toHaveBeenCalled()
    })

    it('selecting via keyboard (ArrowDown, Enter) inserts the path, not a send', async () => {
      stubFilesFetch([
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        { name: 'app.tsx', path: 'src/app.tsx', type: 'file' },
      ])
      const onSend = vi.fn()
      const user = userEvent.setup()
      render(<Composer onSend={onSend} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, '@')
      await screen.findByRole('listbox', { name: /mention a workspace file/i })
      // Wait for the fetched results to populate the listbox.
      await screen.findByRole('option', { name: /index\.ts/i })
      await user.keyboard('{ArrowDown}{Enter}')
      // Second file chosen; Enter committed the mention rather than sending.
      await waitFor(() => expect(input).toHaveValue('@src/app.tsx '))
      expect(onSend).not.toHaveBeenCalled()
    })
  })

  describe('image attachments', () => {
    function pngFile(name = 'shot.png'): File {
      return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' })
    }

    it('shows an enabled attach button when the model has vision', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages />)
      const attach = screen.getByTestId('composer-attach')
      expect(attach).toBeEnabled()
      expect(attach).toHaveAccessibleName('Attach image')
    })

    it('disables attach with an honest tooltip when the model lacks vision', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages={false} />)
      const attach = screen.getByTestId('composer-attach')
      expect(attach).toBeDisabled()
      expect(attach).toHaveAccessibleName(/can’t see images/i)
    })

    it('disables attach with an honest tooltip while a run is in flight (no queue for images)', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages running />)
      const attach = screen.getByTestId('composer-attach')
      expect(attach).toBeDisabled()
      expect(attach).toHaveAccessibleName(/can’t be queued/i)
    })

    it('does NOT fire an overlapping run for a mid-run image submit; holds the message honestly', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      // Attach while idle, then a run starts (e.g. a flushed queued message).
      const { rerender } = render(<Composer onSend={onSend} onStop={() => {}} canAttachImages />)
      const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement
      await user.upload(fileInput, pngFile('mid-run.png'))
      await screen.findByTestId('composer-attachment-pill')
      rerender(<Composer onSend={onSend} onStop={() => {}} canAttachImages running />)

      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'with image')
      await user.keyboard('{Enter}')

      // Not sent (no overlapping run), not queued (images can't queue) — the
      // text + attachment stay put, and an honest toast says why.
      expect(onSend).not.toHaveBeenCalled()
      expect(screen.queryByTestId('composer-queued-pill')).not.toBeInTheDocument()
      expect(input).toHaveValue('with image')
      expect(screen.getByTestId('composer-attachment-pill')).toBeInTheDocument()
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/can’t be queued/i))
    })

    it('ignores a pasted image while running (honest toast, not a silent attach)', async () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages running />)
      const input = screen.getByLabelText('Message your agent')
      const file = pngFile('pasted.png')
      await act(async () => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }], files: [] },
        })
        input.dispatchEvent(event)
      })
      expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument()
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/can’t be queued/i))
    })

    it('adds a removable preview pill when an image is picked', async () => {
      const user = userEvent.setup()
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages />)
      const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement
      await user.upload(fileInput, pngFile('cat.png'))
      const pill = await screen.findByTestId('composer-attachment-pill')
      expect(within(pill).getByText('cat.png')).toBeInTheDocument()
      // Remove it again.
      await user.click(screen.getByRole('button', { name: 'Remove cat.png' }))
      await waitFor(() =>
        expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument(),
      )
    })

    it('can send an image-only turn and carries the attachment to onSend', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<Composer onSend={onSend} onStop={() => {}} canAttachImages />)
      const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement
      await user.upload(fileInput, pngFile('graph.png'))
      await screen.findByTestId('composer-attachment-pill')
      // Send is enabled with no prose because an image is attached.
      const send = screen.getByTestId('composer-send')
      expect(send).toBeEnabled()
      await user.click(send)
      expect(onSend).toHaveBeenCalledTimes(1)
      const [text, attachments] = onSend.mock.calls[0]!
      expect(text).toBe('')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({ kind: 'image', name: 'graph.png', mime: 'image/png' })
      expect(attachments[0].data_url).toMatch(/^data:image\/png/)
      // No client-only id leaks onto the wire payload.
      expect('id' in attachments[0]).toBe(false)
      // The composer clears its attachments after a successful send.
      await waitFor(() =>
        expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument(),
      )
    })

    it('carries text + image together on send', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<Composer onSend={onSend} onStop={() => {}} canAttachImages />)
      await user.type(screen.getByLabelText('Message your agent'), 'what is this?')
      await user.upload(screen.getByTestId('composer-file-input') as HTMLInputElement, pngFile())
      await screen.findByTestId('composer-attachment-pill')
      await user.click(screen.getByTestId('composer-send'))
      expect(onSend).toHaveBeenCalledWith('what is this?', [
        expect.objectContaining({ kind: 'image', name: 'shot.png' }),
      ])
    })

    it('attaches a pasted screenshot via ⌘V', async () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages />)
      const input = screen.getByLabelText('Message your agent')
      // Fire a paste carrying an image item (jsdom has no real clipboard, so the
      // event's clipboardData is a structural stand-in the handler reads).
      const file = pngFile('pasted.png')
      act(() => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: {
            items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
            files: [file],
          },
        })
        input.dispatchEvent(event)
      })
      const pill = await screen.findByTestId('composer-attachment-pill')
      expect(within(pill).getByText('pasted.png')).toBeInTheDocument()
    })

    it('does not intercept a text paste (no image on the clipboard)', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages />)
      const input = screen.getByLabelText('Message your agent')
      act(() => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: { items: [{ kind: 'string', type: 'text/plain' }], files: [] },
        })
        input.dispatchEvent(event)
        // preventDefault must NOT have been called — the textarea handles the text.
        expect(event.defaultPrevented).toBe(false)
      })
      expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument()
    })

    it('uses ONE unified no-vision message for both the attach tooltip and the paste toast', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages={false} />)
      const attachMessage = screen.getByTestId('composer-attach').getAttribute('aria-label')
      const input = screen.getByLabelText('Message your agent')
      const file = pngFile('nope.png')
      act(() => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: {
            items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
            files: [file],
          },
        })
        input.dispatchEvent(event)
      })
      // The tooltip and the toast describe the SAME situation the SAME way.
      expect(attachMessage).toMatch(/can’t see images/i)
      expect(toast.info).toHaveBeenCalledWith(attachMessage)
    })

    it('ignores a pasted image when the model lacks vision (honest no-op + toast)', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages={false} />)
      const input = screen.getByLabelText('Message your agent')
      const file = pngFile('nope.png')
      act(() => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: {
            items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
            files: [file],
          },
        })
        input.dispatchEvent(event)
      })
      expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument()
      // Honest feedback: tell the user why the image was ignored.
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/can’t see images/i))
    })

    it('does not toast on a text paste when the model lacks vision', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages={false} />)
      const input = screen.getByLabelText('Message your agent')
      act(() => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: { items: [{ kind: 'string', type: 'text/plain' }], files: [] },
        })
        input.dispatchEvent(event)
      })
      // No image was on the clipboard, so nothing was ignored — stay silent.
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('ignores a dropped image when the model lacks vision (honest no-op + toast)', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} canAttachImages={false} />)
      const surface = screen.getByTestId('composer')
      const file = pngFile('dropped.png')
      act(() => {
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', {
          value: {
            types: ['Files'],
            items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
            files: [file],
          },
        })
        surface.dispatchEvent(event)
      })
      expect(screen.queryByTestId('composer-attachment-pill')).not.toBeInTheDocument()
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/can’t see images/i))
    })
  })

  // Send-while-busy (C2): typing + submitting while a run is in flight QUEUES the
  // message (FIFO pills) instead of blocking; the queue flushes the head when the
  // run completes; cancel removes a queued message before it sends.
  describe('send-while-busy queue (C2)', () => {
    it('enqueues a submit while running (does not send) and clears the input', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<Composer onSend={onSend} onStop={() => {}} running />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'while busy')
      await user.keyboard('{Enter}')
      // Queued, not sent — and the input is cleared, ready for the next message.
      expect(onSend).not.toHaveBeenCalled()
      expect(input).toHaveValue('')
      const pill = screen.getByTestId('composer-queued-pill')
      expect(within(pill).getByText('while busy')).toBeInTheDocument()
    })

    it('flushes the queued message (FIFO) when the run completes', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const { rerender } = render(<Composer onSend={onSend} onStop={() => {}} running />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'first')
      await user.keyboard('{Enter}')
      await user.type(input, 'second')
      await user.keyboard('{Enter}')
      expect(screen.getAllByTestId('composer-queued-pill')).toHaveLength(2)

      // Run completes → exactly the head flushes; the rest stays queued.
      rerender(<Composer onSend={onSend} onStop={() => {}} running={false} />)
      expect(onSend).toHaveBeenCalledTimes(1)
      expect(onSend).toHaveBeenCalledWith('first')
      const pill = screen.getByTestId('composer-queued-pill')
      expect(within(pill).getByText('second')).toBeInTheDocument()
    })

    it('cancel removes a queued message before it can send', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const { rerender } = render(<Composer onSend={onSend} onStop={() => {}} running />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'doomed')
      await user.keyboard('{Enter}')
      await user.click(screen.getByTestId('composer-queued-cancel'))
      expect(screen.queryByTestId('composer-queued-pill')).not.toBeInTheDocument()

      // The run completes with nothing queued → nothing is sent.
      rerender(<Composer onSend={onSend} onStop={() => {}} running={false} />)
      expect(onSend).not.toHaveBeenCalled()
    })

    it('sends immediately (does not queue) when idle', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<Composer onSend={onSend} onStop={() => {}} running={false} />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'right now')
      await user.keyboard('{Enter}')
      expect(onSend).toHaveBeenCalledWith('right now')
      expect(screen.queryByTestId('composer-queued-pill')).not.toBeInTheDocument()
    })

    it('HOLDS the queued message when the run fails (canFlushQueue false), then flushes on recovery', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const { rerender } = render(
        <Composer onSend={onSend} onStop={() => {}} running canFlushQueue />,
      )
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'pending')
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('composer-queued-pill')).toBeInTheDocument()

      // The run ENDS IN ERROR: running → false but canFlushQueue → false (the host
      // gates on the last run's error). The message must NOT fire into the failure.
      rerender(<Composer onSend={onSend} onStop={() => {}} running={false} canFlushQueue={false} />)
      expect(onSend).not.toHaveBeenCalled()
      expect(
        within(screen.getByTestId('composer-queued-pill')).getByText('pending'),
      ).toBeInTheDocument()

      // The channel recovers (a clean run cleared the error / reconnect): the held
      // message flushes once canFlushQueue rises.
      rerender(<Composer onSend={onSend} onStop={() => {}} running={false} canFlushQueue />)
      expect(onSend).toHaveBeenCalledTimes(1)
      expect(onSend).toHaveBeenCalledWith('pending')
      expect(screen.queryByTestId('composer-queued-pill')).not.toBeInTheDocument()
    })
  })

  // --- Cmd/Ctrl+M opens ModelPicker (Wave 5 a11y) ----------------------------
  describe('Cmd/Ctrl+M model picker shortcut', () => {
    const MODELS = [
      {
        id: 'hermes-4',
        qualifiedId: 'nous/hermes-4',
        label: 'Hermes 4',
        provider: 'nous',
        active: true,
        usable: true,
        source: 'config' as const,
      },
      {
        id: 'gpt-5.4',
        qualifiedId: 'openai/gpt-5.4',
        label: 'GPT-5.4',
        provider: 'openai',
        active: false,
        usable: true,
        source: 'config' as const,
      },
    ]

    it('Cmd+M opens the model picker when the composer has focus', async () => {
      const user = userEvent.setup()
      render(
        <Composer
          onSend={() => {}}
          onStop={() => {}}
          models={MODELS}
          model="nous/hermes-4"
          onModelChange={() => {}}
        />,
      )
      const input = screen.getByLabelText('Message your agent')
      await user.click(input)
      await user.keyboard('{Meta>}m{/Meta}')
      expect(await screen.findByRole('listbox', { name: /select a model/i })).toBeInTheDocument()
    })

    it('Ctrl+M opens the model picker (Windows/Linux)', async () => {
      const user = userEvent.setup()
      render(
        <Composer
          onSend={() => {}}
          onStop={() => {}}
          models={MODELS}
          model="nous/hermes-4"
          onModelChange={() => {}}
        />,
      )
      const input = screen.getByLabelText('Message your agent')
      await user.click(input)
      await user.keyboard('{Control>}m{/Control}')
      expect(await screen.findByRole('listbox', { name: /select a model/i })).toBeInTheDocument()
    })

    it('Cmd+M does nothing when no models are available', async () => {
      const user = userEvent.setup()
      render(<Composer onSend={() => {}} onStop={() => {}} />)
      const input = screen.getByLabelText('Message your agent')
      await user.click(input)
      await user.keyboard('{Meta>}m{/Meta}')
      // No model picker trigger → no listbox
      expect(screen.queryByRole('listbox', { name: /select a model/i })).not.toBeInTheDocument()
    })

    it('Escape closes the model picker', async () => {
      const user = userEvent.setup()
      render(
        <Composer
          onSend={() => {}}
          onStop={() => {}}
          models={MODELS}
          model="nous/hermes-4"
          onModelChange={() => {}}
        />,
      )
      const input = screen.getByLabelText('Message your agent')
      await user.click(input)
      await user.keyboard('{Meta>}m{/Meta}')
      // Picker opens.
      expect(await screen.findByRole('listbox', { name: /select a model/i })).toBeInTheDocument()
      // Escape closes it (Radix Popover: Escape is handled by default).
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox', { name: /select a model/i })).not.toBeInTheDocument()
    })
  })

  describe('icon-button focus rings + tap targets (a11y)', () => {
    it('the SEND action keeps the amber action ring (canonical ad-focus)', () => {
      render(<Composer onSend={() => {}} onStop={() => {}} running={false} />)
      const send = screen.getByTestId('composer-send')
      expect(send.className).toContain('focus-visible:ad-focus')
    })

    it('the non-action icon buttons (attach, mic) ring on the neutral border, not amber', () => {
      installMockSpeechRecognition()
      render(
        <Composer
          onSend={() => {}}
          onStop={() => {}}
          running={false}
          canAttachImages
          models={[]}
        />,
      )
      for (const testid of ['composer-attach', 'composer-mic']) {
        const btn = screen.getByTestId(testid)
        expect(btn.className).toContain('focus-visible:ring-[var(--border-strong)]')
        // The action accent (sky-blue) is reserved for Send — not these.
        expect(btn.className).not.toContain('ring-ring')
      }
    })

    it('the STOP icon button uses the canonical ad-focus ring, not amber', async () => {
      render(<Composer onSend={() => {}} onStop={() => {}} running />)
      const stop = await screen.findByTestId('composer-stop')
      // Canonical focus ring (ad-focus replaces the old bespoke ring-[var(--border-strong)])
      expect(stop.className).toContain('focus-visible:ad-focus')
      expect(stop.className).not.toContain('ring-ring')
    })

    it('the composer footer controls use 44px mobile hit targets', async () => {
      installMockSpeechRecognition()
      const { rerender } = render(
        <Composer
          onSend={() => {}}
          onStop={() => {}}
          running={false}
          canAttachImages
          models={[]}
        />,
      )
      for (const testid of ['composer-attach', 'composer-mic', 'composer-send']) {
        const btn = screen.getByTestId(testid)
        expect(btn.className).toContain('size-11')
      }

      rerender(<Composer onSend={() => {}} onStop={() => {}} running models={[]} />)
      const stop = await screen.findByTestId('composer-stop')
      expect(stop.className).toContain('size-11')
    })

    it('the remove-attachment and remove-queued buttons use 44px mobile hit targets', async () => {
      const user = userEvent.setup()
      // Remove-queued: enqueue a message while running.
      const { rerender } = render(<Composer onSend={() => {}} onStop={() => {}} running />)
      const input = screen.getByLabelText('Message your agent')
      await user.type(input, 'queued one')
      await user.keyboard('{Enter}')
      const cancel = screen.getByTestId('composer-queued-cancel')
      expect(cancel.className).toContain('size-11')

      rerender(<Composer onSend={() => {}} onStop={() => {}} canAttachImages />)
      await user.upload(
        screen.getByTestId('composer-file-input') as HTMLInputElement,
        new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', { type: 'image/png' }),
      )
      const remove = await screen.findByTestId('composer-attachment-remove')
      expect(remove.className).toContain('size-11')
    })
  })
})

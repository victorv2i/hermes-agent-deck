import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { VoiceState, AudioNote } from '@agent-deck/protocol'
import { VoicePage, type VoicePageProps } from './VoicePage'

/**
 * VoicePage tests — pin the honest, catalog-driven render: provider dropdowns,
 * the DEPENDENT voice-name field, the masked key (local → "No key needed"), the
 * voice.* toggles, and the NO-browser-mic honesty boundary. Presentational, so
 * each callback is asserted without a query client.
 */

function ttsEntry(
  id: VoiceState['ttsProviders'][number]['id'],
  over: Partial<VoiceState['ttsProviders'][number]> = {},
): VoiceState['ttsProviders'][number] {
  return {
    id,
    label: id,
    local: false,
    voiceField: 'voice_id',
    voiceLabel: 'Voice ID',
    voice: '',
    key: {
      envVar: `${id.toUpperCase()}_API_KEY`,
      label: `${id} key`,
      isSet: false,
      redactedValue: null,
    },
    note: null,
    ...over,
  }
}

const STATE: VoiceState = {
  ttsProvider: 'elevenlabs',
  sttProvider: 'local',
  sttEnabled: true,
  ttsProviders: [
    ttsEntry('edge', {
      local: true,
      voiceField: 'voice',
      voiceLabel: 'Voice',
      voice: 'en-US-AriaNeural',
      key: { envVar: null, label: '', isSet: false, redactedValue: null },
      note: 'Free Edge voices.',
    }),
    ttsEntry('elevenlabs', {
      voice: 'Adam',
      key: {
        envVar: 'ELEVENLABS_API_KEY',
        label: 'ElevenLabs key',
        isSet: true,
        redactedValue: 'el-…abcd',
      },
    }),
    ttsEntry('openai', { voiceField: 'voice', voiceLabel: 'Voice' }),
    ttsEntry('xai'),
    ttsEntry('mistral'),
    ttsEntry('minimax'),
    ttsEntry('neutts', {
      local: true,
      voiceField: 'model',
      voiceLabel: 'Model',
      key: { envVar: null, label: '', isSet: false, redactedValue: null },
      note: null,
    }),
    ttsEntry('piper', {
      local: true,
      voiceField: 'voice',
      voiceLabel: 'Voice',
      key: { envVar: null, label: '', isSet: false, redactedValue: null },
    }),
  ],
  sttProviders: [
    {
      id: 'local',
      label: 'Local (faster-whisper)',
      local: true,
      key: { envVar: null, label: '', isSet: false, redactedValue: null },
      note: null,
    },
    {
      id: 'openai',
      label: 'OpenAI (Whisper)',
      local: false,
      key: {
        envVar: 'VOICE_TOOLS_OPENAI_KEY',
        label: 'OpenAI voice key',
        isSet: false,
        redactedValue: null,
      },
      note: null,
    },
    {
      id: 'mistral',
      label: 'Mistral',
      local: false,
      key: { envVar: 'MISTRAL_API_KEY', label: 'Mistral key', isSet: false, redactedValue: null },
      note: null,
    },
    {
      id: 'groq',
      label: 'Groq',
      local: false,
      key: { envVar: 'GROQ_API_KEY', label: 'Groq key', isSet: false, redactedValue: null },
      note: null,
    },
  ],
  toggles: { autoTts: false, beepEnabled: true },
}

const NOTES: AudioNote[] = [
  { name: 'audio_a.ogg', ext: 'ogg', size: 37962, modifiedAt: '2026-05-12T19:23:00.000Z' },
  { name: 'audio_b.mp3', ext: 'mp3', size: 12844, modifiedAt: '2026-05-05T12:45:00.000Z' },
]

function setup(over: Partial<VoicePageProps> = {}) {
  const props: VoicePageProps = {
    state: STATE,
    notes: NOTES,
    notesTruncated: false,
    onUpdate: vi.fn(),
    onSetKey: vi.fn(),
    saving: false,
    ...over,
  }
  render(<VoicePage {...props} />)
  return props
}

describe('VoicePage — TTS', () => {
  it('renders the TTS provider dropdown with the active provider selected', () => {
    setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    const select = within(region).getByRole('combobox', { name: /provider/i }) as HTMLSelectElement
    expect(select.value).toBe('elevenlabs')
  })

  it('changing the TTS provider calls onUpdate with the new provider', () => {
    const { onUpdate } = setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    const select = within(region).getByRole('combobox', { name: /provider/i })
    fireEvent.change(select, { target: { value: 'openai' } })
    expect(onUpdate).toHaveBeenCalledWith({ ttsProvider: 'openai' })
  })

  it('shows the DEPENDENT voice field for the active provider (label from catalog)', () => {
    setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    // elevenlabs uses "Voice ID"
    const voiceInput = within(region).getByLabelText('Voice ID') as HTMLInputElement
    expect(voiceInput.value).toBe('Adam')
  })

  it('saving the voice calls onUpdate with the provider sub-field', () => {
    const { onUpdate } = setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    const voiceInput = within(region).getByLabelText('Voice ID')
    fireEvent.change(voiceInput, { target: { value: 'Rachel' } })
    fireEvent.click(within(region).getByRole('button', { name: /^save$/i }))
    expect(onUpdate).toHaveBeenCalledWith({ ttsVoice: { provider: 'elevenlabs', voice: 'Rachel' } })
  })

  it('shows the redacted key preview for a stored key (shape-only, never plaintext)', () => {
    setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    const preview = within(region).getByText('el-…abcd')
    expect(preview).toBeInTheDocument()
    expect(preview.className).toContain('truncate')
  })

  it('saving a key calls onSetKey with only the env var + value', () => {
    const { onSetKey } = setup()
    const region = screen.getByRole('region', { name: /text to speech/i })
    const keyInput = within(region).getByLabelText('ElevenLabs key')
    fireEvent.change(keyInput, { target: { value: 'sk-NEW' } })
    fireEvent.click(within(region).getByRole('button', { name: /save key/i }))
    expect(onSetKey).toHaveBeenCalledWith({ envVar: 'ELEVENLABS_API_KEY', value: 'sk-NEW' })
  })
})

describe('VoicePage — Edge voice picker (non-technical friendly)', () => {
  it('shows a dropdown picker (not a raw text field) for the Edge TTS provider', () => {
    setup({ state: { ...STATE, ttsProvider: 'edge' } })
    const region = screen.getByRole('region', { name: /text to speech/i })
    // The Edge provider has a curated voice list — should be a combobox, not a
    // raw text input, so a non-technical user can pick a voice by name.
    const picker = within(region).getByRole('combobox', { name: /voice/i })
    expect(picker).toBeInTheDocument()
  })

  it('the Edge picker shows friendly voice names (not raw IDs)', () => {
    setup({ state: { ...STATE, ttsProvider: 'edge' } })
    const region = screen.getByRole('region', { name: /text to speech/i })
    const picker = within(region).getByRole('combobox', { name: /voice/i }) as HTMLSelectElement
    // The options should contain readable names — not just "en-US-AriaNeural"
    const optionTexts = Array.from(picker.options).map((o) => o.text)
    expect(optionTexts.some((t) => /aria|jenny|guy|emma|ryan|sonia/i.test(t))).toBe(true)
  })

  it('changing the Edge voice picker calls onUpdate with the selected voice ID', () => {
    const { onUpdate } = setup({ state: { ...STATE, ttsProvider: 'edge' } })
    const region = screen.getByRole('region', { name: /text to speech/i })
    const picker = within(region).getByRole('combobox', { name: /voice/i })
    // Pick a different voice from the dropdown
    const newVoice = (picker as HTMLSelectElement).options[1]?.value ?? 'en-US-JennyNeural'
    fireEvent.change(picker, { target: { value: newVoice } })
    expect(onUpdate).toHaveBeenCalledWith({ ttsVoice: { provider: 'edge', voice: newVoice } })
  })
})

describe('VoicePage — local provider honesty', () => {
  it('a LOCAL TTS provider shows ONE "No key needed" line instead of a key field', () => {
    setup({ state: { ...STATE, ttsProvider: 'neutts' } })
    const region = screen.getByRole('region', { name: /text to speech/i })
    // The key field renders the one honest "No key needed" line — stated once,
    // not repeated by a catalog note — and NO password field for a local provider.
    expect(within(region).getAllByText(/no key needed/i)).toHaveLength(1)
    expect(within(region).queryByLabelText(/api key/i)).not.toBeInTheDocument()
  })

  it('the Edge card states the no-key fact exactly once', () => {
    setup({ state: { ...STATE, ttsProvider: 'edge' } })
    const region = screen.getByRole('region', { name: /text to speech/i })
    expect(within(region).getAllByText(/no key needed/i)).toHaveLength(1)
    expect(within(region).queryByText(/no account needed/i)).toBeNull()
  })
})

describe('VoicePage — STT (no browser mic)', () => {
  it('renders the STT provider dropdown + the no-browser-mic honesty note', () => {
    setup()
    const region = screen.getByRole('region', { name: /speech to text/i })
    expect(within(region).getByRole('combobox', { name: /provider/i })).toBeInTheDocument()
    expect(
      within(region).getByText(/doesn.t record from your browser.s microphone/i),
    ).toBeInTheDocument()
  })

  it('does NOT render a record/microphone capture button', () => {
    setup()
    const region = screen.getByRole('region', { name: /speech to text/i })
    expect(
      within(region).queryByRole('button', { name: /record|start recording|microphone/i }),
    ).toBeNull()
  })

  it('the enable toggle is an accessible switch reflecting stt.enabled', () => {
    const { onUpdate } = setup()
    const region = screen.getByRole('region', { name: /speech to text/i })
    const sw = within(region).getByRole('switch', { name: /transcription enabled/i })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(onUpdate).toHaveBeenCalledWith({ sttEnabled: false })
  })
})

describe('VoicePage — write-in-flight honesty', () => {
  it('disables the voice + key fields while a config write is in flight', () => {
    setup({ saving: true })
    const region = screen.getByRole('region', { name: /text to speech/i })
    // The dependent voice field and its Save are inert while saving.
    expect(within(region).getByLabelText('Voice ID')).toBeDisabled()
    // The key field input is inert too (no conflicting second write).
    expect(within(region).getByLabelText('ElevenLabs key')).toBeDisabled()
  })
})

describe('VoicePage — toggles', () => {
  it('the auto_tts + beep toggles reflect config and call onUpdate', () => {
    const { onUpdate } = setup()
    const region = screen.getByRole('region', { name: /voice behavior/i })
    const autoTts = within(region).getByRole('switch', { name: /speak replies automatically/i })
    const beep = within(region).getByRole('switch', { name: /beep on record/i })
    expect(autoTts).toHaveAttribute('aria-checked', 'false')
    expect(beep).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(autoTts)
    expect(onUpdate).toHaveBeenCalledWith({ autoTts: true })
  })
})

describe('VoicePage — recent voice notes', () => {
  it('lists the real cached notes with format + size', () => {
    setup()
    const region = screen.getByRole('region', { name: /recent voice notes/i })
    expect(within(region).getByText('audio_a.ogg')).toBeInTheDocument()
    expect(within(region).getByText('audio_b.mp3')).toBeInTheDocument()
    // a Play button per note (real artifacts only)
    expect(within(region).getAllByRole('button', { name: /play/i })).toHaveLength(2)
  })

  it('shows a calm empty state when there are no cached notes', () => {
    setup({ notes: [], notesTruncated: false })
    const region = screen.getByRole('region', { name: /recent voice notes/i })
    expect(within(region).getByText(/no voice notes yet/i)).toBeInTheDocument()
  })
})

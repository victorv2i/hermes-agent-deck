import { vi } from 'vitest'

/**
 * Controllable stand-ins for the Web Speech synthesis API (jsdom ships none).
 * `MockSpeechSynthesisUtterance` captures the configured text/voice/rate;
 * `MockSpeechSynthesis` records speak/cancel and lets a test drive utterance
 * lifecycle events. Install both with `installMockSpeechSynthesis`.
 */
export class MockSpeechSynthesisUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: ((event: Event) => void) | null = null
  onend: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

export class MockSpeechSynthesis {
  speaking = false
  voices: SpeechSynthesisVoice[]
  spoken: MockSpeechSynthesisUtterance[] = []
  private listeners = new Map<string, Set<() => void>>()

  speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
    this.spoken.push(utterance)
    this.speaking = true
    // Mirror the platform: onstart fires when the utterance begins.
    utterance.onstart?.(new Event('start'))
  })

  cancel = vi.fn(() => {
    this.speaking = false
  })

  getVoices = vi.fn(() => this.voices)

  addEventListener = vi.fn((type: string, cb: () => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
  })

  removeEventListener = vi.fn((type: string, cb: () => void) => {
    this.listeners.get(type)?.delete(cb)
  })

  constructor(voices: SpeechSynthesisVoice[] = []) {
    this.voices = voices
  }

  /** Fire the latest utterance's onend (engine finished speaking). */
  finishSpeaking(): void {
    this.speaking = false
    this.spoken.at(-1)?.onend?.(new Event('end'))
  }

  /** Fire the latest utterance's onerror. */
  errorSpeaking(): void {
    this.speaking = false
    this.spoken.at(-1)?.onerror?.(new Event('error'))
  }

  /** Replace the voice list and notify `voiceschanged` subscribers. */
  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices
    for (const cb of this.listeners.get('voiceschanged') ?? []) cb()
  }
}

type SynthWindow = Window & {
  speechSynthesis?: unknown
  SpeechSynthesisUtterance?: unknown
}

/**
 * Install the synthesis mock on `window`. Returns a teardown that removes both
 * `speechSynthesis` and `SpeechSynthesisUtterance`, and the live mock so a test
 * can drive lifecycle events.
 */
export function installMockSpeechSynthesis(voices: SpeechSynthesisVoice[] = []): {
  synth: MockSpeechSynthesis
  teardown: () => void
} {
  const synth = new MockSpeechSynthesis(voices)
  const win = window as SynthWindow
  const prevSynth = win.speechSynthesis
  const prevUtterance = win.SpeechSynthesisUtterance
  Object.defineProperty(win, 'speechSynthesis', {
    value: synth,
    configurable: true,
    writable: true,
  })
  win.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance
  return {
    synth,
    teardown: () => {
      Object.defineProperty(win, 'speechSynthesis', {
        value: prevSynth,
        configurable: true,
        writable: true,
      })
      win.SpeechSynthesisUtterance = prevUtterance
    },
  }
}

/** Build a minimal voice object for tests. */
export function makeVoice(voiceURI: string, name = voiceURI): SpeechSynthesisVoice {
  return {
    voiceURI,
    name,
    lang: 'en-US',
    localService: true,
    default: false,
  }
}

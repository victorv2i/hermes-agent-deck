import { vi } from 'vitest'
import type { SpeechRecognitionConstructor, SpeechRecognitionLike } from './speechRecognitionTypes'

/**
 * A controllable in-memory stand-in for the Web Speech `SpeechRecognition`
 * controller, for hermetic tests (jsdom ships none). It records start/stop/abort
 * calls and lets a test drive `onstart`/`onresult`/`onerror`/`onend` and assert
 * the hook's reaction. Mirrors the shape the hook depends on only.
 */
export class MockSpeechRecognition extends EventTarget implements SpeechRecognitionLike {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1

  onresult: ((event: SpeechRecognitionEvent) => void) | null = null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
  onend: ((event: Event) => void) | null = null
  onstart: ((event: Event) => void) | null = null

  start = vi.fn(() => {
    MockSpeechRecognition.instances.push(this)
    this.started = true
    this.onstart?.(new Event('start'))
  })
  stop = vi.fn(() => {
    if (this.started) this.onend?.(new Event('end'))
    this.started = false
  })
  abort = vi.fn(() => {
    this.started = false
    this.onend?.(new Event('end'))
  })

  started = false

  /** Every constructed instance, in order (latest is the live one). */
  static instances: MockSpeechRecognition[] = []
  static get last(): MockSpeechRecognition | undefined {
    return MockSpeechRecognition.instances.at(-1)
  }
  static reset(): void {
    MockSpeechRecognition.instances = []
  }

  /** Emit a recognition result with the given final/interim word chunks. */
  emitResult(chunks: Array<{ transcript: string; isFinal: boolean }>): void {
    const results = chunks.map((c) => {
      const alt = { transcript: c.transcript, confidence: 1 }
      const result = {
        0: alt,
        length: 1,
        isFinal: c.isFinal,
        item: () => alt,
      }
      return result
    })
    const resultList: Record<string | number, unknown> = {
      length: results.length,
      item: (i: number) => results[i],
    }
    results.forEach((r, i) => {
      resultList[i] = r
    })
    const event = {
      resultIndex: 0,
      results: resultList,
    } as unknown as SpeechRecognitionEvent
    this.onresult?.(event)
  }

  /** Emit a recognition error (e.g. `not-allowed` for permission denial). */
  emitError(error: string): void {
    this.onerror?.({ error } as unknown as SpeechRecognitionErrorEvent)
  }

  /** Emit the native end (when the engine stops on its own). */
  emitEnd(): void {
    this.started = false
    this.onend?.(new Event('end'))
  }
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

/**
 * Install the mock as `window.SpeechRecognition` (and the webkit alias when
 * `webkit` is true). Returns a teardown that removes both. Resets the instance
 * registry on install.
 */
export function installMockSpeechRecognition({ webkit = false } = {}): () => void {
  MockSpeechRecognition.reset()
  const win = window as SpeechWindow
  const ctor = MockSpeechRecognition as unknown as SpeechRecognitionConstructor
  if (webkit) win.webkitSpeechRecognition = ctor
  else win.SpeechRecognition = ctor
  return () => {
    delete win.SpeechRecognition
    delete win.webkitSpeechRecognition
    MockSpeechRecognition.reset()
  }
}

/**
 * Minimal Web Speech SpeechRecognition type surface.
 *
 * TypeScript's lib.dom.d.ts ships the event/result interfaces
 * (SpeechRecognitionEvent, SpeechRecognitionErrorEvent,
 * SpeechRecognitionResult/List, SpeechRecognitionAlternative) but NOT the
 * SpeechRecognition controller interface, its constructor, or the
 * webkit-prefixed alias -- the API is still vendor-prefixed and not in the
 * standard lib. We declare just the slice we use here so the hook stays fully
 * typed without pulling in a dependency, and so feature-detection reads cleanly
 * off window.
 */

export interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
  onstart: ((event: Event) => void) | null
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

/** A window that *may* expose the (possibly vendor-prefixed) constructor. */
export interface SpeechRecognitionWindow {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

/**
 * Resolve the platform's SpeechRecognition constructor (standard first, then the
 * `webkit` prefix), or `null` where the API is absent. Pure + SSR-safe so it can
 * back feature-detection.
 */
export function getSpeechRecognitionCtor(
  win: (Window & SpeechRecognitionWindow) | undefined = typeof window === 'undefined'
    ? undefined
    : (window as Window & SpeechRecognitionWindow),
): SpeechRecognitionConstructor | null {
  if (!win) return null
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

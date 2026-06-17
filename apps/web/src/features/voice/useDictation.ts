/**
 * useDictation - the composer's voice-DICTATION hook.
 *
 * Picks the best available dictation path and exposes ONE honest control surface
 * to the composer. Dictation fills the message text from the user's speech (the
 * user still reviews + sends) - it is NOT "the agent hears your mic".
 *
 * Two paths, so voice input works on EVERY browser:
 *  1. NATIVE (fast path): the Web Speech `SpeechRecognition` API, when present
 *     (Chrome / Edge / Safari). Streams interim text as the user speaks; nothing
 *     leaves the device.
 *  2. SERVER (durable path): where the Web Speech API is absent (Firefox, many
 *     Chromium-on-Linux builds) we record the mic with `getUserMedia` +
 *     `MediaRecorder` and POST the clip to the BFF for transcription
 *     ({@link useServerDictation}). The transcript arrives once, after the user
 *     stops, and fills the composer the same way.
 *
 * HONEST gate. Both paths require a SECURE CONTEXT (https / localhost) - browsers
 * refuse `getUserMedia`/SpeechRecognition on insecure origins. When dictation
 * can't run, the mic is shown DISABLED with a truthful `unavailableReason`:
 *  - insecure origin → "Voice needs the https address" (+ a hint to use it),
 *  - secure but no capture API at all → "Voice input isn't supported here".
 * The button is never fake-enabled, and `start()` is a no-op when unavailable.
 */
import { useCallback, useState } from 'react'
import { useSpeechRecognition, type UseSpeechRecognitionOptions } from './useSpeechRecognition'
import { useServerDictation } from './useServerDictation'

/** Which dictation path is active, or null when none can run. */
export type DictationMode = 'native' | 'server' | null

export interface UseDictation {
  /** Whether the platform exposes the native Web Speech API (the fast path). */
  supported: boolean
  /** True while actively listening / capturing the mic. */
  recording: boolean
  /** True while a server-STT recording is uploading + being transcribed (server
   * mode only; always false in native mode, which streams live). Lets the composer
   * show an honest "Transcribing…" cue instead of looking hung. */
  transcribing: boolean
  /** The last error code/message, or null. */
  error: string | null
  /** Begin dictation (no-op when unavailable or already active). */
  start: () => void
  /** Stop dictation; the final transcript is still delivered. */
  stop: () => void
  /** Abort immediately, discarding any pending result. */
  abort: () => void
  /**
   * True only when dictation can actually run (a usable capture path on a secure
   * origin). The composer enables the mic on this.
   */
  available: boolean
  /** The active path, or null when unavailable (exposed for tests + the composer). */
  mode: DictationMode
  /**
   * A short, user-facing explanation of WHY dictation is unavailable (for the
   * disabled mic's tooltip), or null when `available`. Never throws.
   */
  unavailableReason: string | null
  /**
   * An optional second line of help for the unavailable state (e.g. how to reach
   * the https address), or null. Kept separate from `unavailableReason` so the
   * tooltip's primary line stays short.
   */
  unavailableHint: string | null
}

/** Whether the current page is a secure context (https / localhost). */
function readIsSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true
}

export function useDictation(options: UseSpeechRecognitionOptions = {}): UseDictation {
  const { onResult, onEnd, onError, lang, silenceMs } = options

  // The secure-context check is read once on mount (stable for the page's
  // lifetime, like each hook's own feature-detection latch).
  const [secureContext] = useState(readIsSecureContext)

  // Both hooks are constructed unconditionally (hooks rule); only the chosen path
  // is ever driven via start()/stop() below, and the unused one stays idle.
  const native = useSpeechRecognition({ onResult, onEnd, onError, lang, silenceMs })
  const server = useServerDictation({
    // The server hook delivers a single final chunk; forward it through the same
    // onResult the composer already wires for the native stream.
    onResult: ({ transcript }) =>
      onResult?.({ transcript, finalTranscript: transcript, interimTranscript: '', isFinal: true }),
    onEnd,
    onError,
  })

  // Choose the path: native fast-path when present, else server-STT, else none.
  // Both require a secure context.
  const mode: DictationMode = !secureContext
    ? null
    : native.supported
      ? 'native'
      : server.supported
        ? 'server'
        : null

  const available = mode !== null

  const unavailableReason = available
    ? null
    : !secureContext
      ? 'Voice needs the https address'
      : 'Voice input isn’t supported in this browser'
  const unavailableHint = available
    ? null
    : !secureContext
      ? 'Open the deck over its https (Tailscale) address to use the mic.'
      : 'Try Chrome, Edge, or Safari for voice input.'

  // Route the control surface to the active path. Honest gate: never begin a
  // session when dictation can't run.
  const start = useCallback(() => {
    if (mode === 'native') native.start()
    else if (mode === 'server') server.start()
  }, [mode, native, server])

  const stop = useCallback(() => {
    if (mode === 'native') native.stop()
    else if (mode === 'server') server.stop()
  }, [mode, native, server])

  const abort = useCallback(() => {
    if (mode === 'native') native.abort()
    else if (mode === 'server') server.abort()
  }, [mode, native, server])

  const recording = mode === 'server' ? server.recording : native.recording
  const transcribing = mode === 'server' ? server.transcribing : false
  const error = mode === 'server' ? server.error : native.error

  return {
    supported: native.supported,
    recording,
    transcribing,
    error,
    start,
    stop,
    abort,
    available,
    mode,
    unavailableReason,
    unavailableHint,
  }
}

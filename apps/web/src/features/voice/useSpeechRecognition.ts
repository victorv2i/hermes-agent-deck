/**
 * useSpeechRecognition — a thin, feature-detected React wrapper over the Web
 * Speech `SpeechRecognition` API (spec, voice feature 1: voice input).
 *
 * Design goals (so the composer integration is trivial):
 *  - FEATURE-DETECTED: where the API is absent (Firefox, non-secure context) the
 *    hook returns `supported: false` and inert no-op controls, so the caller can
 *    simply hide the mic button rather than render disabled clutter.
 *  - STREAMS interim + final transcript via an `onResult` callback so the
 *    composer can live-append as the user speaks. The callback always receives
 *    the *full* current transcript (final text + the in-flight interim tail)
 *    plus an `isFinal` flag, so callers don't have to stitch fragments.
 *  - AUTO-STOPs after a short silence window (default ~2s) — handled here with a
 *    timer reset on each result, since the platform's own `onend` timing varies.
 *  - Handles permission denial / errors gracefully: surfaces an `error` string,
 *    clears `recording`, never throws into render.
 *
 * Browser-only API; nothing leaves the device (LOCAL-ONLY).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from './speechRecognitionTypes'

/** The default silence window after which recognition auto-stops. */
export const DEFAULT_SILENCE_MS = 2000

export interface SpeechRecognitionResultPayload {
  /** The full transcript so far: settled final text + the live interim tail. */
  transcript: string
  /** Just the portion that has been finalised this session. */
  finalTranscript: string
  /** The not-yet-final tail (empty once everything settles). */
  interimTranscript: string
  /** True when the latest chunk was a final result. */
  isFinal: boolean
}

export interface UseSpeechRecognitionOptions {
  /** BCP-47 language tag for recognition (defaults to the document language). */
  lang?: string
  /** Auto-stop after this many ms of silence. Set 0 to disable. */
  silenceMs?: number
  /** Called on every interim/final result with the running transcript. */
  onResult?: (payload: SpeechRecognitionResultPayload) => void
  /** Called once recognition has fully ended (any reason). */
  onEnd?: () => void
  /** Called on a recognition error (e.g. `not-allowed` permission denial). */
  onError?: (error: string) => void
}

export interface UseSpeechRecognition {
  /** Whether the platform exposes SpeechRecognition at all. */
  supported: boolean
  /** True while actively listening. */
  recording: boolean
  /** The last error code/message, or null. Cleared on a fresh start(). */
  error: string | null
  /** Begin listening (no-op when unsupported or already recording). */
  start: () => void
  /** Stop listening; pending results are still delivered, then `onEnd`. */
  stop: () => void
  /** Abort immediately, discarding any pending result. */
  abort: () => void
}

function resolveDefaultLang(): string {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang
  }
  return 'en-US'
}

/** Stitch the result list into final + interim transcripts. */
function readTranscripts(event: SpeechRecognitionEvent): {
  finalTranscript: string
  interimTranscript: string
} {
  let finalTranscript = ''
  let interimTranscript = ''
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i]
    if (!result) continue
    const alt = result[0]
    if (!alt) continue
    if (result.isFinal) finalTranscript += alt.transcript
    else interimTranscript += alt.transcript
  }
  return { finalTranscript, interimTranscript }
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognition {
  const { lang, silenceMs = DEFAULT_SILENCE_MS, onResult, onEnd, onError } = options

  // Feature-detect once; the constructor (and thus `supported`) is stable for
  // the page's lifetime.
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the latest callbacks/lang in refs so the recognition handlers always
  // call through to current props without re-creating the recognition object.
  // Synced in an effect, not during render (refs must not be mutated while
  // rendering).
  const onResultRef = useRef(onResult)
  const onEndRef = useRef(onEnd)
  const onErrorRef = useRef(onError)
  const silenceMsRef = useRef(silenceMs)
  useEffect(() => {
    onResultRef.current = onResult
    onEndRef.current = onEnd
    onErrorRef.current = onError
    silenceMsRef.current = silenceMs
  })

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearSilenceTimer()
    recognitionRef.current?.stop()
  }, [clearSilenceTimer])

  const abort = useCallback(() => {
    clearSilenceTimer()
    recognitionRef.current?.abort()
  }, [clearSilenceTimer])

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    if (silenceMsRef.current > 0) {
      silenceTimerRef.current = setTimeout(() => {
        recognitionRef.current?.stop()
      }, silenceMsRef.current)
    }
  }, [clearSilenceTimer])

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.lang = lang ?? resolveDefaultLang()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setError(null)
      setRecording(true)
      armSilenceTimer()
    }
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const { finalTranscript, interimTranscript } = readTranscripts(event)
      armSilenceTimer()
      onResultRef.current?.({
        transcript: (finalTranscript + interimTranscript).trimStart(),
        finalTranscript,
        interimTranscript,
        isFinal: interimTranscript === '',
      })
    }
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      clearSilenceTimer()
      setError(event.error)
      onErrorRef.current?.(event.error)
    }
    recognition.onend = () => {
      clearSilenceTimer()
      recognitionRef.current = null
      setRecording(false)
      onEndRef.current?.()
    }

    recognitionRef.current = recognition
    setError(null)
    try {
      recognition.start()
    } catch (err) {
      // `start()` throws synchronously if called while already started; treat it
      // as a benign no-op and surface anything unexpected via onError.
      recognitionRef.current = null
      const message = err instanceof Error ? err.message : 'start-failed'
      setError(message)
      onErrorRef.current?.(message)
    }
  }, [supported, lang, armSilenceTimer, clearSilenceTimer])

  // Tear down on unmount: abort any live session and drop the timer.
  useEffect(() => {
    return () => {
      clearSilenceTimer()
      const recognition = recognitionRef.current
      if (recognition) {
        recognition.onend = null
        recognition.onerror = null
        recognition.onresult = null
        recognition.onstart = null
        recognition.abort()
        recognitionRef.current = null
      }
    }
  }, [clearSilenceTimer])

  return { supported, recording, error, start, stop, abort }
}

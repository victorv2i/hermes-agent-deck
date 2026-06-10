/**
 * useSpeechSynthesis — a thin, feature-detected React wrapper over the Web
 * Speech `speechSynthesis` API (spec, voice feature 2: voice output / TTS).
 *
 * Design goals:
 *  - FEATURE-DETECTED: `supported: false` + no-op controls where the API is
 *    absent, so callers can hide the "speak" affordance.
 *  - speak(text) cancels any prior utterance first (so a fresh "speak" never
 *    queues behind an old one — single-utterance semantics per the composer's
 *    "speak this message" affordance + opt-in auto-speak).
 *  - Tracks a `speaking` boolean and exposes cancel().
 *  - Sensible default voice (the platform default, optionally overridden via
 *    `voiceURI`) and rate.
 *
 * Browser-only; nothing leaves the device (LOCAL-ONLY).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** A controller surface compatible with `window.speechSynthesis`. */
type SynthLike = Pick<
  SpeechSynthesis,
  'speak' | 'cancel' | 'getVoices' | 'addEventListener' | 'removeEventListener'
>

function getSynth(): SynthLike | null {
  if (typeof window === 'undefined') return null
  const synth = (window as Window & { speechSynthesis?: SpeechSynthesis }).speechSynthesis
  return synth ?? null
}

function hasUtterance(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance ===
      'function'
  )
}

export interface UseSpeechSynthesisOptions {
  /** Playback rate (0.1–10, default 1). */
  rate?: number
  /** Pitch (0–2, default 1). */
  pitch?: number
  /** Preferred voice by `voiceURI`; falls back to the platform default. */
  voiceURI?: string
  /** BCP-47 language tag for the utterance. */
  lang?: string
}

export interface UseSpeechSynthesis {
  /** Whether the platform exposes speech synthesis. */
  supported: boolean
  /** True while an utterance is being spoken. */
  speaking: boolean
  /** The available voices (may populate asynchronously). */
  voices: SpeechSynthesisVoice[]
  /** Speak the given text, cancelling any prior utterance first. */
  speak: (text: string) => void
  /** Cancel the current/queued utterance. */
  cancel: () => void
}

export function useSpeechSynthesis(options: UseSpeechSynthesisOptions = {}): UseSpeechSynthesis {
  const { rate = 1, pitch = 1, voiceURI, lang } = options

  const [supported] = useState(() => getSynth() !== null && hasUtterance())
  const [speaking, setSpeaking] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  // Keep the latest options/voices in refs so the stable `speak` callback reads
  // current values without being re-created. Synced in an effect, not during
  // render (refs must not be mutated while rendering).
  const optionsRef = useRef({ rate, pitch, voiceURI, lang })
  const voicesRef = useRef<SpeechSynthesisVoice[]>(voices)
  useEffect(() => {
    optionsRef.current = { rate, pitch, voiceURI, lang }
    voicesRef.current = voices
  })

  // Load the voice list (it can arrive asynchronously via `voiceschanged`).
  useEffect(() => {
    if (!supported) return
    const synth = getSynth()
    if (!synth) return
    const load = () => setVoices(synth.getVoices())
    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [supported])

  const cancel = useCallback(() => {
    getSynth()?.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text) return
      const synth = getSynth()
      if (!synth) return
      // Single-utterance semantics: a new speak cancels the previous one.
      synth.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      const opts = optionsRef.current
      utterance.rate = opts.rate ?? 1
      utterance.pitch = opts.pitch ?? 1
      if (opts.lang) utterance.lang = opts.lang
      if (opts.voiceURI) {
        const match = voicesRef.current.find((v) => v.voiceURI === opts.voiceURI)
        if (match) utterance.voice = match
      }
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      setSpeaking(true)
      synth.speak(utterance)
    },
    [supported],
  )

  // Stop speaking if the component unmounts mid-utterance.
  useEffect(() => {
    return () => {
      if (supported) getSynth()?.cancel()
    }
  }, [supported])

  return { supported, speaking, voices, speak, cancel }
}

/**
 * useDictation — the composer's voice-DICTATION hook.
 *
 * A thin wrapper over {@link useSpeechRecognition} that adds the HONEST
 * availability gate the composer needs. Dictation fills the message text from
 * the user's speech (the user still reviews + sends) — it is NOT "the agent
 * hears your mic". Browser-only; nothing leaves the device.
 *
 * Why a wrapper (not just the raw hook): the spec requires the mic button to be
 * shown DISABLED with a truthful tooltip when dictation can't run, rather than
 * silently hidden. Two things must be true to dictate:
 *  1. the platform exposes the Web Speech `SpeechRecognition` API, and
 *  2. the page is a SECURE CONTEXT (https / localhost) — browsers refuse mic
 *     access on insecure origins, so the button would tap into nothing.
 * This hook collapses both into `available` + a human `unavailableReason` so the
 * composer can render one honest disabled state instead of re-deriving the rule.
 */
import { useCallback, useState } from 'react'
import {
  useSpeechRecognition,
  type UseSpeechRecognitionOptions,
  type UseSpeechRecognition,
} from './useSpeechRecognition'

export interface UseDictation extends UseSpeechRecognition {
  /**
   * True only when dictation can actually run: the Web Speech API is present AND
   * the page is a secure context. The composer enables the mic on this.
   */
  available: boolean
  /**
   * A short, user-facing explanation of WHY dictation is unavailable (for the
   * disabled mic's tooltip), or null when `available`. Never throws.
   */
  unavailableReason: string | null
}

/** Whether the current page is a secure context (https / localhost). */
function readIsSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true
}

export function useDictation(options: UseSpeechRecognitionOptions = {}): UseDictation {
  const speech = useSpeechRecognition(options)

  // The secure-context check is read once on mount (it is stable for the page's
  // lifetime, like the API feature-detection), mirroring useSpeechRecognition's
  // own `supported` latch so the two compose cleanly.
  const [secureContext] = useState(readIsSecureContext)

  const available = speech.supported && secureContext
  const unavailableReason = available
    ? null
    : !speech.supported
      ? 'Voice input isn’t supported in this browser'
      : 'Voice input needs a secure (https) connection'

  // Honest gate: never begin a session when dictation can't run, so a tap on a
  // (mistakenly) enabled control never constructs recognition behind the scenes.
  const start = useCallback(() => {
    if (!available) return
    speech.start()
  }, [available, speech])

  return { ...speech, start, available, unavailableReason }
}

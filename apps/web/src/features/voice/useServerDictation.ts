/**
 * useServerDictation - the DURABLE, any-browser voice-dictation hook.
 *
 * Where the Web Speech `SpeechRecognition` API is absent (Firefox, many
 * Chromium-on-Linux builds), this records the user's mic with `getUserMedia` +
 * `MediaRecorder`, POSTs the clip to the BFF (`POST /api/agent-deck/voice/transcribe`,
 * which proxies stock hermes `POST /api/audio/transcribe`), and delivers the
 * recognized text through `onResult`. Like {@link useSpeechRecognition}, the
 * transcript fills the composer for the USER to review + send - it is dictation,
 * not "the agent hears your mic".
 *
 * Differences from the native hook (kept behind the SAME control surface so
 * {@link useDictation} can swap between them):
 *  - It is NOT streaming: the transcript arrives ONCE, after the user stops, so a
 *    single final `onResult({ isFinal: true })` fires (no interim chunks).
 *  - `recording` is true during MIC CAPTURE; `transcribing` is true during the
 *    upload + recognition that follows stop(), so the composer can show an honest
 *    "Transcribing…" state instead of looking hung.
 *  - Errors surface through `onError` with stable codes: `not-allowed` (mic
 *    permission denied - same code the native API uses, so the composer's existing
 *    toast fires), `no-recorder` (capture unsupported), or `transcribe-failed`.
 *
 * SECURE CONTEXT: `getUserMedia` requires https/localhost; the gate that selects
 * this hook ({@link useDictation}) checks that, so `start()` here trusts it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaRecorderSupported, pickAudioMimeType, blobToDataUrl } from './mediaCapture'
import { transcribeAudio } from './api'

export interface UseServerDictationOptions {
  /** Called once with the final recognized transcript (isFinal always true). */
  onResult?: (payload: { transcript: string; isFinal: true }) => void
  /** Called once the dictation cycle has fully ended (any reason). */
  onEnd?: () => void
  /** Called on an error with a stable code (`not-allowed` / `no-recorder` /
   * `transcribe-failed`). */
  onError?: (error: string) => void
  /** Injectable transcribe call (tests). Defaults to the real BFF client. */
  transcribeImpl?: typeof transcribeAudio
}

export interface UseServerDictation {
  /** Whether mic capture + server transcription can run on this platform. */
  supported: boolean
  /** True while actively CAPTURING the mic (before stop). */
  recording: boolean
  /** True while UPLOADING + transcribing the captured clip (after stop). */
  transcribing: boolean
  /** The last error code, or null. Cleared on a fresh start(). */
  error: string | null
  /** Begin capturing (no-op when unsupported or already active). */
  start: () => void
  /** Stop capturing and transcribe what was recorded. */
  stop: () => void
  /** Abort immediately, discarding the recording (no transcription). */
  abort: () => void
}

export function useServerDictation(options: UseServerDictationOptions = {}): UseServerDictation {
  const { onResult, onEnd, onError, transcribeImpl = transcribeAudio } = options

  const [supported] = useState(() => mediaRecorderSupported())
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // True when stop() was an abort (discard) rather than a real stop (transcribe).
  const abortedRef = useRef(false)
  // Guards a teardown-on-unmount so we never call into a torn-down component.
  const mountedRef = useRef(true)

  // Keep the latest callbacks in refs so the recorder handlers always call through
  // to current props without re-creating the recorder.
  const onResultRef = useRef(onResult)
  const onEndRef = useRef(onEnd)
  const onErrorRef = useRef(onError)
  const transcribeRef = useRef(transcribeImpl)
  useEffect(() => {
    onResultRef.current = onResult
    onEndRef.current = onEnd
    onErrorRef.current = onError
    transcribeRef.current = transcribeImpl
  })

  /** Stop the mic tracks + drop the stream (release the OS mic indicator). */
  const releaseStream = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
  }, [])

  // Assemble the recorded chunks, POST for transcription, deliver the text. On any
  // failure surface `transcribe-failed` (never throws into render). Always ends
  // with onEnd + cleared flags so the mic returns to idle.
  const finishAndTranscribe = useCallback(async (mimeType: string) => {
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) {
      if (mountedRef.current) setTranscribing(false)
      onEndRef.current?.()
      return
    }
    if (mountedRef.current) setTranscribing(true)
    try {
      const blob = new Blob(chunks, mimeType ? { type: mimeType } : undefined)
      const dataUrl = await blobToDataUrl(blob)
      const { transcript } = await transcribeRef.current({
        dataUrl,
        mimeType: mimeType || blob.type || undefined,
      })
      onResultRef.current?.({ transcript, isFinal: true })
    } catch {
      if (mountedRef.current) setError('transcribe-failed')
      onErrorRef.current?.('transcribe-failed')
    } finally {
      if (mountedRef.current) setTranscribing(false)
      onEndRef.current?.()
    }
  }, [])

  const start = useCallback(() => {
    if (!supported || recorderRef.current || recording) return
    abortedRef.current = false
    chunksRef.current = []
    setError(null)
    const mimeType = pickAudioMimeType()
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // A stop()/abort() that raced the permission grant: release immediately.
        if (abortedRef.current || !mountedRef.current) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          recorderRef.current = null
          setRecording(false)
          releaseStream()
          if (abortedRef.current) {
            chunksRef.current = []
            onEndRef.current?.()
            return
          }
          void finishAndTranscribe(recorder.mimeType || mimeType)
        }
        recorder.start()
        setRecording(true)
      })
      .catch((err: unknown) => {
        // Permission denial (NotAllowedError / SecurityError) maps to the SAME
        // `not-allowed` code the Web Speech API uses, so the composer's existing
        // blocked-mic toast fires. Anything else is a generic capture failure.
        releaseStream()
        const name = err instanceof DOMException ? err.name : ''
        const code =
          name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'no-recorder'
        if (mountedRef.current) setError(code)
        onErrorRef.current?.(code)
      })
  }, [supported, recording, releaseStream, finishAndTranscribe])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    // stop() before the recorder even started (permission still pending): mark
    // aborted so the grant handler tears the stream down instead of recording.
    abortedRef.current = true
  }, [])

  const abort = useCallback(() => {
    abortedRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      releaseStream()
    }
    chunksRef.current = []
    setRecording(false)
  }, [releaseStream])

  // Tear down on unmount: abort any live capture + release the mic.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortedRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null
        recorder.onstop = null
        try {
          recorder.stop()
        } catch {
          // already stopped
        }
        recorderRef.current = null
      }
      const stream = streamRef.current
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [])

  return { supported, recording, transcribing, error, start, stop, abort }
}

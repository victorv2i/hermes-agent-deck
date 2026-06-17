/**
 * Media-capture feature detection for SERVER-side dictation (the durable
 * any-browser voice-input path). Where the Web Speech `SpeechRecognition` API is
 * absent (Firefox, many Chromium-on-Linux builds), we instead record the mic with
 * `getUserMedia` + `MediaRecorder` and POST the clip to the BFF for transcription.
 *
 * Both APIs still require a SECURE CONTEXT (https / localhost) - `getUserMedia` is
 * gated by the browser on insecure origins - so the caller pairs this detection
 * with the secure-context check to decide between server dictation and an honest
 * disabled state. Pure + SSR-safe so it can back feature-detection like
 * {@link getSpeechRecognitionCtor}.
 */

/** A navigator that *may* expose mediaDevices.getUserMedia. */
interface MediaDevicesNavigator {
  mediaDevices?: { getUserMedia?: unknown }
}

/**
 * Whether this platform can record the mic for server-side transcription:
 * `navigator.mediaDevices.getUserMedia` AND the `MediaRecorder` constructor are
 * both present. Returns false in SSR and on browsers missing either piece.
 */
export function mediaRecorderSupported(
  nav: MediaDevicesNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as MediaDevicesNavigator),
  recorderCtor: unknown = typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
): boolean {
  if (!nav) return false
  if (typeof nav.mediaDevices?.getUserMedia !== 'function') return false
  return typeof recorderCtor === 'function'
}

/**
 * The MIME types we ASK `MediaRecorder` for, best first. Hermes accepts webm/ogg
 * (and the common audio types) at `POST /api/audio/transcribe`; webm/opus is the
 * broadly-supported Chromium default and ogg/opus covers Firefox. We probe with
 * `MediaRecorder.isTypeSupported` and fall back to the browser default (empty
 * string) when none match, so recording still works and the server infers the type.
 */
export const PREFERRED_AUDIO_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

/**
 * Pick the first preferred MIME type this `MediaRecorder` supports, or '' to let
 * the browser choose its default. Guarded for environments where
 * `MediaRecorder.isTypeSupported` is missing (returns '').
 */
export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  for (const type of PREFERRED_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Read a recorded {@link Blob} into a `data:<mime>;base64,<...>` URL - the wire
 * shape stock hermes `POST /api/audio/transcribe` expects. Uses FileReader so the
 * base64 encoding is done by the platform (no manual byte juggling). Rejects on a
 * read error or a non-string result.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Unexpected recording encoding'))
    }
    reader.readAsDataURL(blob)
  })
}

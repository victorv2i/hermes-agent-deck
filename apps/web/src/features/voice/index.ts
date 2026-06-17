export {
  useSpeechRecognition,
  DEFAULT_SILENCE_MS,
  type UseSpeechRecognition,
  type UseSpeechRecognitionOptions,
  type SpeechRecognitionResultPayload,
} from './useSpeechRecognition'
export { useDictation, type UseDictation, type DictationMode } from './useDictation'
export {
  useServerDictation,
  type UseServerDictation,
  type UseServerDictationOptions,
} from './useServerDictation'
export {
  mediaRecorderSupported,
  pickAudioMimeType,
  blobToDataUrl,
  PREFERRED_AUDIO_MIME_TYPES,
} from './mediaCapture'
export {
  useSpeechSynthesis,
  type UseSpeechSynthesis,
  type UseSpeechSynthesisOptions,
} from './useSpeechSynthesis'
export {
  useVoicePrefs,
  getVoicePrefs,
  setVoicePrefs,
  setAutoSpeak,
  readStoredVoicePrefs,
  VOICE_PREFS_STORAGE_KEY,
  type VoicePrefs,
  type UseVoicePrefs,
} from './voicePrefs'
export {
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionWindow,
} from './speechRecognitionTypes'

// The Voice Console surface (`/voice`) — configure the AGENT's TTS/STT providers
// + voices + keys and play back its real cached audio. (Distinct from the browser
// speech helpers above, which power the composer's local mic dictation.)
export { VoiceRoute } from './VoiceRoute'
export { VoicePage, type VoicePageProps } from './VoicePage'

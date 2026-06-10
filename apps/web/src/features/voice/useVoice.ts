import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  VoiceState,
  AudioNoteList,
  UpdateVoiceConfigRequest,
  UpdateVoiceConfigResponse,
  SetVoiceKeyRequest,
  SetVoiceKeyResponse,
} from '@agent-deck/protocol'
import { fetchVoice, fetchAudioNotes, updateVoiceConfig, setVoiceKey } from './api'

const voiceKey = ['agent-deck', 'voice'] as const
const audioKey = ['agent-deck', 'voice', 'audio'] as const

/**
 * Read the Voice surface state (providers × selected voices × key shape ×
 * toggles). Refetches on focus so a change made elsewhere (a key set from the
 * CLI, a provider switched in config) shows when the user returns.
 */
export function useVoice() {
  return useQuery<VoiceState>({
    queryKey: voiceKey,
    queryFn: ({ signal }) => fetchVoice(signal),
    staleTime: 10_000,
  })
}

/** List the real cached voice notes. */
export function useAudioNotes() {
  return useQuery<AudioNoteList>({
    queryKey: audioKey,
    queryFn: ({ signal }) => fetchAudioNotes(signal),
    staleTime: 10_000,
  })
}

/**
 * Update voice config (provider/voice/toggle scalars). On settle we invalidate
 * the voice read so the surface re-resolves from a fresh fetch — the change only
 * takes effect after a gateway restart (`restartRequired`), so the surface
 * prompts "Restart to apply" rather than faking the new behavior.
 */
export function useUpdateVoiceConfig() {
  const qc = useQueryClient()
  return useMutation<UpdateVoiceConfigResponse, Error, UpdateVoiceConfigRequest>({
    mutationFn: (request) => updateVoiceConfig(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: voiceKey })
    },
  })
}

/**
 * Store/replace a provider key. On settle we invalidate the voice read so each
 * provider card re-resolves its `isSet` / `redactedValue` from a fresh fetch.
 */
export function useSetVoiceKey() {
  const qc = useQueryClient()
  return useMutation<SetVoiceKeyResponse, Error, SetVoiceKeyRequest>({
    mutationFn: (request) => setVoiceKey(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: voiceKey })
    },
  })
}

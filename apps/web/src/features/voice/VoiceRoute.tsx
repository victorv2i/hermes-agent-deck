import { AudioLines } from 'lucide-react'
import type { SetVoiceKeyRequest, UpdateVoiceConfigRequest } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/state'
import { toast } from '@/lib/toast'
import { VoicePage } from './VoicePage'
import { useVoice, useAudioNotes, useUpdateVoiceConfig, useSetVoiceKey } from './useVoice'

/**
 * Route element for the Voice Console (`/voice`). Bridges the `useVoice` +
 * `useAudioNotes` reads to the presentational {@link VoicePage} and owns the two
 * honest mutations:
 *
 *  - Update config → PUT .../voice (confined to the tts/stt/voice blocks), then
 *    the voice read is invalidated so the surface re-resolves. The toast states
 *    the truth: saved, takes effect on the next gateway session.
 *  - Save key → POST .../voice/key (shape-only response), allowlisted server-side.
 *
 * No action fakes a state: the surface always re-reads the agent's real config.
 */
export function VoiceRoute() {
  const query = useVoice()
  const audio = useAudioNotes()
  const update = useUpdateVoiceConfig()
  const setKey = useSetVoiceKey()

  const onUpdate = (request: UpdateVoiceConfigRequest) => {
    update.mutate(request, {
      onSuccess: () =>
        toast.success('Voice settings saved', {
          description: 'They apply on your agent’s next gateway session.',
        }),
      onError: (err) =>
        toast.error('Couldn’t save voice settings', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  const onSetKey = (request: SetVoiceKeyRequest) => {
    setKey.mutate(request, {
      onSuccess: () =>
        toast.success('Key stored', {
          description: 'It takes effect on your agent’s next gateway session.',
        }),
      onError: (err) =>
        toast.error('Couldn’t store the key', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  if (query.status === 'pending') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader icon={AudioLines} title="Voice" subtitle="Give your agent a voice." />
        <div className="flex flex-col gap-4" aria-hidden data-testid="voice-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ad-surface h-40 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </div>
    )
  }

  if (query.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader icon={AudioLines} title="Voice" />
        <ErrorState
          icon={AudioLines}
          title="Couldn’t load voice settings"
          description="Agentdeck couldn’t reach Hermes to read your voice configuration. This doesn’t affect chatting."
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  return (
    <VoicePage
      state={query.data}
      notes={audio.data?.notes ?? []}
      notesTruncated={audio.data?.truncated ?? false}
      onUpdate={onUpdate}
      onSetKey={onSetKey}
      saving={update.isPending}
    />
  )
}

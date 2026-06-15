import { useEffect, useRef, useState } from 'react'
import { AudioLines, Loader2, Play, TriangleAlert } from 'lucide-react'
import type { AudioNote } from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/state'
import { fetchAudioObjectUrl } from './api'

/**
 * VoiceNotesList — "Recent voice notes." Lists the REAL cached audio artifacts the
 * agent already wrote (name · format · size · when) and plays them with a native
 * `<audio>` over the auth-gated serve route. Playback is real cached files only —
 * there is no live capture or synthesis here.
 *
 * The audio bytes ride the BFF's auth-gated serve route, so we fetch the blob WITH
 * the bearer token (object URL) on first play rather than putting the token in a
 * bare `<audio src>` (which can't carry an Authorization header on a remote bind).
 */

export interface VoiceNotesListProps {
  notes: AudioNote[]
  truncated: boolean
}

export function VoiceNotesList({ notes, truncated }: VoiceNotesListProps) {
  return (
    <section aria-label="Recent voice notes" role="region">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
              >
                <AudioLines className="size-[18px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <CardTitle>Recent voice notes</CardTitle>
                <p className="text-13 text-muted-foreground">
                  Audio your agent has spoken, cached on this machine.
                </p>
              </div>
            </div>
            {notes.length > 0 ? (
              <Badge variant="muted">
                {notes.length}
                {truncated ? '+' : ''}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="-mt-1">
          {notes.length === 0 ? (
            <EmptyState
              icon={AudioLines}
              title="No voice notes yet"
              description="When your agent speaks (auto-speak, a Telegram voice bubble, …), the audio appears here to play back."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {notes.map((note) => (
                <NoteRow key={note.name} note={note} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** One note row — loads the auth-gated blob on first play, then renders <audio>. */
function NoteRow({ note }: { note: AudioNote }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track the created object URL so we revoke it on unmount (no leak).
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  async function load() {
    if (objectUrl || loading) return
    setLoading(true)
    setError(null)
    try {
      const url = await fetchAudioObjectUrl(note.name)
      urlRef.current = url
      setObjectUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this note.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-13 text-foreground">{note.name}</span>
          <span className="text-[11px] text-foreground-tertiary">
            {note.ext.toUpperCase()} · {formatBytes(note.size)} · {formatWhen(note.modifiedAt)}
          </span>
        </div>
        {!objectUrl ? (
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="shrink-0"
            aria-label={`Play ${note.name}`}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Loading…
              </>
            ) : (
              <>
                <Play aria-hidden />
                Play
              </>
            )}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-1.5 text-[12px] text-destructive" role="alert">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      {objectUrl ? (
        // Agent voice output (cached TTS) — there is no caption track to attach;
        // the player carries an accessible name via aria-label.
        <audio controls autoPlay src={objectUrl} className="h-9 w-full" aria-label={note.name} />
      ) : null}
    </li>
  )
}

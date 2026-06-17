import { useState } from 'react'
import { Loader2, Power, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { restartGateway } from '@/features/system/api'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/state/useChatStore'
import { RungChrome } from './RungChrome'

/**
 * Rung 4 - First chat. A REAL run on the live `/chat-run` socket (the wizard owns
 * the only socket while it's open). The first streamed token fires
 * `markOnboarded()` (wired by the parent via {@link useFirstToken}), which closes
 * the wizard.
 *
 * Gateway down: an HONEST "start your agent" action that calls the same BFF
 * gateway restart route as System, then asks the wizard to re-probe. No fake
 * chat appears before the live socket is online. We surface a real transcript of
 * the user's turn + the streaming reply, read straight from the live chat store.
 */
export function FirstChatRung({
  connection,
  onSend,
  onStarted,
  onSkip,
  onBack,
}: {
  connection: 'online' | 'connecting' | 'offline'
  onSend: (text: string) => void
  onStarted: () => void
  onSkip: () => void
  onBack: () => void
}) {
  const turns = useChatStore((s) => s.turns)
  const runStatus = useChatStore((s) => s.runStatus)
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const [startNotice, setStartNotice] = useState<{
    tone: 'success' | 'warning' | 'error'
    text: string
  } | null>(null)

  const offline = connection === 'offline'
  const running = runStatus === 'running'
  const canSend = text.trim().length > 0 && !offline && !running
  const deckUrl = currentDeckUrl()

  function submit() {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  async function startAgent() {
    if (starting) return
    setStarting(true)
    setStartNotice(null)
    try {
      const state = await restartGateway()
      onStarted()
      if (state.status === 'running') {
        setStartNotice({
          tone: 'success',
          text: 'Agent is running. Checking the live connection now.',
        })
      } else {
        setStartNotice({
          tone: 'warning',
          text: `Restart finished, but your agent reports "${state.status}". Re-check from System if it stays offline.`,
        })
      }
    } catch (err) {
      setStartNotice({
        tone: 'error',
        text:
          err instanceof Error
            ? `Could not start the agent: ${err.message}`
            : 'Could not start the agent. Please try again.',
      })
    } finally {
      setStarting(false)
    }
  }

  return (
    <RungChrome
      rung="chat"
      onBack={onBack}
      onSkip={onSkip}
      // The final rung's "primary" is the send affordance inside the body; the
      // footer just keeps Back + the skip fast-path. A quiet "Finish later" lets
      // a user who's seen enough leave without sending.
      primary={
        <Button type="button" variant="outline" size="sm" onClick={onSkip} className="h-10 px-3">
          Finish later
        </Button>
      }
    >
      {offline ? (
        <div className="grid gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your agent is not running yet. Agentdeck can request a gateway restart for you.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              onClick={() => void startAgent()}
              disabled={starting}
              className="h-11 rounded-xl px-5 text-[15px]"
            >
              {starting ? <Loader2 className="animate-spin" aria-hidden /> : <Power aria-hidden />}
              Start agent
            </Button>
            <span className="text-xs leading-relaxed text-foreground-tertiary">
              Chat stays disabled until the live connection is online.
            </span>
          </div>
          {startNotice && (
            <p
              role="status"
              className={cn(
                'rounded-md px-3 py-2 text-xs leading-relaxed',
                startNotice.tone === 'success' && 'bg-success/10 text-success',
                startNotice.tone === 'warning' &&
                  'bg-warning/10 text-[color-mix(in_oklch,var(--warning),var(--foreground)_20%)]',
                startNotice.tone === 'error' && 'bg-destructive/10 text-destructive',
              )}
            >
              {startNotice.text}
            </p>
          )}
          <p className="text-xs text-foreground-tertiary">
            We will connect automatically once the socket comes online.
          </p>
          <BookmarkHint deckUrl={deckUrl} />
        </div>
      ) : (
        <div className="grid gap-3">
          {/* The live transcript of this first exchange. */}
          {turns.length > 0 && (
            <div className="ad-surface grid max-h-56 gap-2 overflow-y-auto rounded-md bg-surface-1 p-3">
              {turns.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    'text-sm leading-relaxed',
                    t.role === 'user' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className="ad-section-label mr-1.5 text-foreground-tertiary">
                    {t.role === 'user' ? 'You' : 'Agent'}
                  </span>
                  {t.role === 'assistant' && t.content.length === 0 ? (
                    <Loader2
                      className="inline size-3.5 animate-spin align-text-bottom"
                      aria-label="thinking"
                    />
                  ) : (
                    t.content
                  )}
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="flex items-end gap-2"
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Try asking something - or just say hello..."
              aria-label="Message your agent"
              autoFocus
              disabled={running}
            />
            <Button type="submit" disabled={!canSend} aria-label="Send" className="size-11 px-0">
              {running ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            </Button>
          </form>
          {connection === 'connecting' && (
            <p className="text-xs text-foreground-tertiary">Connecting to your agent...</p>
          )}
          <BookmarkHint deckUrl={deckUrl} />
        </div>
      )}
    </RungChrome>
  )
}

function BookmarkHint({ deckUrl }: { deckUrl: string }) {
  return (
    <p className="text-xs leading-relaxed text-foreground-tertiary">
      Bookmark <code className="font-mono text-foreground">{deckUrl}</code>. Reopen it while
      Agentdeck is running; on a phone, bookmark your Tailscale HTTPS URL instead.
    </p>
  )
}

function currentDeckUrl(): string {
  return window.location.origin || 'http://127.0.0.1:7878'
}

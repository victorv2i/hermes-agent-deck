import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Loader2, Power, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { restartGateway } from '@/features/system/api'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { restartCommand } from './mutations'
import { profileKeys } from './useProfiles'

type RestartPhase = 'idle' | 'restarting' | 'done' | 'error'

export function GatewayRestartCard({
  message,
  note,
  className,
}: {
  message: string
  /** An optional calm second line that explains WHY a restart is needed (e.g. the
   * one-agent-at-a-time Hermes constraint behind an agent switch). Context-specific
   * so the rename flow keeps its own reason — never a generic catch-all. */
  note?: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<RestartPhase>('idle')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function restart() {
    if (phase === 'restarting') return
    setPhase('restarting')
    setError(null)
    try {
      const next = await restartGateway()
      setStatus(next.status)
      setPhase('done')
      // The gateway has handed over to the newly-active agent, so the roster's
      // running-profile signal changed: refetch so the chip's "restart to apply"
      // marker clears and ambient identity follows the now-running agent.
      void queryClient.invalidateQueries({ queryKey: profileKeys.all })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again.')
      setPhase('error')
    }
  }

  async function copyFallback() {
    try {
      await navigator.clipboard?.writeText(restartCommand())
      toast.success('Restart command copied')
    } catch {
      toast.error('Could not copy the command')
    }
  }

  return (
    <div
      role="status"
      className={cn(
        'ad-surface flex flex-col gap-2 rounded-md bg-surface-1 px-3 py-2.5 text-left',
        className,
      )}
    >
      <p className="text-13 leading-relaxed text-foreground">{message}</p>
      {note && <p className="text-xs leading-relaxed text-foreground-tertiary">{note}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          size="sm"
          onClick={() => void restart()}
          disabled={phase === 'restarting'}
        >
          {phase === 'restarting' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Power aria-hidden />
          )}
          Restart your agent
        </Button>
        {phase === 'done' && status && (
          <span className="text-xs leading-relaxed text-foreground-tertiary">
            Your agent reports <span className="font-medium text-foreground">{status}</span> after
            restart.
          </span>
        )}
      </div>
      {phase === 'error' && (
        <div className="grid gap-2" role="alert">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>Couldn’t restart your agent from Agentdeck. {error}</span>
          </p>
          <div className="ad-surface flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
              {restartCommand()}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copyFallback()}
              aria-label="Copy fallback restart command"
            >
              <ClipboardCopy aria-hidden />
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

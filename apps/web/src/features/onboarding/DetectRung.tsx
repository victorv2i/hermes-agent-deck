import { useId, useState } from 'react'
import { CheckCircle2, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CopyCommandCard } from './CopyCommandCard'
import { RungChrome } from './RungChrome'

/** True when the browser reports a Windows user-agent. */
function isWindows(): boolean {
  return /windows/i.test(navigator.userAgent)
}

/**
 * The official Hermes Quick-Install one-liner (NousResearch docs). Shown as a
 * copy-paste command because Agentdeck can't safely install Hermes itself before
 * packaging, can't sense a PATH reload, and shouldn't silently execute a piped
 * installer on the host. The user copies it, runs it once, then Re-checks.
 */
export const HERMES_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'

/**
 * Rung 1 -- Detect. Honest copy-paste install card + a Re-check that re-runs the
 * REAL probe (`hermes version`). Continue is enabled only once the probe truly
 * reports Hermes installed -- never a remembered flag.
 */
export function DetectRung({
  installed,
  rechecking,
  onRecheck,
  onContinue,
  onSkip,
}: {
  installed: boolean
  rechecking: boolean
  onRecheck: () => void
  onContinue: () => void
  onSkip: () => void
}) {
  const [terminalHintOpen, setTerminalHintOpen] = useState(false)
  const terminalHintRegionId = useId()

  return (
    <RungChrome
      rung="detect"
      onSkip={onSkip}
      primary={
        <Button
          type="button"
          onClick={onContinue}
          disabled={!installed}
          className="h-11 rounded-xl px-5 text-[15px]"
        >
          Continue
        </Button>
      }
    >
      {installed ? (
        <div
          role="status"
          className="ad-surface flex items-center gap-2.5 rounded-md bg-surface-1 px-3 py-2.5 text-sm"
        >
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <span className="text-foreground">Hermes is installed and working.</span>
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Agentdeck is already open in your browser. We could not find the{' '}
            <code className="font-mono text-foreground">hermes</code> command that runs your local
            agent. Copy the command below, run it once in a terminal, then re-check.
          </p>

          {/* Plain-language context: what this command does + safety reassurance */}
          <div className="ad-surface rounded-md bg-surface-1 px-3 py-2.5 text-xs leading-relaxed text-foreground-tertiary">
            <p>
              This installs the Hermes agent runtime from NousResearch. It puts the{' '}
              <code className="font-mono">hermes</code> command on your system. Nothing else.{' '}
              <a
                href="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                View the install script
              </a>{' '}
              if you would like to review it first.
            </p>
            {isWindows() && (
              <p className="mt-1.5 font-medium text-foreground">
                On Windows: WSL2 is required first,{' '}
                <a
                  href="https://learn.microsoft.com/windows/wsl/install"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  see the Windows WSL install guide
                </a>
                , then run this command inside WSL.
              </p>
            )}
          </div>

          <CopyCommandCard command={HERMES_INSTALL_COMMAND} ariaLabel="Copy install command" />

          <p className="text-xs leading-relaxed text-foreground-tertiary">
            Once running, this page updates automatically. You do not need to reload.
          </p>

          {/* Collapsible terminal help for newcomers */}
          <div className="ad-surface rounded-md bg-surface-1">
            <button
              type="button"
              aria-expanded={terminalHintOpen}
              aria-controls={terminalHintRegionId}
              onClick={() => setTerminalHintOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              <span>Not sure how to open a terminal?</span>
              <ChevronDown
                className={cn('size-3.5 transition-transform', terminalHintOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            <div id={terminalHintRegionId}>
              {terminalHintOpen && (
                <div className="grid gap-1.5 border-t border-border px-3 pt-2.5 pb-3 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    <strong className="text-foreground">Mac:</strong> Press{' '}
                    <kbd className="rounded border border-border px-1 font-mono">Command+Space</kbd>
                    , type &quot;Terminal&quot;, press Enter. Or open Finder &rarr; Applications
                    &rarr; Utilities &rarr; Terminal.
                  </p>
                  <p>
                    <strong className="text-foreground">Linux:</strong> Press{' '}
                    <kbd className="rounded border border-border px-1 font-mono">Ctrl+Alt+T</kbd>,
                    or search your app launcher for &quot;Terminal&quot;.
                  </p>
                  <p>
                    <strong className="text-foreground">Windows:</strong> Install WSL2 first (see
                    above), then open &quot;Ubuntu&quot; from the Start menu.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRecheck}
              disabled={rechecking}
              aria-busy={rechecking}
              className="h-10 px-3"
            >
              {rechecking ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              Re-check
            </Button>
            <span className="text-xs text-foreground-tertiary">
              Already installed? Re-check picks it up.
            </span>
          </div>
        </>
      )}
    </RungChrome>
  )
}

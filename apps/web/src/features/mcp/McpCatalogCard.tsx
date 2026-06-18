import { useState } from 'react'
import { Check, Copy, ExternalLink, Globe, GitBranch, TerminalSquare } from 'lucide-react'
import type { McpCatalogEntry } from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * McpCatalogCard — one curated (Nous-approved) catalog entry.
 *
 * HONESTY: the catalog's installs flow through the hermes CLI — OAuth flows and
 * git-bootstrap clones can't (and shouldn't) be faked in-browser. So instead of a
 * fake "Install" button this surfaces the exact command to run:
 *   `hermes mcp install <name>`
 * with a copy button. Already-installed entries read as such (no duplicate add).
 *
 * Presentational: props in / one copy interaction owned locally.
 */

export interface McpCatalogCardProps {
  entry: McpCatalogEntry
}

export function McpCatalogCard({ entry }: McpCatalogCardProps) {
  const [copied, setCopied] = useState(false)
  const command = `hermes mcp install ${entry.name}`
  const TransportIcon = entry.transport === 'http' ? Globe : TerminalSquare

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard unavailable (no permission) — the command stays visible to copy
      // by hand; we don't fake a success.
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-mono">{entry.name}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.installed ? (
              <Badge variant="success">
                <Check aria-hidden />
                Installed
              </Badge>
            ) : null}
            <Badge variant="muted">
              <TransportIcon aria-hidden />
              {entry.transport === 'http' ? 'HTTP' : 'stdio'}
            </Badge>
            {entry.authKind === 'oauth' ? <Badge variant="muted">OAuth</Badge> : null}
            {entry.authKind === 'api_key' ? <Badge variant="muted">API key</Badge> : null}
            {entry.requiresInstall ? (
              <Badge variant="muted">
                <GitBranch aria-hidden />
                git install
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="-mt-1 flex flex-col gap-3">
        <p className="text-13 leading-relaxed text-muted-foreground">{entry.description}</p>

        {entry.installed ? (
          <p className="text-[12px] text-foreground-tertiary">
            This catalog server is already in your configuration above.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] text-foreground-tertiary">
              Run this in your terminal. Sign-in and setup happen there, not in Agentdeck:
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-[12px] text-foreground">
                {command}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copy}
                aria-label={`Copy install command for ${entry.name}`}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {entry.sourceUrl ? (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-foreground underline-offset-4 transition-colors hover:underline"
          >
            Learn more
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </CardContent>
    </Card>
  )
}

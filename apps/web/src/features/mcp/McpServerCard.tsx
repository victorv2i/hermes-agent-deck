import { useId } from 'react'
import {
  Check,
  Globe,
  KeyRound,
  Loader2,
  Plug,
  ShieldQuestion,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { McpConfiguredServer, McpTestResult } from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * McpServerCard — one configured MCP server on the single Card primitive.
 *
 * HONESTY (the load-bearing rules):
 *  - The ENABLED badge is the CONFIG FLAG (semantic muted/neutral), NEVER a green
 *    "connected" dot — a connection isn't persisted, so we never imply one.
 *  - Toggle + Remove are config writes that only take effect on a NEW gateway
 *    session; the card says so and the page reuses the real gateway restart.
 *  - OAuth servers show "authenticate via `hermes mcp login <name>`" — a clean
 *    test probe is NOT proof of auth, so there's no green check.
 *  - The Test result lists the server's discovered tools (a one-shot probe), with
 *    the OAuth caveat carried through when present.
 *
 * Presentational: props in / callbacks out, so the route owns the mutations.
 */

export interface McpServerCardProps {
  server: McpConfiguredServer
  /** Toggle the server's enabled config flag (the route owns the real mutation). */
  onToggle: (enabled: boolean) => void
  /** Remove the server (the route owns the real mutation + its confirm). */
  onRemove: () => void
  /** Run the REAL probe (the route owns the mutation). */
  onTest: () => void
  /** The probe result for THIS server, when one has run. */
  testResult?: McpTestResult
  /** Whether a probe for this server is in flight. */
  testing: boolean
  /** Whether a toggle/remove for this server is in flight. */
  mutating: boolean
}

const TRANSPORT_META: Record<
  McpConfiguredServer['transport'],
  { icon: typeof Globe; label: string }
> = {
  http: { icon: Globe, label: 'HTTP' },
  stdio: { icon: TerminalSquare, label: 'stdio' },
}

export function McpServerCard({
  server,
  onToggle,
  onRemove,
  onTest,
  testResult,
  testing,
  mutating,
}: McpServerCardProps) {
  const titleId = useId()
  const transport = TRANSPORT_META[server.transport]
  const TransportIcon = transport.icon
  const isOauth = server.authKind === 'oauth'

  return (
    <section aria-labelledby={titleId} role="region" aria-label={server.name}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="ad-surface grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
              >
                <Plug className="size-[18px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <CardTitle id={titleId} className="font-mono">
                  {server.name}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  <EnabledBadge enabled={server.enabled} />
                  <Badge variant="muted">
                    <TransportIcon aria-hidden />
                    {transport.label}
                  </Badge>
                  <AuthBadge authKind={server.authKind} />
                  {server.toolCount !== null ? (
                    <Badge variant="muted">
                      {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="-mt-1 flex flex-col gap-3">
          <p
            className="truncate font-mono text-[12px] text-foreground-tertiary"
            title={server.transportDetail}
          >
            {server.transportDetail}
          </p>

          {isOauth ? (
            <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
              <ShieldQuestion className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                This integration uses sign-in (OAuth). A passing test does not mean you&apos;re
                signed in. If tool calls fail, sign in from your terminal:{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  hermes mcp login {server.name}
                </code>
              </span>
            </p>
          ) : null}

          {testResult ? <TestResult result={testResult} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[12px] leading-relaxed text-foreground-tertiary">
              Changes take effect after your agent restarts.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" disabled={testing} onClick={onTest}>
                {testing ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Testing tools…
                  </>
                ) : (
                  <>
                    <Plug aria-hidden />
                    Test tools
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={mutating}
                onClick={() => onToggle(!server.enabled)}
              >
                {server.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={mutating}
                onClick={onRemove}
                aria-label={`Remove ${server.name}`}
                className="text-foreground-tertiary hover:text-destructive"
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Badges — the enabled flag is SEMANTIC (not the amber action accent)        */
/* -------------------------------------------------------------------------- */

/**
 * The ENABLED flag badge. Enabled = a SEMANTIC success chip ("Enabled"), which
 * means "this server is configured to load" — NOT "connected" (a connection
 * isn't persisted). Disabled = a quiet neutral chip. Never the amber accent.
 */
function EnabledBadge({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <Badge variant="success" data-testid="mcp-enabled">
        <Check aria-hidden />
        Enabled in config
      </Badge>
    )
  }
  return (
    <Badge variant="muted" data-testid="mcp-enabled">
      Disabled in config
    </Badge>
  )
}

function AuthBadge({ authKind }: { authKind: McpConfiguredServer['authKind'] }) {
  if (authKind === 'oauth') {
    return (
      <Badge variant="muted">
        <ShieldQuestion aria-hidden />
        OAuth
      </Badge>
    )
  }
  if (authKind === 'api_key') {
    return (
      <Badge variant="muted">
        <KeyRound aria-hidden />
        API key
      </Badge>
    )
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Test result — discovered tools (a one-shot probe, not a live connection)   */
/* -------------------------------------------------------------------------- */

function TestResult({ result }: { result: McpTestResult }) {
  if (!result.ok) {
    return (
      <div
        className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        role="alert"
      >
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{result.error ?? 'The probe failed.'}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[12px] font-medium text-foreground">
        Test reached server · {result.tools.length} {result.tools.length === 1 ? 'tool' : 'tools'}{' '}
        discovered
      </p>
      {result.authCaveat ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{result.authCaveat}</p>
      ) : null}
      {result.tools.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {result.tools.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-0.5">
              <span className="font-mono text-[12px] text-foreground">{tool.name}</span>
              {tool.description ? (
                <span className="text-[11px] leading-relaxed text-foreground-tertiary">
                  {tool.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

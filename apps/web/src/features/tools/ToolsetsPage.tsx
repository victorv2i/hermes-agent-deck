import { useId } from 'react'
import { Wrench, TriangleAlert, RotateCcw } from 'lucide-react'
import type { AgentDeckToolset } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/state'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * ToolsetsPage — the in-browser control plane for the agent's configurable toolsets.
 *
 * STOCK WRITE ROUTE (real, verified against web_server.py):
 *   PUT /api/tools/toolsets/{name} (web_server.py:5752) accepts { enabled: bool }
 *   and persists the change to `platform_toolsets.cli` in config.yaml — the same
 *   helper the `hermes tools` TUI uses. The BFF proxies this at
 *   PUT /api/agent-deck/toolsets/:name.
 *
 * HONESTY (the load-bearing rules — there are NO fake states here):
 *  - The toggle persists to config immediately, but the RUNNING gateway does NOT
 *    re-read config until restart. We show ONE honest page-level "restart your
 *    agent to apply" line — never fake instant activation.
 *  - "ENABLED" is the config truth for the `cli` platform (semantic dot),
 *    NOT a live probe and NEVER the primary action accent.
 *  - An enabled-but-not-configured toolset is flagged honestly (missing API key).
 *
 * Presentational: toolsets + onToggle in, no internal state — the route owns the
 * async mutation + refetch.
 */

export interface ToolsetsPageProps {
  toolsets: AgentDeckToolset[]
  /** Called when the user flips a switch. The caller handles the async mutation. */
  onToggle?: (name: string, enabled: boolean) => Promise<void>
}

export function ToolsetsPage({ toolsets, onToggle }: ToolsetsPageProps) {
  const enabledCount = toolsets.filter((t) => t.enabled).length

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={Wrench}
        title="Tools"
        subtitle="Capabilities your agent can use, like web search, file reading, or image generation. Turning them on or off is a one-time setup step."
      />

      {toolsets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No toolsets found"
          description="Agent Deck couldn't read any toolsets from the agent runtime. This doesn't affect chatting."
        />
      ) : (
        <>
          <p className="mb-1 text-sm text-muted-foreground">
            {enabledCount} of {toolsets.length} enabled
          </p>
          {/* Honest restart notice — config is written immediately but the running
              gateway does NOT reload until restart. One page-level line, not one
              per card. Never fake instant activation. */}
          <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
            <RotateCcw className="size-3 shrink-0" aria-hidden />
            Restart your agent to apply changes.
          </p>
          <ul className="flex flex-col gap-3" aria-label="Toolsets your agent can use">
            {toolsets.map((toolset) => (
              <li key={toolset.name}>
                <ToolsetCard toolset={toolset} onToggle={onToggle} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

interface ToolsetCardProps {
  toolset: AgentDeckToolset
  onToggle?: (name: string, enabled: boolean) => Promise<void>
}

function ToolsetCard({ toolset, onToggle }: ToolsetCardProps) {
  const titleId = useId()
  // Enabled-but-unconfigured is the one honest caveat: the agent won't actually
  // get the tool until its API key is set.
  const needsKey = toolset.enabled && !toolset.configured

  const handleToggle = () => {
    onToggle?.(toolset.name, !toolset.enabled)
  }

  return (
    <Card size="sm" aria-labelledby={titleId}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={titleId} className="flex items-center gap-2 text-sm">
            <span className="truncate">{toolset.label}</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {toolset.name}
            </code>
          </CardTitle>
          {/* Real toggle — backed by PUT /api/tools/toolsets/{name} (web_server.py:5752).
              aria-checked reflects current config state (the cli platform truth).
              --primary is the "on" colour: action/live state per the design spine.
              The BUTTON is the comfortable ≥44px hit target (min-h-11 + padding);
              the switch visual stays a compact ~20px track inside it. */}
          <button
            type="button"
            role="switch"
            aria-checked={toolset.enabled}
            aria-labelledby={titleId}
            onClick={handleToggle}
            disabled={onToggle === undefined}
            className={cn(
              '-my-1 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 py-1 transition-colors',
              'focus-visible:ad-focus',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                toolset.enabled ? 'bg-primary' : 'bg-foreground/20',
              )}
            >
              <span
                className={cn(
                  'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
                  toolset.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {toolset.description && !descriptionRepeatsTools(toolset.description, toolset.tools) ? (
          <p className="text-sm text-muted-foreground">{toolset.description}</p>
        ) : null}

        {needsKey ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            Enabled, but its API key isn't set yet; the agent can't use this toolset until the
            required key is added.
          </p>
        ) : null}

        {toolset.tools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={`Tools in ${toolset.label}`}>
            {toolset.tools.map((tool) => (
              <Badge key={tool} variant="muted" className="font-mono">
                {tool}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * True when the description is just the tool names again — the stock dashboard
 * often sets `description` to the literal comma-joined tool list, which the mono
 * chips below already show. Only that exact duplicate is hidden; real prose
 * descriptions always render.
 */
function descriptionRepeatsTools(description: string, tools: string[]): boolean {
  const parts = description
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.length !== tools.length) return false
  const chipSet = new Set(tools)
  return parts.every((p) => chipSet.has(p))
}

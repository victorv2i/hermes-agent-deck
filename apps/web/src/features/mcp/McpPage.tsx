import { Blocks, Library, Loader2, Plug, RefreshCw } from 'lucide-react'
import type { AddMcpServerRequest, McpState, McpTestResult } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/state'
import { Button } from '@/components/ui/button'
import { McpServerCard } from './McpServerCard'
import { McpCatalogCard } from './McpCatalogCard'
import { AddMcpServerForm } from './AddMcpServerForm'

/**
 * McpPage — the MCP Server Manager surface, data-driven from the BFF read:
 * configured servers (each with the honest enabled flag + toggle/remove/test),
 * a guided "Add custom server" form, and the curated catalog browser. Purely
 * presentational (props in / callbacks out) so the route owns the read + every
 * mutation and each state is exercisable without a query client.
 *
 * "The tools your agent can call." Everything here is honest: the enabled badge
 * is the config flag (never a fake "connected" dot); toggles/removes/adds take
 * effect on a new gateway session (the page reuses the real restart).
 */

export interface McpPageProps {
  state: McpState
  onAdd: (request: AddMcpServerRequest) => void
  adding: boolean
  onToggle: (name: string, enabled: boolean) => void
  onRemove: (name: string) => void
  onTest: (name: string) => void
  /** The latest probe result per server name. */
  testResults: Record<string, McpTestResult>
  /** The server name whose probe is in flight, or null. */
  testingName: string | null
  /** The server name whose toggle/remove is in flight, or null. */
  mutatingName: string | null
  /** Restart the gateway to apply config changes (the shared Maintenance restart). */
  onRestart: () => void
  /** Whether a gateway restart is currently in flight. */
  restarting: boolean
}

export function McpPage({
  state,
  onAdd,
  adding,
  onToggle,
  onRemove,
  onTest,
  testResults,
  testingName,
  mutatingName,
  onRestart,
  restarting,
}: McpPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={Blocks}
        title="Integrations (MCP)"
        subtitle="Tools and data sources your agent can reach (Model Context Protocol), things like searching the web, reading files from a service, or managing tasks. Add one here, test it, then restart your agent to activate it."
        actions={
          <Button variant="outline" size="sm" disabled={restarting} onClick={onRestart}>
            {restarting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Restarting…
              </>
            ) : (
              <>
                <RefreshCw aria-hidden />
                Restart your agent
              </>
            )}
          </Button>
        }
      />

      <section aria-labelledby="mcp-configured" className="flex flex-col gap-4">
        <h2 id="mcp-configured" className="sr-only">
          Configured servers
        </h2>
        {state.servers.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No tool servers configured"
            description="Add a custom server below if you know its URL or command, or copy an install command from the catalog."
          />
        ) : (
          state.servers.map((server) => (
            <McpServerCard
              key={server.name}
              server={server}
              onToggle={(enabled) => onToggle(server.name, enabled)}
              onRemove={() => onRemove(server.name)}
              onTest={() => onTest(server.name)}
              testResult={testResults[server.name]}
              testing={testingName === server.name}
              mutating={mutatingName === server.name}
            />
          ))
        )}
      </section>

      <div className="mt-4">
        <AddMcpServerForm onAdd={onAdd} submitting={adding} />
      </div>

      {state.catalog.length > 0 ? (
        <section aria-labelledby="mcp-catalog" className="mt-10 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Library className="size-[18px] text-foreground-tertiary" aria-hidden />
            <h2 id="mcp-catalog" className="font-heading text-lg font-medium text-foreground">
              Ready-to-use integrations
            </h2>
          </div>
          <p className="-mt-2 max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">
            Ready-to-use integrations that come with Hermes. To install one, copy the command and
            run it in your terminal. Sign-in and setup steps happen there, not here.
          </p>
          {state.catalog.map((entry) => (
            <McpCatalogCard key={entry.name} entry={entry} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

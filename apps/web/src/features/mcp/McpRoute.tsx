import { useState } from 'react'
import { Blocks, Loader2 } from 'lucide-react'
import type { AddMcpServerRequest, McpTestResult } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { useRestartGateway } from '@/features/system/useSystem'
import { McpPage } from './McpPage'
import {
  useMcp,
  useRefreshMcp,
  useAddMcpServer,
  useToggleMcpServer,
  useRemoveMcpServer,
  useTestMcpServer,
} from './useMcp'

/**
 * Route element for the MCP Server Manager (`/mcp`). Bridges the `useMcp` read to
 * the presentational {@link McpPage} and owns the honest mutations:
 *
 *  - Add / Toggle / Remove → config writes (the BFF writes the mcp_servers slice);
 *    each returns the refreshed state + `restartRequired`, so the toast prompts
 *    the restart rather than faking a connected state.
 *  - Test → the REAL probe (a one-shot connect listing tools, NOT a persisted
 *    connection); the result is stashed per-server for its card.
 *  - Restart → REUSES the Maintenance dock's `useRestartGateway` (the one real
 *    restart), then RE-READS the MCP state.
 *
 * No action fakes a state.
 */
export function McpRoute() {
  const query = useMcp()
  const add = useAddMcpServer()
  const toggle = useToggleMcpServer()
  const remove = useRemoveMcpServer()
  const test = useTestMcpServer()
  const restart = useRestartGateway()
  const refreshMcp = useRefreshMcp()

  // Per-server probe results + the in-flight server names (the page reads these
  // to show the right card's spinner / result without a shared store).
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({})
  const [testingName, setTestingName] = useState<string | null>(null)
  const [mutatingName, setMutatingName] = useState<string | null>(null)
  // The server awaiting destructive confirmation (null = the dialog is closed).
  // A real config edit shouldn't fire on a single click, so removal routes
  // through the app's themed ConfirmDialog (focus-trap + ARIA + reduced-motion),
  // never a raw browser `window.confirm`.
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)

  const onAdd = (request: AddMcpServerRequest) => {
    add.mutate(request, {
      onSuccess: () => {
        setAddFormKey((k) => k + 1)
        toast.success('Server added', {
          description: 'Restart your agent to load its tools.',
        })
      },
      onError: (err) =>
        toast.error('Couldn’t add the server', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  const onToggle = (name: string, enabled: boolean) => {
    setMutatingName(name)
    toggle.mutate(
      { name, enabled },
      {
        onSuccess: () =>
          toast.success(enabled ? 'Server enabled' : 'Server disabled', {
            description: 'Restart your agent to apply.',
          }),
        onError: (err) =>
          toast.error('Couldn’t update the server', {
            description: err instanceof Error ? err.message : 'Please try again.',
          }),
        onSettled: () => setMutatingName(null),
      },
    )
  }

  // The page is presentational; the explicit confirm lives here (a real
  // destructive action shouldn't fire on a single click). Requesting a remove
  // opens the themed dialog; the actual DELETE only fires on confirm.
  const onRemove = (name: string) => setPendingRemove(name)

  const confirmRemove = () => {
    const name = pendingRemove
    if (!name) return
    setPendingRemove(null)
    setMutatingName(name)
    remove.mutate(name, {
      onSuccess: () => {
        setTestResults((prev) => {
          const next = { ...prev }
          delete next[name]
          return next
        })
        toast.success('Server removed', { description: 'Restart your agent to apply.' })
      },
      onError: (err) =>
        toast.error('Couldn’t remove the server', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
      onSettled: () => setMutatingName(null),
    })
  }

  const onTest = (name: string) => {
    setTestingName(name)
    test.mutate(name, {
      onSuccess: (result) => {
        setTestResults((prev) => ({ ...prev, [name]: result }))
        if (!result.ok) {
          toast.warning('Probe failed', {
            description: result.error ?? 'The server could not be reached.',
          })
        }
      },
      onError: (err) =>
        toast.error('Couldn’t run the probe', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
      onSettled: () => setTestingName(null),
    })
  }

  const onRestart = () => {
    restart.mutate(undefined, {
      onSuccess: (state) => {
        refreshMcp()
        if (state.status === 'running') {
          toast.success('Gateway restarted', {
            description: 'Your MCP changes are now live.',
          })
        } else {
          toast.warning('Gateway restarted', {
            description: `It is reporting "${state.status}". Check the System surface.`,
          })
        }
      },
      onError: (err) =>
        toast.error('Couldn’t restart your agent', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  if (query.status === 'pending') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader
          icon={Blocks}
          title="Integrations (MCP)"
          subtitle="Tools and data sources your agent can reach (Model Context Protocol)."
        />
        <div className="flex flex-col gap-4" aria-hidden data-testid="mcp-skeleton">
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
        <PageHeader icon={Blocks} title="Integrations (MCP)" />
        <ErrorState
          icon={Blocks}
          title="Couldn’t load tool servers"
          description="Agentdeck couldn’t read your MCP configuration. Chat can continue without this tool view."
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  return (
    <>
      <McpPage
        state={query.data}
        onAdd={onAdd}
        adding={add.isPending}
        addFormKey={addFormKey}
        onToggle={onToggle}
        onRemove={onRemove}
        onTest={onTest}
        testResults={testResults}
        testingName={testingName}
        mutatingName={mutatingName}
        onRestart={onRestart}
        restarting={restart.isPending}
      />
      <RemoveServerDialog
        name={pendingRemove}
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </>
  )
}

/**
 * The themed remove confirm — the app's Dialog primitive (focus-trap + ARIA +
 * reduced-motion for free), matching how SystemPage/SessionList confirm a
 * destructive action. Cancel is the default-focused action (cancel-default) so a
 * reflexive Enter never edits the config; only the explicit Remove button fires.
 */
function RemoveServerDialog({
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(next) => {
        // Any close path (overlay / Escape / X) cancels — never removes — and is
        // ignored while a remove is in flight.
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Remove this server?</DialogTitle>
          <DialogDescription>
            {name ? (
              <>
                “{name}” will be removed from your Hermes config. Restart your agent to apply. You
                can add it again later.
              </>
            ) : (
              <>This server will be removed from your Hermes config.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          {/* Cancel is the default-focused, default action (cancel-default). */}
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * WebhooksTab — list / create / enable-disable / delete inbound webhook subscriptions.
 *
 * Maps onto the real stock hermes webhook routes (web_server.py:4712–4814):
 *  - GET  /api/webhooks        → list (secret never in list)
 *  - POST /api/webhooks        → create (secret shown ONCE, then redacted)
 *  - DELETE /api/webhooks/{n}  → delete
 *  - PUT /api/webhooks/{n}/enabled → enable/disable (hot-reload, no restart)
 *
 * Secret policy: the HMAC secret surfaces once in a highlighted reveal panel
 * immediately after create. Closing the panel discards it; it can never be
 * retrieved again (secret_set: bool only on subsequent reads). We make that
 * explicit in the UI copy.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  Info,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react'
import type { CreatedWebhookResponse, WebhookSub } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
  isUnsupportedError,
} from './connectionsApi'

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handle = useCallback(() => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }, [value])
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handle}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      title={label ? `Copy ${label}` : 'Copy'}
    >
      {copied ? (
        <Check className="size-4 text-primary" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </Button>
  )
}

// ── SecretReveal ──────────────────────────────────────────────────────────────

function SecretReveal({
  created,
  onClose,
}: {
  created: CreatedWebhookResponse
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  return (
    <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">Subscription created. Copy the secret now.</p>
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Dismiss secret reveal"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        This is the only time the HMAC secret is shown. Store it safely before closing; it cannot be
        retrieved later.
      </p>

      <div className="mb-2 flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Webhook URL</span>
        <div className="flex items-center gap-2 rounded-lg bg-background/60 px-3 py-2 font-mono text-xs">
          <span className="min-w-0 flex-1 truncate">{created.url}</span>
          <CopyButton value={created.url} label="URL" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">HMAC secret (shown once)</span>
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-background/60 px-3 py-2 font-mono text-xs">
          <span className="min-w-0 flex-1 truncate">{created.secret}</span>
          <CopyButton value={created.secret} label="secret" />
        </div>
      </div>
    </div>
  )
}

// ── CreateModal ───────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void
  onCreated: (created: CreatedWebhookResponse) => void
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState('')
  const [deliver, setDeliver] = useState('log')
  const [prompt, setPrompt] = useState('')
  const [deliverOnly, setDeliverOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createM = useMutation({
    mutationFn: createWebhook,
    onSuccess: (res) => {
      onCreated(res)
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Create failed')
    },
  })

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    const eventsList = events
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    createM.mutate({
      name: trimmed,
      description: description.trim() || undefined,
      events: eventsList.length ? eventsList : undefined,
      deliver,
      deliver_only: deliverOnly || undefined,
      prompt: prompt.trim() || undefined,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !createM.isPending) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New subscription</DialogTitle>
          <DialogDescription>
            Receive an inbound event and run an agent action when it fires.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wh-name" className="text-sm font-medium">
              Name{' '}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </label>
            <Input
              id="wh-name"
              autoFocus
              placeholder="e.g. github-push"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wh-desc" className="text-sm font-medium">
              Description
            </label>
            <Input
              id="wh-desc"
              placeholder="What this webhook handles (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wh-events" className="text-sm font-medium">
              Events
            </label>
            <Input
              id="wh-events"
              placeholder="comma-separated, leave empty for all"
              value={events}
              onChange={(e) => setEvents(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wh-deliver" className="text-sm font-medium">
                Deliver to
              </label>
              <select
                id="wh-deliver"
                className="ad-surface h-10 w-full rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ad-focus"
                value={deliver}
                onChange={(e) => setDeliver(e.target.value)}
              >
                <option value="log">Log</option>
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="email">Email</option>
                <option value="github_comment">GitHub comment</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Deliver only</span>
              <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={deliverOnly}
                  onChange={(e) => setDeliverOnly(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Skip the agent
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wh-prompt" className="text-sm font-medium">
              Prompt
            </label>
            <textarea
              id="wh-prompt"
              className="ad-surface min-h-[72px] w-full rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus"
              placeholder="Agent instructions when this webhook fires (optional)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={createM.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={createM.isPending}>
              {createM.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {createM.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── WebhookCard ───────────────────────────────────────────────────────────────

interface WebhookCardProps {
  sub: WebhookSub
  onDelete: (name: string) => void
  onToggle: (name: string, enabled: boolean) => void
  toggling: boolean
  deleting: boolean
}

function WebhookCard({ sub, onDelete, onToggle, toggling, deleting }: WebhookCardProps) {
  return (
    <div
      className={cn(
        'ad-surface ad-raised rounded-xl bg-card px-4 py-3',
        !sub.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-medium">{sub.name}</span>
            <Badge variant="outline">{sub.deliver}</Badge>
            {sub.deliver_only && <Badge variant="secondary">deliver only</Badge>}
            {!sub.enabled && <Badge variant="secondary">disabled</Badge>}
          </div>

          {sub.description && (
            <p className="mb-2 text-xs text-muted-foreground">{sub.description}</p>
          )}

          <div className="mb-2 flex flex-wrap gap-1">
            {sub.events.length === 0 ? (
              <Badge variant="secondary">(all events)</Badge>
            ) : (
              sub.events.map((evt) => (
                <Badge key={evt} variant="secondary">
                  {evt}
                </Badge>
              ))
            )}
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate font-mono">{sub.url}</span>
            <CopyButton value={sub.url} label="URL" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={toggling}
            onClick={() => onToggle(sub.name, !sub.enabled)}
            aria-label={sub.enabled ? `Disable ${sub.name}` : `Enable ${sub.name}`}
          >
            {toggling ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {sub.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            disabled={deleting}
            onClick={() => onDelete(sub.name)}
            aria-label={`Delete ${sub.name}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── WebhooksTab ───────────────────────────────────────────────────────────────

export function WebhooksTab() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [justCreated, setJustCreated] = useState<CreatedWebhookResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [togglingName, setTogglingName] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['webhooks'],
    queryFn: ({ signal }) => fetchWebhooks(signal),
    staleTime: 30_000,
    retry: (count, err) => !isUnsupportedError(err) && count < 2,
  })
  const unsupported = isError && isUnsupportedError(error)

  const deleteM = useMutation({
    mutationFn: deleteWebhook,
    onSuccess: () => {
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['webhooks'] })
    },
  })

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      setTogglingName(name)
      try {
        await setWebhookEnabled(name, enabled)
        qc.invalidateQueries({ queryKey: ['webhooks'] })
      } finally {
        setTogglingName(null)
      }
    },
    [qc],
  )

  const enabled = data?.enabled ?? false
  const subs = data?.subscriptions ?? []

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={Webhook}
        title="Webhooks"
        subtitle="Receive inbound HTTP events and run agent actions. The gateway hot-reloads subscription changes; no restart needed to enable or disable."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!enabled}
              onClick={() => {
                setJustCreated(null)
                setCreateOpen(true)
              }}
              title={
                !enabled
                  ? 'Enable the webhook platform in your Hermes gateway config first'
                  : undefined
              }
            >
              <Plus className="size-4" aria-hidden />
              New subscription
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              aria-label="Refresh webhooks"
            >
              <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        }
      />

      {unsupported && (
        <EmptyState
          icon={Info}
          title="Webhooks aren’t available on this Hermes version"
          description="This Hermes build doesn’t serve the webhook routes. Update Hermes to manage inbound webhooks here."
        />
      )}

      {isError && !unsupported && (
        <ErrorState
          icon={AlertCircle}
          title="Couldn’t load webhooks"
          description="Your Hermes may be offline, or this build may not support webhooks."
          onRetry={() => refetch()}
        />
      )}

      {/* One-time secret reveal after create */}
      {justCreated && <SecretReveal created={justCreated} onClose={() => setJustCreated(null)} />}

      {/* Create modal */}
      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false)
            setJustCreated(created)
            qc.invalidateQueries({ queryKey: ['webhooks'] })
          }}
        />
      )}

      {/* Delete confirm */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next && !deleteM.isPending) setDeleteTarget(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete webhook</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget}" will be permanently removed.` : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteM.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteM.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteM.mutate(deleteTarget)}
            >
              {deleteM.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Initial load: a calm skeleton (matching the other surfaces) instead of
          a blank body until the first read settles. */}
      {!unsupported && isLoading && <WebhooksSkeleton />}

      {!unsupported && !enabled && !isLoading && (
        <div className="ad-surface mb-4 flex items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm">
          <Webhook className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <span className="font-medium">Webhook platform disabled.</span>{' '}
            <span className="text-muted-foreground">
              Enable it in your Hermes gateway config before creating subscriptions.
            </span>
          </div>
        </div>
      )}

      {unsupported ? null : subs.length === 0 && !isLoading ? (
        <EmptyState
          icon={Webhook}
          title="No webhook subscriptions"
          description={
            enabled
              ? 'Create a subscription to receive inbound events and run agent actions.'
              : 'Enable the webhook platform in your Hermes gateway config to create subscriptions.'
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {subs.map((sub) => (
            <WebhookCard
              key={sub.name}
              sub={sub}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
              toggling={togglingName === sub.name}
              deleting={deleteM.isPending && deleteM.variables === sub.name}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Initial-load placeholder using the same calm shimmer-card vocabulary the
 *  other surfaces use (Jobs/Files), so a first load reads as "loading" not a
 *  blank body. Decorative (aria-hidden rows) under a polite status label. */
function WebhooksSkeleton() {
  return (
    <div role="status" aria-live="polite" data-testid="webhooks-skeleton">
      <span className="sr-only">Loading webhooks</span>
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="ad-surface ad-raised h-[92px] animate-pulse rounded-xl bg-surface-2/60 motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  )
}

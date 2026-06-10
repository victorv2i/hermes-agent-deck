/**
 * CredentialsTab — manage the rotating API-key credential pool per provider.
 *
 * Maps onto the real stock hermes credential pool routes (web_server.py:4884–4959):
 *  - GET  /api/credentials/pool           → redacted list per provider
 *  - POST /api/credentials/pool           → add a key (write-only)
 *  - DELETE /api/credentials/pool/{p}/{i} → remove by 1-based index
 *
 * Secret policy: api_key is write-only — it is sent once to add the entry and
 * is NEVER echoed back. The list shows only token_preview (stock's own masked
 * preview, e.g. "sk-...abc4") + label. No plaintext ever appears in the UI.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2, RefreshCw, AlertCircle, Info, Loader2 } from 'lucide-react'
import type { PoolEntry, PoolProvider } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  fetchCredentialPool,
  addCredential,
  removeCredential,
  isUnsupportedError,
} from './connectionsApi'

// ── AddCredentialModal ────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void
  onAdded: () => void
}

function AddCredentialModal({ onClose, onAdded }: AddModalProps) {
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const addM = useMutation({
    mutationFn: addCredential,
    onSuccess: () => {
      onAdded()
      onClose()
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Add failed')
    },
  })

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setError(null)
    const p = provider.trim()
    const k = apiKey.trim()
    if (!p) {
      setError('Provider is required')
      return
    }
    if (!k) {
      setError('API key is required')
      return
    }
    addM.mutate({ provider: p, api_key: k, label: label.trim() || undefined })
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !addM.isPending) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add API key</DialogTitle>
          <DialogDescription>
            The key is stored securely and shown only as a masked preview after saving. It cannot be
            retrieved; keep it in your password manager.
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
            <label htmlFor="cred-provider" className="text-sm font-medium">
              Provider{' '}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </label>
            <Input
              id="cred-provider"
              autoFocus
              placeholder="e.g. openai, anthropic, gemini"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cred-key" className="text-sm font-medium">
              API key{' '}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </label>
            <Input
              id="cred-key"
              type="password"
              autoComplete="new-password"
              className="font-mono"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cred-label" className="text-sm font-medium">
              Label
            </label>
            <Input
              id="cred-label"
              placeholder="e.g. personal key (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={addM.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={addM.isPending}>
              {addM.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {addM.isPending ? 'Adding...' : 'Add key'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── ProviderSection ───────────────────────────────────────────────────────────

interface ProviderSectionProps {
  provider: PoolProvider
  onRemove: (provider: string, index: number) => void
  removingKey: string | null
}

function ProviderSection({ provider, onRemove, removingKey }: ProviderSectionProps) {
  return (
    <div className="ad-surface rounded-xl bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold capitalize">{provider.provider}</h3>
      </div>
      <ul className="divide-y divide-border">
        {provider.entries.map((entry: PoolEntry) => {
          const rKey = `${provider.provider}:${entry.index}`
          const isRemoving = removingKey === rKey
          return (
            <li key={entry.index} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {entry.label && <span className="text-sm font-medium">{entry.label}</span>}
                  {entry.token_preview && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.token_preview}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {entry.auth_type && <Badge variant="outline">{entry.auth_type}</Badge>}
                  {entry.source && <span>via {entry.source}</span>}
                  {entry.request_count != null && (
                    <span>
                      {entry.request_count} request{entry.request_count !== 1 ? 's' : ''}
                    </span>
                  )}
                  {entry.last_status && <span>status: {entry.last_status}</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'shrink-0 text-destructive hover:text-destructive',
                  isRemoving && 'opacity-50',
                )}
                disabled={isRemoving}
                onClick={() => onRemove(provider.provider, entry.index)}
                aria-label={`Remove key ${entry.index} from ${provider.provider}`}
              >
                {isRemoving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── CredentialsTab ────────────────────────────────────────────────────────────

export function CredentialsTab() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['credentials-pool'],
    queryFn: ({ signal }) => fetchCredentialPool(signal),
    staleTime: 60_000,
    retry: (count, err) => !isUnsupportedError(err) && count < 2,
  })
  const unsupported = isError && isUnsupportedError(error)

  const providers = data?.providers ?? []

  const handleRemove = async (provider: string, index: number) => {
    const key = `${provider}:${index}`
    setRemovingKey(key)
    try {
      await removeCredential(provider, index)
      qc.invalidateQueries({ queryKey: ['credentials-pool'] })
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={KeyRound}
        title="Credential Pool"
        subtitle="Rotating API keys the agent round-robins through per provider. Keys are stored by Hermes and shown here as masked previews only; the plaintext is never displayed."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add key
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              aria-label="Refresh credential pool"
            >
              <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        }
      />

      {unsupported && (
        <EmptyState
          icon={Info}
          title="The credential pool isn’t available on this Hermes version"
          description="This Hermes build doesn’t serve the credential pool routes. Update Hermes to manage rotating API keys here."
        />
      )}

      {isError && !unsupported && (
        <div className="ad-surface mb-4 rounded-xl bg-card px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load credentials. Your Hermes may be offline, or this build may not support
          the credential pool.
        </div>
      )}

      {addOpen && (
        <AddCredentialModal
          onClose={() => setAddOpen(false)}
          onAdded={() => qc.invalidateQueries({ queryKey: ['credentials-pool'] })}
        />
      )}

      {unsupported ? null : providers.length === 0 && !isLoading ? (
        <EmptyState
          icon={KeyRound}
          title="No credential pool entries"
          description="Add an API key to let the agent round-robin through multiple keys per provider."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((p) => (
            <ProviderSection
              key={p.provider}
              provider={p}
              onRemove={handleRemove}
              removingKey={removingKey}
            />
          ))}
        </div>
      )}
    </div>
  )
}

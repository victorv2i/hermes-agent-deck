/**
 * PairingTab — list pending + approved pairing users, approve/revoke/clear-pending.
 *
 * Maps 1:1 onto the real stock hermes pairing surface (web_server.py:4620–4669):
 *  - GET  /api/pairing → pending list + approved list
 *  - POST /api/pairing/approve  { platform, code }
 *  - POST /api/pairing/revoke   { platform, user_id }
 *  - POST /api/pairing/clear-pending
 *
 * Honest states only: approve is disabled when the entry has no code; the
 * "Revoke" confirm describes the real user by name where available. No fake
 * states, no polling — manual refresh via the header button.
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Info,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  X,
  Loader2,
} from 'lucide-react'
import type { PairingUser } from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  fetchPairing,
  approvePairing,
  revokePairing,
  clearPendingPairing,
  isUnsupportedError,
} from './connectionsApi'

function userLabel(u: PairingUser): string {
  return u.user_name ?? u.user_id
}

function userKey(u: PairingUser): string {
  return `${u.platform}:${u.user_id}`
}

export function PairingTab() {
  const qc = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<PairingUser | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pairing'],
    queryFn: ({ signal }) => fetchPairing(signal),
    staleTime: 30_000,
    // A 404 "unsupported" is a permanent version-skew signal, not a transient
    // outage — don't burn retries on it.
    retry: (count, err) => !isUnsupportedError(err) && count < 2,
  })
  const unsupported = isError && isUnsupportedError(error)

  const approveM = useMutation({
    mutationFn: approvePairing,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pairing'] }),
  })

  const revokeM = useMutation({
    mutationFn: revokePairing,
    onSuccess: () => {
      setRevokeTarget(null)
      qc.invalidateQueries({ queryKey: ['pairing'] })
    },
  })

  const clearM = useMutation({
    mutationFn: clearPendingPairing,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pairing'] }),
  })

  const handleApprove = useCallback(
    (u: PairingUser) => {
      if (!u.code) return
      approveM.mutate({ platform: u.platform, code: u.code })
    },
    [approveM],
  )

  const handleRevoke = useCallback(
    (u: PairingUser) => {
      revokeM.mutate({ platform: u.platform, user_id: u.user_id })
    },
    [revokeM],
  )

  const pending = data?.pending ?? []
  const approved = data?.approved ?? []

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={Shield}
        title="Pairing"
        subtitle="Approve users who sent a pairing code from a connected messaging platform, or revoke access from approved users."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={clearM.isPending || pending.length === 0}
              onClick={() => clearM.mutate()}
              aria-label="Clear all pending requests"
            >
              {clearM.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
              Clear pending
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              aria-label="Refresh pairing list"
            >
              <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        }
      />

      {unsupported && (
        <EmptyState
          icon={Info}
          title="Pairing isn’t available on this Hermes version"
          description="This Hermes build doesn’t serve the pairing routes. Update Hermes, or pair devices from the CLI."
        />
      )}

      {isError && !unsupported && (
        <div className="ad-surface mb-4 rounded-xl bg-card px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load pairing. Your Hermes may be offline, or this build may not support
          device pairing.
        </div>
      )}

      {/* Revoke confirm dialog */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next && !revokeM.isPending) setRevokeTarget(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke access</DialogTitle>
            <DialogDescription>
              {revokeTarget
                ? `"${userLabel(revokeTarget)}" will lose access. This cannot be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeM.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={revokeM.isPending || !revokeTarget}
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              {revokeM.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Revoke
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending requests */}
      {!unsupported && (
        <section className="mb-8" aria-labelledby="pending-heading">
          <h2
            id="pending-heading"
            className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"
          >
            <Users className="size-4" aria-hidden />
            Pending requests ({pending.length})
          </h2>

          {pending.length === 0 && !isLoading ? (
            <EmptyState
              icon={Users}
              title="No pending requests"
              description="When a user sends a pairing code, they appear here for approval."
            />
          ) : null}

          <ul className="flex flex-col gap-2" aria-label="Pending pairing requests">
            {pending.map((u) => {
              const key = userKey(u)
              const isApproving = approveM.isPending && approveM.variables?.code === u.code
              return (
                <li
                  key={key}
                  className="ad-surface flex items-start gap-4 rounded-xl bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{u.platform}</Badge>
                      {u.code && (
                        <span className="font-mono text-sm font-semibold tracking-widest">
                          {u.code}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{u.user_id}</span>
                      {u.user_name && <span className="truncate">{u.user_name}</span>}
                      {typeof u.age_minutes === 'number' && <span>{u.age_minutes}m ago</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={isApproving || !u.code}
                    onClick={() => handleApprove(u)}
                    aria-label={`Approve ${userLabel(u)}`}
                  >
                    {isApproving ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Approve
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Approved users */}
      {!unsupported && (
        <section aria-labelledby="approved-heading">
          <h2
            id="approved-heading"
            className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"
          >
            <ShieldCheck className="size-4" aria-hidden />
            Approved users ({approved.length})
          </h2>

          {approved.length === 0 && !isLoading ? (
            <EmptyState
              icon={ShieldCheck}
              title="No approved users"
              description="Approved users can interact with your agent from their connected platform."
            />
          ) : null}

          <ul className="flex flex-col gap-2" aria-label="Approved pairing users">
            {approved.map((u) => (
              <li
                key={userKey(u)}
                className="ad-surface flex items-start gap-4 rounded-xl bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{u.platform}</Badge>
                    <span className="truncate text-sm font-medium">{u.user_id}</span>
                  </div>
                  {u.user_name && (
                    <div className="truncate text-xs text-muted-foreground">{u.user_name}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setRevokeTarget(u)}
                  aria-label={`Revoke access for ${userLabel(u)}`}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

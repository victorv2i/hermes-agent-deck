/**
 * ERR-01 — unified "session expired" surface.
 *
 * Shown when ANY /api call returns 401 (token missing/expired on a FORCE_AUTH/
 * remote deploy). Reuses the AuthGate visual pattern: same card, same copy
 * style, same unlock form — so the user experiences one consistent credential-
 * entry screen regardless of whether they're unlocking for the first time or
 * re-entering after expiry.
 *
 * On submit:
 *  1. Verify the new token via the /auth/check probe.
 *  2. If accepted: save it, clear the expired signal, call onCleared().
 *  3. If rejected: show an error without looping (the check probe itself never
 *     triggers signalSessionExpired because verifyAuthToken uses raw fetch, not
 *     apiFetch).
 */
import { type FormEvent, useState } from 'react'
import { KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clearSessionExpired } from './sessionExpired'
import { setAuthToken } from './authToken'
import { verifyAuthToken } from './authToken'

export interface SessionExpiredScreenProps {
  /** Called after the user successfully re-enters a token and the session is restored. */
  onCleared?: () => void
}

export function SessionExpiredScreen({ onCleared }: SessionExpiredScreenProps) {
  const [candidate, setCandidate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = candidate.trim()
    if (!trimmed) {
      setError('Enter the access token from the server console.')
      return
    }
    setSubmitting(true)
    setError(null)
    const ok = await verifyAuthToken(trimmed)
    setSubmitting(false)
    if (!ok) {
      setError('Token rejected. Check the server console and try again.')
      return
    }
    setAuthToken(trimmed)
    clearSessionExpired()
    onCleared?.()
  }

  return (
    <main
      data-testid="session-expired"
      className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground"
    >
      <section className="ad-surface w-full max-w-md rounded-lg border border-border bg-surface-1 p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground-tertiary">
            <RefreshCw className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-normal">Session expired</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Your access token is no longer valid. Re-enter it to continue.
            </p>
          </div>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Access token</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              aria-invalid={error ? true : undefined}
              autoFocus
            />
          </label>
          {error ? <p className="text-sm leading-relaxed text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full gap-2" disabled={submitting}>
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="size-4" aria-hidden />
            )}
            Re-enter access token
          </Button>
        </form>
      </section>
    </main>
  )
}

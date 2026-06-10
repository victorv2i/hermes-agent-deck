import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from 'react'
import { KeyRound, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchHealth } from './api'
import {
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  subscribeAuthToken,
  verifyAuthToken,
} from './authToken'

/**
 * AuthGate — blocks the app shell only when the public health probe says the BFF
 * is bearer-token gated. The access token is never injected into HTML; remote
 * users enter the operator token once, then the browser stores it locally.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['health', 'bind'],
    queryFn: fetchHealth,
    staleTime: Infinity,
    retry: false,
  })
  const savedToken = useSyncExternalStore(subscribeAuthToken, getAuthToken, getAuthToken)
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [candidate, setCandidate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const authRequired = data?.bind.authRequired === true
  const savedTokenCheck = useQuery({
    queryKey: ['auth', 'check', savedToken],
    queryFn: () => verifyAuthToken(savedToken ?? ''),
    enabled: authRequired && Boolean(savedToken) && verifiedToken !== savedToken,
    retry: false,
  })
  const savedTokenAccepted =
    Boolean(savedToken) && (verifiedToken === savedToken || savedTokenCheck.data === true)
  const savedTokenChecking = Boolean(savedToken) && !savedTokenAccepted && savedTokenCheck.isLoading
  const savedTokenRejected = Boolean(savedToken) && savedTokenCheck.data === false

  if (!data && isLoading) return <AuthShell message="Checking Agent Deck access..." />
  // If the public health probe is unreachable, fail open. The rest of the app
  // still cannot use gated APIs without a valid token, and the shell carries no
  // credential to leak.
  if (!data && isError) return <>{children}</>
  if (!authRequired) return <>{children}</>
  if (savedTokenAccepted) return <>{children}</>
  if (savedTokenChecking) return <AuthShell message="Verifying saved access token..." />

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
      clearAuthToken()
      setVerifiedToken(null)
      setError('Token rejected. Check the server console and try again.')
      return
    }
    setVerifiedToken(trimmed)
    setAuthToken(trimmed)
    setCandidate('')
  }

  const shownError =
    error ??
    (savedTokenRejected ? 'That saved token was rejected. Enter the current access token.' : null)

  return (
    <main
      data-testid="auth-gate"
      className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground"
    >
      <section className="ad-surface w-full max-w-md rounded-lg border border-border bg-surface-1 p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground-tertiary">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-normal">Agent Deck is locked</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Enter the access token printed in the server console.
            </p>
          </div>
        </div>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-relaxed text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {data?.bind.remote
              ? 'Remote/proxy mode is active. Anyone who can reach this server still needs the token.'
              : 'This local session is configured to require a token.'}
          </p>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Access token</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              aria-invalid={shownError ? true : undefined}
              autoFocus
            />
          </label>
          {shownError ? (
            <p className="text-sm leading-relaxed text-destructive">{shownError}</p>
          ) : null}
          <Button type="submit" className="w-full gap-2" disabled={submitting}>
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="size-4" aria-hidden />
            )}
            Unlock Agent Deck
          </Button>
        </form>
      </section>
    </main>
  )
}

function AuthShell({ message }: { message: string }) {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {message}
      </div>
    </main>
  )
}

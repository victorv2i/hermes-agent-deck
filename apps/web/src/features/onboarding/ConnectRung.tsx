import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { cancelProviderOAuth, pollProviderOAuth, startProviderOAuth } from '@/features/models/api'
import { ProviderBrandIcon } from '@/features/models/providerBrandIcons'
import { PROVIDER_CATALOG, providerSupports } from '@/features/models/providerCatalog'
import {
  PROVIDER_OAUTH_FALLBACK_COPY,
  PROVIDER_OAUTH_POPUP_COPY,
  providerOAuthErrorMessage,
} from '@/features/models/providerOAuthCopy'
import type { ProviderCatalogEntry, ProviderOAuthSession } from '@/features/models/types'
import { RungChrome } from './RungChrome'
import { connectProviderKey, maskKey } from './providerKey'

const PROVIDER_CHOICES = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google AI Studio', value: 'gemini' },
  { label: 'xAI', value: 'xai' },
  { label: 'Other', value: 'other' },
] as const

const OAUTH_PROVIDER_CHOICES = PROVIDER_CATALOG.filter(
  (entry): entry is ProviderCatalogEntry & { slug: string } =>
    providerSupports(entry, 'oauth') && typeof entry.slug === 'string',
)
const DEFAULT_OAUTH_PROVIDER = OAUTH_PROVIDER_CHOICES[0]?.slug ?? 'nous'
const DEFAULT_POLL_MS = 2500

type OAuthPhase = 'idle' | 'starting' | 'waiting' | 'connected' | 'error' | 'cancelled'

interface OAuthState {
  phase: OAuthPhase
  session?: ProviderOAuthSession
  error?: string
}

function providerLabel(value: string): string {
  return (
    PROVIDER_CHOICES.find((choice) => choice.value === value)?.label ??
    PROVIDER_CATALOG.find((entry) => entry.slug === value)?.label ??
    value
  )
}

/**
 * Rung 2 - Connect. The recommended path is browser sign-in through Hermes'
 * stock provider OAuth routes; Agentdeck opens the returned URL and polls the
 * returned session id when Hermes supplies one. Below it, an expandable API-key
 * path the BFF can drive (`hermes auth add <provider> --type api-key --api-key`,
 * masked + argv-scrubbed server-side). Continue is disabled until the REAL probe
 * reports a usable model connected.
 */
export function ConnectRung({
  connected,
  rechecking,
  onRecheck,
  onConnected,
  onContinue,
  onBack,
  onSkip,
}: {
  connected: boolean
  rechecking: boolean
  onRecheck: () => void
  /** Called after a successful API-key add so the gate re-probes immediately. */
  onConnected: () => void
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const [oauthProvider, setOauthProvider] = useState(DEFAULT_OAUTH_PROVIDER)
  const selectedOAuthProvider = useMemo(
    () =>
      OAUTH_PROVIDER_CHOICES.find((entry) => entry.slug === oauthProvider) ??
      OAUTH_PROVIDER_CHOICES[0],
    [oauthProvider],
  )
  const [oauth, setOauth] = useState<OAuthState>({ phase: 'idle' })
  const [keyOpen, setKeyOpen] = useState(false)
  const [providerChoice, setProviderChoice] = useState('')
  const [customProvider, setCustomProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reveal, setReveal] = useState(false)
  const providerId = useId()
  const customProviderId = useId()
  const providerHintId = useId()
  const keyId = useId()
  const keyHintId = useId()

  const selectedProvider = providerChoice === 'other' ? customProvider.trim() : providerChoice
  const canSubmit = selectedProvider.length > 0 && apiKey.trim().length > 0 && !submitting
  const oauthBusy = oauth.phase === 'starting' || oauth.phase === 'waiting'

  // Keep the latest onConnected reachable WITHOUT making the poll effect depend
  // on its identity — a parent re-render passing a new callback must not cancel
  // and restart the in-flight poll timer.
  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  useEffect(() => {
    const session = oauth.session
    if (oauth.phase !== 'waiting' || !session?.sessionId) return undefined

    let stopped = false
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      try {
        const next = await pollProviderOAuth(
          session.provider,
          session.sessionId!,
          controller.signal,
        )
        if (stopped) return
        const merged = mergeOAuthSession(session, next)
        if (merged.status === 'connected') onConnectedRef.current()
        setOauth((current) => {
          if (current.session?.sessionId !== session.sessionId) return current
          if (merged.status === 'connected') {
            return { phase: 'connected', session: merged }
          }
          if (merged.status === 'failed') {
            return {
              phase: 'error',
              session: merged,
              error: merged.message || 'Hermes reported that sign-in did not finish.',
            }
          }
          if (merged.status === 'cancelled') return { phase: 'cancelled', session: merged }
          return { phase: 'waiting', session: merged }
        })
      } catch (err) {
        if (stopped || isAbortError(err)) return
        setOauth((current) => ({
          ...current,
          phase: 'error',
          error: providerOAuthErrorMessage(err, 'Could not check the sign-in status.'),
        }))
      }
    }, session.pollIntervalMs ?? DEFAULT_POLL_MS)

    return () => {
      stopped = true
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [oauth.phase, oauth.session])

  async function launchOAuth() {
    const provider = oauthProvider.trim()
    if (!provider || oauth.phase === 'starting') return
    setOauth({ phase: 'starting' })
    try {
      const session = await startProviderOAuth(provider)
      if (session.url) openLaunchUrl(session.url)
      if (session.status === 'connected') {
        setOauth({ phase: 'connected', session })
        onConnected()
        return
      }
      if (session.status === 'failed') {
        setOauth({
          phase: 'error',
          session,
          error: session.message || 'Hermes could not start provider sign-in.',
        })
        return
      }
      setOauth({ phase: 'waiting', session })
    } catch (err) {
      setOauth({
        phase: 'error',
        error: providerOAuthErrorMessage(err, 'Hermes could not start provider sign-in.'),
      })
    }
  }

  async function cancelOAuth() {
    const sessionId = oauth.session?.sessionId
    setOauth((current) => ({ ...current, phase: 'cancelled' }))
    if (!sessionId) return
    try {
      await cancelProviderOAuth(sessionId)
    } catch (err) {
      toast.error('Could not cancel the sign-in session', {
        description: err instanceof Error ? err.message : 'The local setup step was reset.',
      })
    }
  }

  async function submitKey() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await connectProviderKey(selectedProvider, apiKey)
      if (res.connected) {
        // Honest success only when the re-probe actually reports a model.
        toast.success(`Connected ${providerLabel(res.provider)}`)
        setApiKey('')
        onConnected()
      } else {
        // The add ran but no usable model is reported; never fake "connected".
        toast.error('Added the key, but no usable model is reported yet.', {
          description: 'Check the provider and that the key has access, then re-check.',
        })
      }
    } catch (err) {
      toast.error('Could not connect that provider', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RungChrome
      rung="connect"
      onBack={onBack}
      onSkip={onSkip}
      primary={
        <Button
          type="button"
          onClick={onContinue}
          disabled={!connected}
          className="h-11 rounded-xl px-5 text-[15px]"
        >
          Continue
        </Button>
      }
    >
      {connected ? (
        <div className="grid gap-3">
          <div
            role="status"
            className="ad-surface flex items-center gap-2.5 rounded-md bg-surface-1 px-3 py-2.5 text-sm"
          >
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            <span className="text-foreground">A model is connected and ready. It's working.</span>
          </div>
          <p className="text-xs leading-relaxed text-foreground-tertiary">
            Agentdeck is running at{' '}
            <code className="font-mono text-foreground">{currentDeckUrl()}</code>. Bookmark this
            address so you can come back any time. The app stays in your browser; no install needed
            again.
          </p>
        </div>
      ) : (
        <>
          <div className="ad-surface grid gap-3 rounded-md bg-surface-1 p-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-foreground">Browser sign-in</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Agentdeck opens your browser to sign in, no terminal needed. Your credential
                  stays with Hermes; this page only sees whether it worked.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">Nous Portal</strong> is NousResearch's free
                  hosted model service. Create a free account at{' '}
                  <a
                    href="https://portal.nousresearch.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    portal.nousresearch.com
                  </a>
                  , then sign in with the button below.
                </p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor={`${providerId}-oauth`} className="ad-section-label">
                Provider
              </label>
              <select
                id={`${providerId}-oauth`}
                value={oauthProvider}
                onChange={(e) => {
                  setOauthProvider(e.target.value)
                  setOauth({ phase: 'idle' })
                }}
                disabled={oauthBusy}
                className="ad-surface flex h-10 w-full min-w-0 rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-50"
              >
                {OAUTH_PROVIDER_CHOICES.map((entry) => (
                  <option key={entry.id} value={entry.slug}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedOAuthProvider && (
              <div className="flex items-center gap-2 text-xs text-foreground-tertiary">
                <span className="grid size-5 place-items-center">
                  <ProviderBrandIcon provider={selectedOAuthProvider.slug ?? 'custom'} size={16} />
                </span>
                <span className="min-w-0 flex-1">{selectedOAuthProvider.description}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                type="button"
                onClick={() => void launchOAuth()}
                disabled={oauthBusy || oauth.phase === 'connected'}
                className="h-11 rounded-xl px-5 text-[15px]"
              >
                {oauth.phase === 'starting' ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <LogIn aria-hidden />
                )}
                Launch browser sign-in
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRecheck}
                disabled={rechecking}
                className="h-10 px-3"
              >
                {rechecking ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCw aria-hidden />
                )}
                Re-check
              </Button>
              {oauth.session?.sessionId && oauth.phase === 'waiting' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void cancelOAuth()}
                  className="h-10 px-3"
                >
                  <XCircle aria-hidden />
                  Cancel sign-in
                </Button>
              )}
            </div>

            <OAuthStatus oauth={oauth} />
          </div>

          {/* Expandable API-key path: the one connect step the BFF can drive. */}
          <div className="ad-surface rounded-md bg-surface-1">
            <button
              type="button"
              aria-expanded={keyOpen}
              onClick={() => setKeyOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-foreground"
            >
              <span>Or paste an API key instead</span>
              <ChevronDown
                className={cn('size-4 transition-transform', keyOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            {keyOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitKey()
                }}
                className="grid gap-3 border-t border-border px-3 pt-3 pb-3"
              >
                <div className="grid gap-1.5">
                  <label htmlFor={providerId} className="ad-section-label">
                    Provider
                  </label>
                  <select
                    id={providerId}
                    value={providerChoice}
                    onChange={(e) => setProviderChoice(e.target.value)}
                    autoComplete="off"
                    aria-describedby={providerHintId}
                    className="ad-surface flex h-10 w-full min-w-0 rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-50"
                  >
                    <option value="">Choose a provider</option>
                    {PROVIDER_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  {providerChoice === 'other' && (
                    <Input
                      id={customProviderId}
                      value={customProvider}
                      onChange={(e) => setCustomProvider(e.target.value)}
                      placeholder="Provider name"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Provider name"
                      aria-describedby={providerHintId}
                    />
                  )}
                  <p
                    id={providerHintId}
                    className="text-xs leading-relaxed text-foreground-tertiary"
                  >
                    Choose the company that issued your key.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={keyId} className="ad-section-label">
                    API key
                  </label>
                  <p id={keyHintId} className="text-xs leading-relaxed text-foreground-tertiary">
                    A secret token from your provider account.
                  </p>
                  {/* The key is a SECRET: masked by default, revealable only while
                      typed, and never stored or echoed after submission. */}
                  <Input
                    id={keyId}
                    type={reveal ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={keyHintId}
                  />
                  {apiKey.length > 0 && (
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <code
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground-tertiary"
                        aria-label="Masked key preview"
                      >
                        {reveal ? apiKey : maskKey(apiKey)}
                      </code>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={() => setReveal((r) => !r)}
                        className="min-h-10 px-2 text-muted-foreground"
                      >
                        {reveal ? 'Hide' : 'Reveal'}
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-foreground-tertiary">
                  Sent once to Hermes to store the credential. Agentdeck does not store or echo the
                  key after submission.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={!canSubmit}
                    className="h-10 px-3"
                  >
                    {submitting && <Loader2 className="animate-spin" aria-hidden />}
                    Connect key
                  </Button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </RungChrome>
  )
}

function OAuthStatus({ oauth }: { oauth: OAuthState }) {
  const { session } = oauth

  if (oauth.phase === 'idle') {
    return (
      <p className="text-xs leading-relaxed text-foreground-tertiary">
        {PROVIDER_OAUTH_FALLBACK_COPY}
      </p>
    )
  }

  if (oauth.phase === 'connected') {
    return (
      <p
        className="flex items-start gap-1.5 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success"
        role="status"
      >
        <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
        Hermes reports that sign-in completed. Re-checking model status now.
      </p>
    )
  }

  if (oauth.phase === 'cancelled') {
    return (
      <p
        className="flex items-start gap-1.5 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground"
        role="status"
      >
        <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
        Sign-in was cancelled.
      </p>
    )
  }

  if (oauth.phase === 'error') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          {oauth.error || session?.message || 'Hermes could not finish provider sign-in.'}
        </span>
      </p>
    )
  }

  return (
    <div className="grid gap-2 text-xs leading-relaxed text-foreground-tertiary" role="status">
      {session?.url && (
        <div className="grid gap-1">
          <span>{PROVIDER_OAUTH_POPUP_COPY}</span>
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-foreground underline-offset-4 hover:underline"
          >
            Open sign-in link
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
      {(session?.verificationUri || session?.userCode || session?.deviceCode) && (
        <div className="grid gap-1 rounded-md border border-border bg-background px-2.5 py-2">
          <span className="font-medium text-muted-foreground">
            Use these details if Hermes asks for a device code.
          </span>
          {session.verificationUri && (
            <CodeLine label="Verification URI" value={session.verificationUri} link />
          )}
          {session.userCode && <CodeLine label="User code" value={session.userCode} />}
          {session.deviceCode && <CodeLine label="Device code" value={session.deviceCode} />}
        </div>
      )}
      {session?.sessionId ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Waiting for Hermes to confirm sign-in...
        </span>
      ) : (
        <span>Continue in the browser, then return here and Re-check.</span>
      )}
    </div>
  )
}

function CodeLine({
  label,
  value,
  link = false,
}: {
  label: string
  value: string
  link?: boolean
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
      <span className="col-span-2 text-foreground-tertiary sm:col-span-1">{label}</span>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-mono text-foreground underline-offset-4 hover:underline"
          title={value}
        >
          {value}
        </a>
      ) : (
        <code className="min-w-0 truncate font-mono text-foreground" title={value}>
          {value}
        </code>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void copyValue(value, label)}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="min-h-10 min-w-10"
      >
        <Copy aria-hidden />
      </Button>
    </div>
  )
}

async function copyValue(value: string, label: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error('Could not copy')
  }
}

function mergeOAuthSession(
  current: ProviderOAuthSession,
  next: ProviderOAuthSession,
): ProviderOAuthSession {
  return {
    provider: next.provider || current.provider,
    status: next.status === 'unknown' ? current.status : next.status,
    sessionId: next.sessionId ?? current.sessionId,
    url: next.url ?? current.url,
    verificationUri: next.verificationUri ?? current.verificationUri,
    userCode: next.userCode ?? current.userCode,
    deviceCode: next.deviceCode ?? current.deviceCode,
    message: next.message ?? current.message,
    pollIntervalMs: next.pollIntervalMs ?? current.pollIntervalMs,
  }
}

function openLaunchUrl(url: string) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // The returned link remains rendered for manual opening.
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function currentDeckUrl(): string {
  return window.location.origin || 'http://127.0.0.1:7878'
}

/**
 * ConnectProviderDialog - provider connection UI for the Models surface.
 *
 * Two connection paths stay intentionally separate:
 *
 *  1. Browser sign-in for providers Hermes can OAuth: Agent Deck asks the BFF to
 *     start a Hermes-owned OAuth session, opens the returned URL when present,
 *     shows returned device/user-code details, polls returned session ids, and
 *     can cancel the session. Provider tokens are never stored in the browser.
 *  2. API key for providers that need a key: a masked key is POSTed once through
 *     the existing setup route. The component never renders a submitted key in
 *     any result/error state.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  CheckCircle2,
  CircleCheckBig,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { cancelProviderOAuth, pollProviderOAuth, startProviderOAuth } from './api'
import { ProviderBrandIcon } from './providerBrandIcons'
import {
  PROVIDER_CATALOG,
  providerSlug,
  providerSupports,
  providerSupportsOAuth,
} from './providerCatalog'
import {
  PROVIDER_OAUTH_FALLBACK_COPY,
  PROVIDER_OAUTH_POPUP_COPY,
  providerOAuthErrorMessage,
} from './providerOAuthCopy'
import type {
  ProviderAuthMethod,
  ProviderCatalogEntry,
  ProviderConnectResult,
  ProviderOAuthSession,
} from './types'

const INPUT_CLASS =
  'h-8 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus disabled:opacity-50'

const DEFAULT_PROVIDER_ID = 'openrouter'
const DEFAULT_POLL_MS = 2500

export type ConnectStatus = 'idle' | 'submitting' | 'success' | 'error'

type OAuthPhase = 'idle' | 'starting' | 'waiting' | 'connected' | 'error' | 'cancelled'

/**
 * After Hermes reports OAuth sign-in completed, we RE-PROBE for a usable model
 * (the same honesty bar the api-key path meets) instead of declaring success off
 * `logged_in` alone:
 *   'checking' — re-probe in flight
 *   'usable'   — connected AND a usable model is reporting
 *   'no-model' — signed in, but no usable model yet (needs a moment / restart)
 *   'unknown'  — re-probe unavailable; report sign-in only, don't overclaim
 */
type OAuthModelProbe = 'idle' | 'checking' | 'usable' | 'no-model' | 'unknown'

interface OAuthUiState {
  phase: OAuthPhase
  session?: ProviderOAuthSession
  error?: string
  /** Result of the post-connect usable-model re-probe (fix: don't overclaim). */
  probe?: OAuthModelProbe
}

export interface ConnectProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ConnectStatus
  /** Present on success — the provider + whether a usable model is now reported. */
  result?: ProviderConnectResult
  /** Present on error — an honest, key-free reason. */
  error?: string
  /**
   * Test-only seam: the just-submitted key, passed so a test can assert it is
   * NEVER rendered back in any state. The component does not display it.
   */
  submittedKey?: string
  onConnect: (vars: { provider: string; apiKey: string }) => void
  /**
   * The LIVE set of provider slugs Hermes can OAuth (lowercased), from
   * `GET /api/agent-deck/provider-oauth`. Intersected with the static catalog so
   * the oauth-capable set tracks the running Hermes and can't drift. Optional —
   * absent/empty falls back to the static catalog's declared methods.
   */
  oauthProviders?: ReadonlySet<string>
  /**
   * Fired when Hermes reports OAuth sign-in completed, so the route can refresh
   * the model roster (mirrors the api-key path's invalidate). Mirrors
   * ConnectRung's `onConnected`.
   */
  onOAuthConnected?: (provider: string) => void
  /**
   * Re-probe whether the just-OAuthed provider now reports a USABLE model, so the
   * dialog can show "connected and reporting a usable model" vs "signed in but no
   * usable model yet" — the same honesty the api-key path meets — instead of
   * declaring success off `logged_in` alone. Resolves true when a usable model is
   * reported. Optional: when absent the dialog reports sign-in completion only.
   */
  probeOAuthModel?: (provider: string) => Promise<boolean>
}

export function ConnectProviderDialog({
  open,
  onOpenChange,
  status,
  result,
  error,
  onConnect,
  oauthProviders,
  onOAuthConnected,
  probeOAuthModel,
}: ConnectProviderDialogProps) {
  const ids = useId()
  const [selectedId, setSelectedId] = useState(DEFAULT_PROVIDER_ID)
  const selectedProvider = useMemo(
    () => PROVIDER_CATALOG.find((p) => p.id === selectedId) ?? PROVIDER_CATALOG[0]!,
    [selectedId],
  )
  const [method, setMethod] = useState<ProviderAuthMethod>(selectedProvider.defaultMethod)
  const [customProvider, setCustomProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [oauth, setOauth] = useState<OAuthUiState>({ phase: 'idle' })

  const busy = status === 'submitting'
  const done = status === 'success'
  const providerForApi = providerSlug(selectedProvider, customProvider)
  const providerForOAuth = selectedProvider.slug ?? customProvider.trim()
  // OAuth-capability is driven by the LIVE Hermes list intersected with the
  // catalog, so it tracks the running build and can't silently drift.
  const oauthCapable = providerSupportsOAuth(selectedProvider, oauthProviders)
  const canSubmit =
    method === 'api-key' && providerForApi.trim() !== '' && apiKey.trim() !== '' && !busy

  useEffect(() => {
    if (status === 'success') {
      setApiKey('')
      setReveal(false)
    }
  }, [status])

  useEffect(() => {
    if (!open) {
      setApiKey('')
      setReveal(false)
      setCustomProvider('')
      setSelectedId(DEFAULT_PROVIDER_ID)
      setMethod('api-key')
      setOauth({ phase: 'idle' })
    }
  }, [open])

  useEffect(() => {
    const session = oauth.session
    if (oauth.phase !== 'waiting' || !session?.sessionId) return undefined

    let stopped = false
    const controller = new AbortController()
    const delay = session.pollIntervalMs ?? DEFAULT_POLL_MS
    const timeout = window.setTimeout(async () => {
      try {
        const next = await pollProviderOAuth(
          session.provider,
          session.sessionId!,
          controller.signal,
        )
        if (stopped) return
        setOauth((current) => {
          const currentSession = current.session
          if (!currentSession || currentSession.sessionId !== session.sessionId) return current
          const merged = mergeOAuthSession(currentSession, next)
          if (merged.status === 'connected') return { phase: 'connected', session: merged }
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
    }, delay)

    return () => {
      stopped = true
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [oauth.phase, oauth.session])

  // Keep the latest callbacks reachable WITHOUT making the connect effect depend
  // on their identity — a parent re-render passing new callbacks must not re-run
  // the one-shot connect handler.
  const onOAuthConnectedRef = useRef(onOAuthConnected)
  const probeOAuthModelRef = useRef(probeOAuthModel)
  useEffect(() => {
    onOAuthConnectedRef.current = onOAuthConnected
    probeOAuthModelRef.current = probeOAuthModel
  }, [onOAuthConnected, probeOAuthModel])

  // Guard so the connect handler runs ONCE per connected transition. We can't
  // depend on `oauth.probe` here — flipping it to 'checking' would re-run the
  // effect and the cleanup would cancel our own in-flight probe. The ref resets
  // to false whenever we leave the connected phase.
  const handledConnectRef = useRef(false)
  useEffect(() => {
    if (oauth.phase !== 'connected') handledConnectRef.current = false
  }, [oauth.phase])

  // When Hermes reports sign-in completed, do TWO honest things, once:
  //  1. notify the route so it refreshes the roster (mirrors the api-key path's
  //     invalidate, fixing the stale-roster bug);
  //  2. RE-PROBE for a usable model rather than declaring success off logged_in
  //     alone — show "reporting a usable model" vs "no usable model yet".
  useEffect(() => {
    if (oauth.phase !== 'connected' || handledConnectRef.current) return undefined
    handledConnectRef.current = true
    const provider = oauth.session?.provider ?? providerForOAuth.trim()
    onOAuthConnectedRef.current?.(provider)

    const probe = probeOAuthModelRef.current
    if (!probe) {
      setOauth((current) =>
        current.phase === 'connected' ? { ...current, probe: 'unknown' } : current,
      )
      return undefined
    }

    let cancelled = false
    setOauth((current) =>
      current.phase === 'connected' ? { ...current, probe: 'checking' } : current,
    )
    void probe(provider)
      .then((usable) => {
        if (cancelled) return
        setOauth((current) =>
          current.phase === 'connected'
            ? { ...current, probe: usable ? 'usable' : 'no-model' }
            : current,
        )
      })
      .catch(() => {
        if (cancelled) return
        // The re-probe itself failed — report sign-in only, don't overclaim.
        setOauth((current) =>
          current.phase === 'connected' ? { ...current, probe: 'unknown' } : current,
        )
      })
    return () => {
      cancelled = true
    }
  }, [oauth.phase, oauth.session, providerForOAuth])

  function selectProvider(entry: ProviderCatalogEntry) {
    setSelectedId(entry.id)
    setMethod(entry.defaultMethod)
    setCustomProvider('')
    setOauth({ phase: 'idle' })
  }

  function submit() {
    if (!canSubmit) return
    onConnect({ provider: providerForApi.trim(), apiKey })
  }

  async function startOAuth() {
    const provider = providerForOAuth.trim()
    if (!provider || oauth.phase === 'starting') return
    setOauth({ phase: 'starting' })
    try {
      const session = await startProviderOAuth(provider)
      if (session.url) openLaunchUrl(session.url)
      if (session.status === 'connected') {
        setOauth({ phase: 'connected', session })
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

  async function cancelOAuthFlow() {
    const sessionId = oauth.session?.sessionId
    setOauth((current) => ({ ...current, phase: 'cancelled' }))
    if (!sessionId) return
    try {
      await cancelProviderOAuth(sessionId)
    } catch (err) {
      toast.error('Could not cancel the sign-in session', {
        description: err instanceof Error ? err.message : 'The local dialog was reset.',
      })
    }
  }

  function handleOpenChange(next: boolean) {
    // Ignore close attempts mid-request so a key submit cannot be orphaned.
    if (!next && busy) return
    if (!next && oauth.phase === 'waiting') void cancelOAuthFlow()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Connect a provider</DialogTitle>
          <DialogDescription>
            Choose a provider. Nous Portal and Gemini CLI OAuth use Hermes browser sign-in; API-key
            providers send the key once to Hermes.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <ConnectResult result={result} />
        ) : (
          <div className="flex flex-col gap-4">
            <ProviderCatalog
              labelId={`${ids}-provider-catalog-label`}
              selected={selectedProvider}
              onSelect={selectProvider}
            />

            {oauthCapable && providerSupports(selectedProvider, 'api-key') && (
              <MethodSwitch method={method} onChange={setMethod} />
            )}

            {method === 'oauth' && oauthCapable ? (
              <OAuthLauncher
                provider={selectedProvider}
                oauth={oauth}
                onStart={() => void startOAuth()}
                onCancel={() => void cancelOAuthFlow()}
              />
            ) : (
              <form
                className="flex flex-col gap-3"
                aria-label="Connect a provider with a key"
                onSubmit={(e) => {
                  e.preventDefault()
                  submit()
                }}
              >
                <ProviderSlugField
                  id={`${ids}-provider`}
                  hintId={`${ids}-provider-hint`}
                  value={customProvider}
                  selected={selectedProvider}
                  busy={busy}
                  onChange={(value) => {
                    setCustomProvider(value)
                    setSelectedId('custom')
                    setMethod('api-key')
                    setOauth({ phase: 'idle' })
                  }}
                />

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${ids}-key`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    API key
                  </label>
                  <div className="relative">
                    <input
                      id={`${ids}-key`}
                      value={apiKey}
                      type={reveal ? 'text' : 'password'}
                      placeholder="sk-..."
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setApiKey(e.target.value)}
                      aria-describedby={`${ids}-key-hint`}
                      className={`${INPUT_CLASS} pr-9 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      disabled={busy}
                      aria-label={reveal ? 'Hide API key' : 'Show API key'}
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-foreground-tertiary transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ad-focus disabled:opacity-50"
                    >
                      {reveal ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                  <p
                    id={`${ids}-key-hint`}
                    className="text-[11px] leading-relaxed text-foreground-tertiary"
                  >
                    Sent to Hermes for credential storage. Agent Deck does not store or echo this
                    key after submission.
                  </p>
                </div>

                {status === 'error' && error && (
                  <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>{error}</span>
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <KeyRound aria-hidden />
                        Connect
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProviderCatalog({
  labelId,
  selected,
  onSelect,
}: {
  labelId: string
  selected: ProviderCatalogEntry
  onSelect: (entry: ProviderCatalogEntry) => void
}) {
  // Roving tabindex so the radiogroup is a SINGLE tab stop, then Arrow keys move
  // and select among options — the ARIA radio pattern the role promises. The
  // checked option is the only one in the tab order; arrows wrap around the grid.
  function moveSelection(currentIndex: number, delta: number) {
    const count = PROVIDER_CATALOG.length
    const nextIndex = (currentIndex + delta + count) % count
    onSelect(PROVIDER_CATALOG[nextIndex]!)
  }

  function onRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(index, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(index, -1)
        break
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby={labelId}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={labelId} className="text-xs font-medium text-muted-foreground">
          Choose a provider
        </h3>
        <span className="text-[11px] text-foreground-tertiary">Common options</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        {PROVIDER_CATALOG.map((entry, index) => {
          const checked = selected.id === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onSelect(entry)}
              onKeyDown={(event) => onRadioKeyDown(event, index)}
              className={cn(
                'ad-surface flex min-h-[76px] flex-col items-start gap-1.5 rounded-lg bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ad-focus focus-visible:outline-none',
                checked && 'border-border-strong bg-muted/70',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center text-foreground-tertiary">
                  {entry.slug ? (
                    <ProviderBrandIcon provider={entry.slug} size={17} />
                  ) : (
                    <ProviderBrandIcon provider="custom" size={17} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {entry.label}
                </span>
                {entry.badge && (
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-tertiary">
                    {entry.badge}
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-[11px] leading-snug text-foreground-tertiary">
                {entry.description}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function MethodSwitch({
  method,
  onChange,
}: {
  method: ProviderAuthMethod
  onChange: (method: ProviderAuthMethod) => void
}) {
  return (
    <div
      className="ad-surface inline-flex w-fit rounded-lg bg-surface-1 p-1"
      role="group"
      aria-label="Connection method"
    >
      <button
        type="button"
        onClick={() => onChange('oauth')}
        aria-pressed={method === 'oauth'}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ad-focus focus-visible:outline-none',
          method === 'oauth' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground',
        )}
      >
        <LogIn className="size-3.5" aria-hidden />
        Browser sign-in
      </button>
      <button
        type="button"
        onClick={() => onChange('api-key')}
        aria-pressed={method === 'api-key'}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ad-focus focus-visible:outline-none',
          method === 'api-key' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground',
        )}
      >
        <KeyRound className="size-3.5" aria-hidden />
        API key
      </button>
    </div>
  )
}

function ProviderSlugField({
  id,
  hintId,
  value,
  selected,
  busy,
  onChange,
}: {
  id: string
  hintId: string
  value: string
  selected: ProviderCatalogEntry
  busy: boolean
  onChange: (value: string) => void
}) {
  const placeholder = selected.slug ?? 'provider slug'
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Provider
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={busy}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        list={`${id}-catalog`}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} font-mono`}
        aria-describedby={hintId}
      />
      <datalist id={`${id}-catalog`}>
        {PROVIDER_CATALOG.filter((p) => p.slug).map((p) => (
          <option key={p.id} value={p.slug} label={p.label} />
        ))}
      </datalist>
      <p id={hintId} className="text-[11px] leading-relaxed text-foreground-tertiary">
        Choose a common provider above, or type a Hermes provider slug for Custom / other.
      </p>
    </div>
  )
}

function OAuthLauncher({
  provider,
  oauth,
  onStart,
  onCancel,
}: {
  provider: ProviderCatalogEntry
  oauth: OAuthUiState
  onStart: () => void
  onCancel: () => void
}) {
  const session = oauth.session
  const waiting = oauth.phase === 'starting' || oauth.phase === 'waiting'
  const connected = oauth.phase === 'connected'
  const cancelled = oauth.phase === 'cancelled'
  const failed = oauth.phase === 'error'

  return (
    <div
      data-testid="oauth-browser-launcher"
      className="ad-surface flex flex-col gap-3 rounded-lg bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Agent Deck launches Hermes-owned OAuth
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            Hermes handles authorization for {provider.label} and keeps any provider token. This
            dialog only shows launch and status details.
          </span>
          {/* Provider-specific context: show a plain-language link to the provider's
              sign-up page when one is known (e.g. Nous Portal → portal.nousresearch.com).
              Without this, a user unfamiliar with the provider has no pointer for
              creating an account — a "link pointing nowhere" honesty gap. */}
          {provider.docsUrl ? (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex w-fit items-center gap-1 text-[12px] text-foreground underline-offset-2 hover:underline"
              data-testid="provider-docs-link"
            >
              {provider.docsUrl.replace(/^https?:\/\//, '')}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onStart} disabled={waiting || connected}>
          {oauth.phase === 'starting' ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Starting...
            </>
          ) : (
            <>
              <LogIn aria-hidden />
              Launch browser sign-in
            </>
          )}
        </Button>
        {(waiting || connected || cancelled || failed) && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={connected || cancelled}
          >
            <XCircle aria-hidden />
            Cancel sign-in
          </Button>
        )}
      </div>

      {!connected && (
        <p className="text-[11px] leading-relaxed text-foreground-tertiary">
          {PROVIDER_OAUTH_FALLBACK_COPY}
        </p>
      )}

      {session && (
        <OAuthSessionDetails
          session={session}
          phase={oauth.phase}
          error={oauth.error}
          probe={oauth.probe}
        />
      )}

      {!session && failed && oauth.error && (
        <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{oauth.error}</span>
        </p>
      )}
    </div>
  )
}

function OAuthSessionDetails({
  session,
  phase,
  error,
  probe,
}: {
  session: ProviderOAuthSession
  phase: OAuthPhase
  error?: string
  probe?: OAuthModelProbe
}) {
  if (phase === 'connected') {
    // HONESTY: don't declare full success off `logged_in` alone. After sign-in we
    // re-probe for a usable model (the same bar the api-key path meets) and report
    // the REAL verdict — usable vs signed-in-but-no-model-yet vs sign-in-only.
    if (probe === 'no-model') {
      return (
        <div
          className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-sm"
          role="status"
        >
          <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden />
          <span className="text-foreground">
            Signed in, but no usable model is reporting yet. It may need a moment, or the gateway
            may need a restart to pick it up.
          </span>
        </div>
      )
    }
    if (probe === 'usable') {
      return (
        <div
          className="flex items-start gap-2 rounded-md bg-success/10 px-2.5 py-2 text-sm"
          role="status"
        >
          <CheckCircle2 className="mt-px size-4 shrink-0 text-success" aria-hidden />
          <span className="text-foreground">
            Signed in and reporting a usable model. You’re connected.
          </span>
        </div>
      )
    }
    return (
      <div
        className="flex items-start gap-2 rounded-md bg-success/10 px-2.5 py-2 text-sm"
        role="status"
      >
        {probe === 'checking' ? (
          <Loader2 className="mt-px size-4 shrink-0 animate-spin text-success" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-px size-4 shrink-0 text-success" aria-hidden />
        )}
        <span className="text-foreground">
          {probe === 'checking'
            ? 'Hermes reports that sign-in completed. Checking for a usable model...'
            : 'Hermes reports that sign-in completed.'}
        </span>
      </div>
    )
  }

  if (phase === 'cancelled') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-2 text-sm" role="status">
        <XCircle className="mt-px size-4 shrink-0 text-foreground-tertiary" aria-hidden />
        <span className="text-muted-foreground">Sign-in was cancelled.</span>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{error || session.message || 'Hermes could not finish provider sign-in.'}</span>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2" role="status">
      {session.url && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-foreground-tertiary">{PROVIDER_OAUTH_POPUP_COPY}</span>
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-xs text-foreground underline-offset-4 hover:underline"
          >
            Open sign-in link
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
      {(session.userCode || session.deviceCode || session.verificationUri) && (
        <div className="grid gap-1.5 rounded-md border border-border bg-background px-2.5 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            Use these details if Hermes asks for a device code.
          </span>
          {session.verificationUri && (
            <CodeRow label="Verification URI" value={session.verificationUri} link />
          )}
          {session.userCode && <CodeRow label="User code" value={session.userCode} />}
          {session.deviceCode && <CodeRow label="Device code" value={session.deviceCode} />}
        </div>
      )}
      {session.sessionId && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-tertiary">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Checking with Hermes...
        </span>
      )}
      {!session.sessionId && (
        <span className="text-[11px] text-foreground-tertiary">
          Continue in the browser, then return here after sign-in completes.
        </span>
      )}
    </div>
  )
}

function CodeRow({ label, value, link = false }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-foreground-tertiary">{label}</span>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground underline-offset-4 hover:underline"
        >
          {value}
        </a>
      ) : (
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
          {value}
        </code>
      )}
      <button
        type="button"
        onClick={() => void copyValue(value, label)}
        aria-label={`Copy ${label}`}
        className="grid size-7 shrink-0 place-items-center rounded-md text-foreground-tertiary transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus focus-visible:outline-none"
      >
        <Copy className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/**
 * The honest result panel. NEVER renders the key; only the provider + verdict.
 */
function ConnectResult({ result }: { result?: ProviderConnectResult }) {
  const provider = result?.provider ?? 'The provider'
  if (result?.connected) {
    return (
      <div
        className="ad-surface flex items-start gap-2.5 rounded-lg bg-card px-3.5 py-3 text-sm"
        role="status"
      >
        <CircleCheckBig className="mt-px size-4 shrink-0 text-success" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">Connected</span>
          <span className="text-muted-foreground">
            <span className="font-mono">{provider}</span> is connected and reporting a usable model.
          </span>
        </div>
      </div>
    )
  }
  return (
    <div
      className="ad-surface flex items-start gap-2.5 rounded-lg bg-card px-3.5 py-3 text-sm"
      role="status"
    >
      <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">Credential added</span>
        <span className="text-muted-foreground">
          <span className="font-mono">{provider}</span> was added, but no usable model is reporting
          yet. It may need a moment, or the gateway may need a restart to pick it up.
        </span>
      </div>
    </div>
  )
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
    // The returned link is still rendered for manual opening.
  }
}

async function copyValue(value: string, label: string) {
  try {
    await navigator.clipboard?.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error('Could not copy')
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

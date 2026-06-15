import { createElement, useId, useState, type FormEvent } from 'react'
import {
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type {
  MessagingConnection,
  MessagingPlatformState,
  MessagingTokenField,
  SetMessagingTokenRequest,
} from '@agent-deck/protocol'
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hasBrandMark, platformIcon } from './platformIcons'

/**
 * PlatformTile — one platform as a COMPACT, click-to-expand tile in the Messaging
 * grid. The redesign goal: status AT A GLANCE, ~one screen, open only what you
 * configure. Collapsed it's a tile (brand logo + label + a REAL semantic status
 * dot). Expanded it reveals the EXISTING honest setup flow verbatim — the BYO-bot
 * copy, the ordered setup steps, the official setup link, the masked shape-only
 * token field(s), and the shared "Restart to apply".
 *
 * Honesty (the spine): the status dot reflects the gateway's REAL per-platform
 * `connection` (+ gateway liveness) mapped to a SEMANTIC tone — never the amber
 * `--primary` action accent, never a fake "connected". The brand LOGO is identity
 * (its own brand color), also never the accent. The credential field is shape-only
 * — a password input that previews a redacted value when set and NEVER echoes the
 * plaintext (cleared on submit so it doesn't linger in the DOM).
 *
 * Presentational: props in / callbacks out, so the route owns the mutations and
 * each connection state is exercisable without a query client.
 */

const INPUT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-13 text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus'

export interface PlatformTileProps {
  /** The platform's registry metadata fused with its live state + token shape. */
  platform: MessagingPlatformState
  /** Whether the gateway is running — when false, connection isn't live truth. */
  gatewayRunning: boolean
  /** Store/replace a credential (the route owns the real mutation). */
  onSetToken: (request: SetMessagingTokenRequest) => void
  /** Restart the gateway to apply a stored token (reuses the shared restart). */
  onRestart: () => void
  /** Whether a gateway restart is currently in flight. */
  restarting: boolean
}

export function PlatformTile({
  platform: state,
  gatewayRunning,
  onSetToken,
  onRestart,
  restarting,
}: PlatformTileProps) {
  const { platform } = state
  const titleId = useId()
  const panelId = useId()
  const [open, setOpen] = useState(false)

  const status = resolveStatus(state.connection, gatewayRunning)
  const Logo = platformIcon(platform.id)
  const branded = hasBrandMark(platform.id)

  return (
    <section
      aria-labelledby={titleId}
      role="region"
      aria-label={platform.label}
      data-testid={`messaging-tile-${platform.id}`}
      className="ad-surface flex flex-col overflow-hidden rounded-xl bg-card text-card-foreground"
    >
      {/* Collapsed header IS the disclosure trigger — status at a glance. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 px-3.5 py-3 text-left focus-visible:ad-focus"
      >
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-md',
            // Branded marks paint their own SVG colors on a neutral plate; the
            // neutral fallback glyph (email/unknown) inherits the surface fg.
            branded ? 'bg-muted/60' : 'ad-surface bg-muted text-foreground-tertiary',
          )}
        >
          {createElement(Logo, { className: 'size-[22px]' })}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={titleId} className="truncate font-heading text-sm font-medium text-foreground">
            {platform.label}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <StatusDot
              tone={status.tone}
              label={status.label}
              pulse={status.pulse}
              data-testid="messaging-status"
            />
            <span className="truncate">{status.label}</span>
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-foreground-tertiary transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border-t border-border px-3.5 pb-4 pt-3.5">
          {state.connection === 'error' && state.errorMessage ? (
            <p className="flex items-start gap-1.5 text-13 text-destructive" role="alert">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{state.errorMessage}</span>
            </p>
          ) : null}

          <p className="text-13 leading-relaxed text-muted-foreground">
            You create the bot in{' '}
            <span className="font-medium text-foreground">{platform.label}</span>; Agent Deck stores
            its token and Hermes handles replies after a restart. Agent Deck can&apos;t create the
            bot for you.
          </p>

          {platform.steps.length > 0 ? (
            <ol className="flex flex-col gap-1.5 text-13 text-muted-foreground">
              {platform.steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="ad-surface grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-foreground-tertiary"
                  >
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {platform.setupUrl ? (
            <a
              href={platform.setupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-13 font-medium text-foreground underline-offset-4 transition-colors hover:underline"
            >
              Create your bot
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}

          <div className="flex flex-col gap-3">
            {state.tokens.map((token) => (
              <TokenField
                key={token.envVar}
                platformId={platform.id}
                token={token}
                onSetToken={onSetToken}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[12px] leading-relaxed text-foreground-tertiary">
              A stored token only takes effect after your agent restarts.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={restarting}
              onClick={onRestart}
              className="shrink-0"
            >
              {restarting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Restarting…
                </>
              ) : (
                <>
                  <RefreshCw aria-hidden />
                  Restart to apply
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Status — gateway truth → a governed SEMANTIC tone (never the amber accent)  */
/* -------------------------------------------------------------------------- */

interface ResolvedStatus {
  tone: StatusTone
  label: string
  pulse: boolean
}

/** Map the connection state (+ gateway liveness) to a governed semantic status. */
function resolveStatus(connection: MessagingConnection, gatewayRunning: boolean): ResolvedStatus {
  // Gateway DOWN: connection isn't live truth — say so honestly, never imply a
  // platform is disconnected.
  if (!gatewayRunning) {
    return { tone: 'idle', label: 'Start your agent to see status', pulse: false }
  }
  switch (connection) {
    case 'connected':
      // Connected is a SEMANTIC-success status, NOT the amber action accent.
      return { tone: 'ok', label: 'Connected', pulse: false }
    case 'error':
      return { tone: 'error', label: 'Error', pulse: false }
    case 'connecting':
      // A token was saved but the gateway needs a restart before it takes effect.
      // "Connecting — restart to apply" implied a live in-progress connection, which
      // is misleading (pulse + "connecting" = live). The accurate label is "Pending
      // restart" and the dot must NOT pulse (pulsing = live/active state).
      return { tone: 'info', label: 'Pending restart', pulse: false }
    case 'not_configured':
      return { tone: 'idle', label: 'Not connected', pulse: false }
    case 'unknown':
    default:
      // Gateway up but no clean state (e.g. stopped) — a neutral "not connected".
      return { tone: 'idle', label: 'Not connected', pulse: false }
  }
}

/* -------------------------------------------------------------------------- */
/* Token field — masked, shape-only, never echoes the plaintext               */
/* -------------------------------------------------------------------------- */

function TokenField({
  platformId,
  token,
  onSetToken,
}: {
  platformId: string
  token: MessagingTokenField
  onSetToken: (request: SetMessagingTokenRequest) => void
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed === '') return
    onSetToken({ platform: platformId, envVar: token.envVar, value: trimmed })
    // Clear immediately so the plaintext never lingers in the DOM.
    setValue('')
    setReveal(false)
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={submit}
      aria-label={`Set ${platformId} ${token.envVar}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {token.label}
        </label>
        {token.isSet && token.redactedValue ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11px] text-foreground-tertiary">
            <Check className="size-3 text-success" aria-hidden />
            <span className="min-w-0 truncate">{token.redactedValue}</span>
          </span>
        ) : token.isSet ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-foreground-tertiary">
            <Check className="size-3 text-success" aria-hidden />
            Stored
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            id={id}
            value={value}
            type={reveal ? 'text' : 'password'}
            placeholder={token.isSet ? 'Paste a new token to replace' : 'Paste the token'}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            className={cn(INPUT_CLASS, 'pr-10 font-mono')}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide token characters' : 'Show token characters'}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-foreground-tertiary transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
          >
            {reveal ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <Button type="submit" disabled={value.trim() === ''} className="h-10 shrink-0">
          Save token
        </Button>
      </div>
    </form>
  )
}

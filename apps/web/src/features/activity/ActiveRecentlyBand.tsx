import { ArrowUpCircle, HelpCircle, Loader2, Users, WifiOff } from 'lucide-react'
import type { AgentDeckPlatform, PlatformState } from '@agent-deck/protocol'
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'
import { useStatus } from './useStatus'

/**
 * The "Active recently" band — a cross-source fleet view on the Home dashboard.
 * Agent Deck's chat surface only sees the LOCAL web run, but a hermes operator
 * also drives the same agent from telegram / cron / cli. The dashboard's
 * `/api/status` knows WHICH sources are connected and HOW MANY sessions are
 * active — but it CANNOT enumerate individual cross-source runs, so this band is
 * deliberately a low-fidelity heartbeat (a 15s poll, see {@link useStatus}), NOT
 * a live stream. That is why the label is honestly "active recently · ~last few
 * min", never "live".
 *
 * Color governance (design-language §2): the per-platform dots use the GOVERNED
 * SEMANTIC palette (success teal-green / warning / error / muted), NEVER the action accent —
 * the action accent is reserved for the live/active local run. The config-update hint uses
 * `info`. Because the warning hue is adjacent to the reserved action accent, the
 * non-connected states are ALSO marked with a distinguishing icon (not
 * color-only) so an at-a-glance/colorblind operator can't conflate a degraded
 * source with the live accent.
 *
 * The cross-source poll honors `enabled`: while disabled it renders a calm
 * "paused" placeholder rather than a misleading "gateway down", and never probes
 * the gateway. Home keeps it enabled (the front door always wants fleet status).
 */
export function ActiveRecentlyBand({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading, isError } = useStatus(enabled)

  // Poll disabled → no fetch on load. Don't borrow the gateway-down copy: we
  // simply haven't probed, so say so honestly.
  if (!enabled) {
    return (
      <div
        className="flex items-center gap-2 px-1 py-1 text-[12px] text-foreground-tertiary"
        data-testid="active-recently-paused"
      >
        <WifiOff className="size-3.5 text-muted-foreground" aria-hidden />
        Cross-source status is paused.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 px-1 py-1 text-[12px] text-foreground-tertiary"
        data-testid="active-recently-loading"
      >
        <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
        Checking other sources…
      </div>
    )
  }

  // A failed probe or a stopped gateway both mean "we can't see cross-source
  // activity right now" — render the same calm, honest down state.
  if (isError || !data || !data.gatewayRunning) {
    return (
      <div
        className="flex items-center gap-2 px-1 py-1 text-[12px] text-foreground-tertiary"
        data-testid="active-recently-gateway-down"
      >
        <WifiOff className="size-3.5 text-muted-foreground" aria-hidden />
        Your agent isn’t running; cross-source activity is unavailable.
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="active-recently">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {data.platforms.length > 0 ? (
          data.platforms.map((p) => <PlatformDot key={p.name} platform={p} />)
        ) : (
          <span className="text-[12px] text-foreground-tertiary">No connected sources.</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Users className="size-3.5 text-foreground-tertiary" aria-hidden />
        <span className="tabular-nums text-foreground" data-testid="active-sessions">
          {data.activeSessions}
        </span>
        {data.activeSessions === 1 ? 'active session' : 'active sessions'}
        <span aria-hidden className="text-foreground-tertiary">
          ·
        </span>
        {/* HONEST labeling: the gateway can't enumerate individual cross-source
            runs, so this is "active recently", not "live". */}
        <span className="text-foreground-tertiary">active recently · ~last few min</span>
      </div>

      {data.configUpdateAvailable && (
        <div
          className="flex items-center gap-1.5 text-[12px] text-info"
          data-testid="config-update-hint"
          role="status"
        >
          <ArrowUpCircle className="size-3.5" aria-hidden />A newer config version is available.
        </div>
      )}
    </div>
  )
}

/**
 * Per-platform state → the shared {@link StatusDot}. All GOVERNED SEMANTIC tokens
 * (NEVER the action accent): `connected` is the calm round success dot (no marker, no label);
 * the non-connected states are NOT color-only — each carries a distinguishing
 * SHAPE (triangle / x-circle), because the `--warning` hue sits next to the
 * reserved live accent and a round warning dot could be mistaken for the live
 * accent at a glance or by a colorblind operator (a11y finding #4). `unknown`
 * (unprobed) stays `idle`-muted but is given the band's help-circle shape so it
 * is also non-color-only and announced. Each non-connected marker is labelled for
 * assistive tech.
 */
const STATE_TONE: Record<PlatformState, { tone: StatusTone; label: string | null }> = {
  connected: { tone: 'ok', label: null },
  degraded: { tone: 'warn', label: 'degraded' },
  down: { tone: 'error', label: 'down' },
  unknown: { tone: 'idle', label: 'unknown' },
}

/** Per-platform connection chip: a shared StatusDot (a shape, not a hue alone,
 * for non-connected states) + the source name, plus a short reason when
 * degraded/down. */
function PlatformDot({ platform }: { platform: AgentDeckPlatform }) {
  const { tone, label } = STATE_TONE[platform.state]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
      data-testid={`platform-${platform.name}`}
      data-state={platform.state}
    >
      {label === null ? (
        // The calm healthy default — a plain success dot, no extra marker.
        <StatusDot tone={tone} label="connected" />
      ) : platform.state === 'unknown' ? (
        // `idle` is a plain dot by design (a neutral "off"), but an unprobed
        // source still needs a non-color-only cue here, so the band supplies its
        // help-circle as the labelled marker.
        <span
          className="inline-flex shrink-0 text-muted-foreground"
          data-testid="platform-state-marker"
          role="img"
          aria-label={label}
        >
          <HelpCircle className="size-3" aria-hidden />
        </span>
      ) : (
        // degraded / down → the shared StatusDot's semantic SHAPE glyph, doubling
        // as the labelled `platform-state-marker` the band exposes.
        <StatusDot tone={tone} label={label} data-testid="platform-state-marker" />
      )}
      <span className="text-foreground">{platform.name}</span>
      {platform.error && (
        <span className="text-foreground-tertiary" title={platform.error}>
          · {platform.error}
        </span>
      )}
    </span>
  )
}

import { useId, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Loader2,
  Package,
  RefreshCw,
  Server,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { RadioCardGroup } from '@/components/ui/radio-card-group'
import type {
  GatewayStatus,
  HermesUpdateState,
  HermesUpdateChannel,
  HermesChannelState,
  AgentDeckUpdateState,
  HermesUpdateApplyResult,
  HermesDoctorReport,
  SystemState,
} from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConnectionDot } from '@/components/layout/ConnectionDot'
import { DoItForMe } from '@/components/ui/DoItForMe'
import { cn } from '@/lib/utils'

/**
 * SystemPage — the Maintenance dock (`/system`): three stacked cards on the one
 * Card primitive, each a status row + a single sky-blue action whose enabled state
 * is driven by a REAL check. The HONESTY rules of the design spine live here in
 * their sharpest form:
 *
 *  - GatewayCard — an always-available "Restart gateway" behind a confirm that
 *    states the real cost ("your agent disconnects for a few seconds"); while the
 *    restart is in flight it reuses the calm reconnecting UX (the ConnectionDot's
 *    pulsing amber + "Restarting…"), never a fake "done".
 *  - HermesUpdateCard — the apply is DISABLED + "Up to date" when the read reports
 *    current, and ACTIVE sky-blue ONLY when the read reports update-available. The
 *    confirm states the real cost (restarts the gateway, keeps a backup). The
 *    apply streams a secret-scrubbed log into a collapsible disclosure.
 *  - AgentDeckUpdateCard — DISABLED with a visible reason ("No update channel
 *    configured — local build") on no-channel; the git flow stays gated off in v1
 *    so it can never fake-succeed.
 *
 * Presentational by design: the connected {@link ./SystemRoute} wires the query +
 * mutations and feeds status/result/error in, so each card is exercisable across
 * idle / in-flight / result without a query client. The single sky-blue accent is
 * spent on the one real action per card; identity is never involved.
 */

/** The gateway restart action's lifecycle (the route owns the real mutation). */
export interface GatewayActionState {
  status: 'idle' | 'restarting'
  onRestart: () => void
}

/** The Hermes update apply action's lifecycle (the channel is chosen in the card). */
export interface HermesUpdateActionState {
  status: 'idle' | 'applying'
  /** Apply the update on the chosen channel (stable default, latest-commit advanced). */
  onApply: (channel: HermesUpdateChannel) => void
  /** The terminal apply result (scrubbed log + re-probed version), once available. */
  result?: HermesUpdateApplyResult
  /** An honest failure reason (a transport error), when the apply request itself failed. */
  error?: string
}

/** The Doctor health-check action's lifecycle (run on demand; never auto-run). */
export interface DoctorActionState {
  status: 'idle' | 'running'
  onRun: () => void
  /** The slim, scrubbed health rollup once a run completes (incl. `unavailable`). */
  result?: HermesDoctorReport
  /** An honest failure reason (a transport error), when the request itself failed. */
  error?: string
}

export interface SystemPageProps {
  /** The combined dock read (gateway + both update reads). */
  system: SystemState
  gateway: GatewayActionState
  hermesUpdate: HermesUpdateActionState
  doctor: DoctorActionState
  /** Extra dock cards rendered at the end of the stack (host resources, curator,
   * key validation). The connected route wires their own reads + actions and
   * passes them here, keeping this page presentational. */
  children?: ReactNode
}

export function SystemPage({ system, gateway, hermesUpdate, doctor, children }: SystemPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col px-6 py-8">
      <PageHeader
        icon={ShieldCheck}
        title="System"
        subtitle="Keep your agent's home tended: restart your agent, update Hermes, and check its health. Every action here reflects a real check."
      />
      <div className="flex flex-col gap-6">
        <GatewayCard status={system.gateway.status} action={gateway} />
        <HermesUpdateCard hermes={system.hermes} action={hermesUpdate} />
        <DoctorCard action={doctor} />
        <AgentDeckUpdateCard agentDeck={system.agentDeck} />
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* GatewayCard                                                                */
/* -------------------------------------------------------------------------- */

const GATEWAY_LABEL: Record<GatewayStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  failed: 'Failed',
  unknown: 'Unknown',
}

/** Map the coarse run-state to the calm ConnectionDot vocabulary. */
function gatewayDotStatus(status: GatewayStatus, restarting: boolean) {
  if (restarting) return 'connecting' as const
  if (status === 'running') return 'online' as const
  // `stopped`, `failed`, and `unknown` are all non-running — a non-pulsing
  // offline dot. `unknown` must NOT map to `connecting` (pulsing) because
  // pulsing implies an in-progress connection, which would be a honesty lie
  // (we simply don't know the state).
  return 'offline' as const
}

function GatewayCard({ status, action }: { status: GatewayStatus; action: GatewayActionState }) {
  const [confirming, setConfirming] = useState(false)
  const restarting = action.status === 'restarting'

  return (
    <DockCard
      icon={Server}
      title="Your agent"
      regionLabel="Your agent"
      status={
        <span className="flex items-center gap-2">
          <ConnectionDot status={gatewayDotStatus(status, restarting)} />
          <span className="text-sm text-muted-foreground">
            {restarting ? 'Restarting…' : GATEWAY_LABEL[status]}
          </span>
        </span>
      }
      description="The process that runs your agent. Restart it if it stops responding."
      action={
        <Button variant="outline" disabled={restarting} onClick={() => setConfirming(true)}>
          {restarting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Restarting…
            </>
          ) : (
            <>
              <RefreshCw aria-hidden />
              Restart your agent
            </>
          )}
        </Button>
      }
    >
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Restart your agent?"
        body="Your agent disconnects for a few seconds while it restarts. Any running chat will reconnect automatically."
        confirmLabel="Restart"
        onConfirm={() => {
          setConfirming(false)
          action.onRestart()
        }}
      />
    </DockCard>
  )
}

/* -------------------------------------------------------------------------- */
/* HermesUpdateCard                                                           */
/* -------------------------------------------------------------------------- */

/** Human labels for each honest channel. */
const CHANNEL_LABEL: Record<HermesUpdateChannel, string> = {
  stable: 'Stable release',
  'latest-commit': 'Latest commit',
}

/**
 * Resolve the per-channel verdicts from the read. When the BFF supplied `channels`
 * we use them; otherwise we fall back to a single STABLE channel built from the
 * top-level status (back-compat with a channel-unaware read). The latest-commit
 * channel is always offered (advanced); when absent from the read it defaults to a
 * fail-closed `up-to-date` so we never imply an update we didn't actually check.
 */
function resolveChannels(
  hermes: HermesUpdateState,
): Record<HermesUpdateChannel, HermesChannelState> {
  const byChannel = new Map((hermes.channels ?? []).map((c) => [c.channel, c]))
  const stable = byChannel.get('stable') ?? {
    channel: 'stable' as const,
    status: hermes.status,
    currentVersion: hermes.currentVersion,
  }
  const latest = byChannel.get('latest-commit') ?? {
    channel: 'latest-commit' as const,
    status: 'up-to-date' as const,
    currentVersion: hermes.currentVersion,
  }
  return { stable, 'latest-commit': latest }
}

function HermesUpdateCard({
  hermes,
  action,
}: {
  hermes: HermesUpdateState
  action: HermesUpdateActionState
}) {
  const [confirming, setConfirming] = useState(false)
  const [channel, setChannel] = useState<HermesUpdateChannel>('stable')
  const applying = action.status === 'applying'
  const channels = resolveChannels(hermes)
  const selected = channels[channel]
  const available = selected.status === 'update-available'
  const version = formatVersion(selected.currentVersion)
  const isLatest = channel === 'latest-commit'

  return (
    <DockCard
      icon={Package}
      title="Hermes"
      regionLabel="Hermes"
      status={
        <span className="flex items-center gap-2 text-sm">
          {applying ? (
            <Loader2
              className="size-3.5 animate-spin text-foreground-tertiary"
              aria-label="Updating"
            />
          ) : available ? (
            <Badge variant="warning">Update available</Badge>
          ) : (
            <Check className="size-3.5 text-success" aria-hidden />
          )}
          {version ? (
            <span className="font-mono text-xs text-foreground-tertiary">{version}</span>
          ) : null}
        </span>
      }
      description="The Hermes agent itself. Updating restarts your agent and keeps a backup."
      action={
        // ACTIVE sky-blue ONLY when the SELECTED channel reports an update; else DISABLED.
        <Button disabled={!available || applying} onClick={() => setConfirming(true)}>
          {applying ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Updating…
            </>
          ) : available ? (
            'Update Hermes'
          ) : (
            'Up to date'
          )}
        </Button>
      }
    >
      <ChannelChooser channels={channels} selected={channel} onSelect={setChannel} />
      {action.error ? (
        <p className="px-4 text-13 text-destructive" role="alert">
          {action.error}
        </p>
      ) : null}
      {action.result ? <UpdateResultLog result={action.result} /> : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={isLatest ? 'Update to the latest commit?' : 'Update Hermes?'}
        body={
          isLatest
            ? 'The latest commit is the bleeding-edge branch tip: newer than the stable release and not yet release-tested, so it may be unstable. This restarts your agent (it disconnects briefly) and keeps a backup, so you can roll back.'
            : 'This runs the update and restarts your agent, so it disconnects for a few seconds. A backup of the current version is kept automatically, so you can roll back.'
        }
        confirmLabel="Update"
        onConfirm={() => {
          setConfirming(false)
          action.onApply(channel)
        }}
      />
    </DockCard>
  )
}

/**
 * The honest channel picker: a radiogroup of STABLE (recommended default) vs LATEST
 * COMMIT (advanced · bleeding-edge), each showing its own real `--check` verdict.
 * A one-line note states channels track git branches (Hermes ships from a checkout),
 * not signed release tags — so we never imply a "release tag" install the CLI lacks.
 */
function ChannelChooser({
  channels,
  selected,
  onSelect,
}: {
  channels: Record<HermesUpdateChannel, HermesChannelState>
  selected: HermesUpdateChannel
  onSelect: (channel: HermesUpdateChannel) => void
}) {
  const options = (
    [
      {
        channel: 'stable' as const,
        hint: 'Recommended: the released version your install tracks.',
      },
      {
        channel: 'latest-commit' as const,
        hint: 'Advanced · bleeding-edge: the newest commit on the main branch.',
      },
    ] as const
  ).map(({ channel, hint }) => {
    const available = channels[channel].status === 'update-available'
    return {
      value: channel,
      label: CHANNEL_LABEL[channel],
      // Per-channel verdict stays honest but quiet; folded into description so the
      // ONE amber badge on the card header remains the primary update signal.
      description: `${available ? 'Update available · ' : ''}${hint}`,
    }
  })

  return (
    <div className="px-4 pt-1">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Update channel</p>
      <RadioCardGroup
        value={selected}
        onValueChange={onSelect}
        options={options}
        aria-label="Update channel"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-tertiary">
        Channels track git branches (Hermes ships from a checkout), not signed release tags.
      </p>
    </div>
  )
}

/** The terminal apply outcome — a collapsible, already-scrubbed log. */
function UpdateResultLog({ result }: { result: HermesUpdateApplyResult }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const failed = result.status === 'failed'
  return (
    <div className="px-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'group/log flex w-full items-center gap-2 rounded-lg py-1 text-left text-13',
          'focus-visible:ad-focus',
        )}
      >
        <ChevronDown
          className={cn(
            'size-4 text-foreground-tertiary transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span className={failed ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {failed ? 'Update failed: view log' : 'Update finished: view log'}
        </span>
      </button>
      {open ? (
        <pre
          id={panelId}
          className="ad-surface mt-1.5 max-h-56 overflow-auto rounded-lg bg-surface-1 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground-tertiary"
        >
          {result.log.length > 0 ? result.log.join('\n') : 'No output.'}
        </pre>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* DoctorCard                                                                 */
/* -------------------------------------------------------------------------- */

/** Map the doctor verdict to a calm one-line status with a semantic glyph (no action accent). */
function doctorStatusLine(report: HermesDoctorReport): ReactNode {
  if (report.status === 'unavailable') {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <XCircle className="size-3.5 text-foreground-tertiary" aria-hidden />
        Health check couldn't run
      </span>
    )
  }
  const { ok, warning, error } = report.counts
  const parts: string[] = []
  if (warning > 0) parts.push(`${warning} warning${warning === 1 ? '' : 's'}`)
  if (error > 0) parts.push(`${error} issue${error === 1 ? '' : 's'}`)
  const detail = parts.length > 0 ? parts.join(' · ') : `${ok} checks passed`
  return (
    <span className="flex items-center gap-2 text-sm">
      {report.status === 'ok' ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : report.status === 'issues' ? (
        <XCircle className="size-3.5 text-destructive" aria-hidden />
      ) : (
        <TriangleAlert className="size-3.5 text-warning" aria-hidden />
      )}
      <span className="text-muted-foreground">{detail}</span>
    </span>
  )
}

function DoctorCard({ action }: { action: DoctorActionState }) {
  const running = action.status === 'running'
  const report = action.result
  return (
    <DockCard
      icon={Stethoscope}
      title="Doctor"
      regionLabel="Doctor: Hermes health"
      status={
        running ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-label="Checking" />
            Checking…
          </span>
        ) : report ? (
          doctorStatusLine(report)
        ) : (
          <span className="text-sm text-muted-foreground">Not checked yet</span>
        )
      }
      description="Run Hermes's own diagnostics: config, auth, tools, and connectivity. Read-only; nothing is changed."
      action={
        // Read-only action → not the sky-blue primary; a neutral outline button.
        <Button variant="outline" disabled={running} onClick={action.onRun}>
          {running ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Checking…
            </>
          ) : (
            <>
              <Stethoscope aria-hidden />
              Run health check
            </>
          )}
        </Button>
      }
    >
      {action.error ? (
        <p className="px-4 text-13 text-destructive" role="alert">
          {action.error}
        </p>
      ) : null}
      {report ? <DoctorResult report={report} /> : null}
    </DockCard>
  )
}

/** The doctor rollup: an honest unavailable note, or the summary + collapsible sections. */
function DoctorResult({ report }: { report: HermesDoctorReport }) {
  if (report.status === 'unavailable') {
    return (
      <p className="px-4 text-13 leading-relaxed text-muted-foreground">
        The health check is unavailable. <code className="font-mono">hermes doctor</code> couldn't
        run on this machine. This doesn't affect chatting.
      </p>
    )
  }
  const hasIssues = report.status === 'issues' || report.status === 'warnings'
  return (
    <div className="flex flex-col gap-3 px-4">
      {report.summary.length > 0 ? (
        <ul className="flex flex-col gap-1 text-13 text-muted-foreground">
          {report.summary.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-foreground-tertiary">
                •
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <DoctorSections sections={report.sections} />
      {/* "Fix problems automatically" — the one-click BFF action for doctor --fix.
          Only offered when the check found issues or warnings (honest: not shown when
          everything is already healthy, since there's nothing to fix). */}
      {hasIssues ? (
        <div className="border-t border-border pt-3">
          <DoItForMe
            label="Fix problems automatically"
            op={{ opId: 'doctor-fix', params: {} }}
            description="Tries to repair the issues above: creates missing config files and directories. Safe to run; it won't change your settings."
          />
        </div>
      ) : null}
    </div>
  )
}

/** A collapsible, per-section breakdown (title + ok/warn/error counts). */
function DoctorSections({ sections }: { sections: HermesDoctorReport['sections'] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (sections.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg py-1 text-left text-13',
          'focus-visible:ad-focus',
        )}
      >
        <ChevronDown
          className={cn(
            'size-4 text-foreground-tertiary transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span className="text-muted-foreground">
          {open ? 'Hide section breakdown' : 'View section breakdown'}
        </span>
      </button>
      {open ? (
        <ul id={panelId} className="mt-1 flex flex-col gap-1">
          {sections.map((s) => (
            <li
              key={s.title}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-13"
            >
              <span className="min-w-0 truncate text-foreground">{s.title}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                {s.error > 0 ? (
                  <span className="text-destructive">
                    {s.error}
                    <span aria-hidden>✗</span>
                    <span className="sr-only"> issue{s.error === 1 ? '' : 's'}</span>
                  </span>
                ) : null}
                {s.warning > 0 ? (
                  <span className="text-warning">
                    {s.warning}
                    <span aria-hidden>⚠</span>
                    <span className="sr-only"> warning{s.warning === 1 ? '' : 's'}</span>
                  </span>
                ) : null}
                <span className="text-success">
                  {s.ok}
                  <span aria-hidden>✓</span>
                  <span className="sr-only"> passed</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* AgentDeckUpdateCard                                                        */
/* -------------------------------------------------------------------------- */

function AgentDeckUpdateCard({ agentDeck }: { agentDeck: AgentDeckUpdateState }) {
  const noChannel = agentDeck.status === 'no-channel'
  const version = formatVersion(agentDeck.currentVersion)
  // Honest per-state copy. `no-channel` = no git remote (a pure local build);
  // otherwise a remote IS configured, so name the real (manual) update path
  // accurately instead of mislabeling it a "local build". One-click self-update
  // stays gated OFF in v1 either way (a self pull+rebuild+restart can clobber
  // uncommitted local work and risks a live service), so the action is always a
  // disabled, never-fake-succeeds state with the honest reason shown.
  const statusText = noChannel
    ? 'No update channel configured (local build)'
    : 'Tracked from a git remote'
  const description = noChannel
    ? "This app. Self-update isn't available without an update remote; pull and rebuild from the repo to update."
    : 'This app. Update by pulling and rebuilding from the repo, then restarting the service. One-click self-update is not enabled yet.'
  const disabledReason = noChannel
    ? 'No update remote configured (local build)'
    : 'Update from the repo, then restart the service'
  return (
    <DockCard
      icon={Package}
      title="Agentdeck"
      regionLabel="Agentdeck"
      status={
        <span className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{statusText}</span>
          {version ? (
            <span className="font-mono text-xs text-foreground-tertiary">{version}</span>
          ) : null}
        </span>
      }
      description={description}
      action={
        <Button disabled title={disabledReason}>
          Update Agentdeck
        </Button>
      }
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Shared card shell + confirm dialog                                        */
/* -------------------------------------------------------------------------- */

function DockCard({
  icon: Icon,
  title,
  regionLabel,
  status,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  regionLabel: string
  status: ReactNode
  description: string
  action: ReactNode
  children?: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} role="region" aria-label={regionLabel}>
      <Card className="ad-raised">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
              >
                <Icon className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle id={titleId}>{title}</CardTitle>
                {status}
              </div>
            </div>
            <div className="shrink-0">{action}</div>
          </div>
        </CardHeader>
        <CardContent className="-mt-1">
          <p className="text-13 leading-relaxed text-muted-foreground">{description}</p>
        </CardContent>
        {children}
      </Card>
    </section>
  )
}

/**
 * The honest confirm dialog used by the two mutating actions. The `body` states
 * the REAL cost in plain words; the confirm button carries the verb. Reuses the
 * themed Dialog primitive (focus-trap + ARIA + reduced-motion for free).
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** "0.15.1" → "v0.15.1"; already-prefixed passes through; null → empty. */
function formatVersion(version: string | null): string {
  if (!version) return ''
  return version.startsWith('v') ? version : `v${version}`
}

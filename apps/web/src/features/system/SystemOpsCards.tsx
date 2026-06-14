/**
 * SystemOpsCards — three dock cards for the System/Maintenance page:
 *
 *   SystemStatsCard   — live host/process snapshot (mem/disk/CPU/uptime).
 *                       Read-only; graceful when psutil is absent.
 *   CuratorCard       — pause/resume/run-now for the skill-maintenance daemon.
 *                       Degrades to "unavailable" when the module is absent.
 *   ProviderValidateCard — live-probes a provider key before saving.
 *                       All three honest outcomes (accepted/rejected/unreachable).
 *
 * Design spine:
 *  - No second accent. Live/active state uses --primary only.
 *  - <=14px radius on all surfaces.
 *  - AA contrast; reduced-motion + keyboard + SR parity.
 *  - No emoji icons, no glassmorphism.
 *  - Honest: no fake states, no fabricated "connected" claims.
 */
import { useState } from 'react'
import {
  Activity,
  CheckCircle,
  CircleOff,
  CirclePause,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  RefreshCw,
  Server,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import type { SystemStats, CuratorStatus, ProviderValidateResult } from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Shared formatting helpers                                                  */
/* -------------------------------------------------------------------------- */

/** Format bytes as a human-readable string (GiB / MiB). */
function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GiB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MiB`
  return `${bytes} B`
}

/** Format uptime seconds as "Xd Yh Zm". */
function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || parts.length === 0) parts.push(`${m}m`)
  return parts.join(' ')
}

/* -------------------------------------------------------------------------- */
/* SystemStatsCard                                                            */
/* -------------------------------------------------------------------------- */

export function SystemStatsCard({
  stats,
  isLoading,
  error,
}: {
  stats: SystemStats | null
  isLoading: boolean
  error: string | null
}) {
  return (
    <section role="region" aria-label="System stats">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="ad-surface grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
            >
              <Activity className="size-[18px]" />
            </span>
            <CardTitle>System resources</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
            Live host snapshot from Hermes. Read-only.
            {stats && !stats.psutil && (
              <span className="ml-1 italic">
                (psutil not installed, some metrics are unavailable)
              </span>
            )}
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-label="Loading" />
              Loading system stats...
            </div>
          ) : error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : stats ? (
            <dl className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-3">
              {stats.os && (
                <StatItem label="OS" value={stats.os} icon={<Server className="size-3.5" />} />
              )}
              {stats.arch && <StatItem label="Arch" value={stats.arch} />}
              {stats.hermes_version && <StatItem label="Hermes" value={stats.hermes_version} />}
              {stats.memory && (
                <StatItem
                  label="Memory"
                  value={`${fmtBytes(stats.memory.used)} / ${fmtBytes(stats.memory.total)}`}
                  icon={<MemoryStick className="size-3.5" />}
                  badge={`${stats.memory.percent.toFixed(0)}%`}
                  badgeDanger={stats.memory.percent > 85}
                />
              )}
              {stats.disk && (
                <StatItem
                  label="Disk"
                  value={`${fmtBytes(stats.disk.used)} / ${fmtBytes(stats.disk.total)}`}
                  icon={<HardDrive className="size-3.5" />}
                  badge={`${stats.disk.percent.toFixed(0)}%`}
                  badgeDanger={stats.disk.percent > 90}
                />
              )}
              {stats.cpu_percent !== undefined && (
                <StatItem label="CPU" value={`${stats.cpu_percent.toFixed(1)}%`} />
              )}
              {stats.load_avg && (
                <StatItem
                  label="Load"
                  value={stats.load_avg.map((n) => n.toFixed(2)).join(' / ')}
                />
              )}
              {stats.uptime_seconds !== undefined && (
                <StatItem label="Uptime" value={fmtUptime(stats.uptime_seconds)} />
              )}
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function StatItem({
  label,
  value,
  icon,
  badge,
  badgeDanger,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  badge?: string
  badgeDanger?: boolean
}) {
  return (
    <div className="ad-surface flex flex-col gap-0.5 rounded-lg bg-surface-1 px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[11px] text-foreground-tertiary">
        {icon}
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 font-mono text-[12px] text-foreground">
        {value}
        {badge && (
          <span
            className={cn(
              'rounded px-1 py-0.5 text-[10px] font-medium',
              badgeDanger ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
            )}
          >
            {badge}
          </span>
        )}
      </dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* CuratorCard                                                                */
/* -------------------------------------------------------------------------- */

export interface CuratorCardActions {
  onTogglePause: () => void
  onRunNow: () => void
  isPauseLoading: boolean
  isRunLoading: boolean
}

export function CuratorCard({
  curator,
  isLoading,
  error,
  actions,
}: {
  curator: CuratorStatus | null
  isLoading: boolean
  error: string | null
  actions: CuratorCardActions
}) {
  const unavailable = !curator?.available
  const paused = curator?.paused ?? false
  // A curator can be loaded (available) yet turned OFF in config (enabled:false).
  // It won't run in that state, so it must read "Disabled", never "Active" with a
  // live dot, and the pause/resume toggle (which only makes sense for a running
  // daemon) is hidden.
  const enabled = curator?.enabled ?? false
  const disabled = !unavailable && curator != null && !enabled

  return (
    <section role="region" aria-label="Curator">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="ad-surface grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
              >
                <RefreshCw className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle>Curator</CardTitle>
                {isLoading ? (
                  <span className="text-sm text-muted-foreground">Loading...</span>
                ) : unavailable ? (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <XCircle className="size-3.5 text-foreground-tertiary" aria-hidden />
                    Unavailable: curator module not installed
                  </span>
                ) : curator ? (
                  <span className="flex items-center gap-2 text-sm">
                    {disabled ? (
                      <>
                        <CircleOff className="size-3.5 text-foreground-tertiary" aria-hidden />
                        <span className="text-muted-foreground">Disabled</span>
                      </>
                    ) : paused ? (
                      <>
                        <CirclePause className="size-3.5 text-warning" aria-hidden />
                        <span className="text-muted-foreground">Paused</span>
                      </>
                    ) : (
                      <>
                        <span className="size-2.5 rounded-full bg-primary" aria-hidden />
                        <span className="text-muted-foreground">Active</span>
                      </>
                    )}
                    {curator.interval_hours != null && (
                      <span className="text-xs text-foreground-tertiary">
                        every {curator.interval_hours}h
                      </span>
                    )}
                  </span>
                ) : null}
              </div>
            </div>
            {!unavailable && curator && enabled && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actions.isPauseLoading}
                  onClick={actions.onTogglePause}
                  aria-label={paused ? 'Resume curator' : 'Pause curator'}
                >
                  {actions.isPauseLoading ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : paused ? (
                    <Play aria-hidden />
                  ) : (
                    <CirclePause aria-hidden />
                  )}
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actions.isRunLoading || paused}
                  onClick={actions.onRunNow}
                  title={paused ? 'Resume the curator to trigger a run' : undefined}
                >
                  {actions.isRunLoading ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  Run now
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="-mt-1">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            The curator periodically reviews skills, archiving stale ones and pinning active ones.
            Pausing it stops automatic reviews; "Run now" triggers one immediately (backgrounded).
          </p>
          {error && (
            <p className="mt-2 text-[13px] text-destructive" role="alert">
              {error}
            </p>
          )}
          {curator?.last_run_at && (
            <p className="mt-2 text-[12px] text-foreground-tertiary">
              Last run:{' '}
              <time dateTime={curator.last_run_at}>
                {new Date(curator.last_run_at).toLocaleString()}
              </time>
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* ProviderValidateCard                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ProviderValidateCard — a tool for validating a provider API key before saving.
 * Shows the three honest outcomes from Hermes (accepted / rejected / unreachable).
 * Lives on the System dock as a maintenance utility.
 */
export function ProviderValidateCard({
  isValidating,
  result,
  onValidate,
}: {
  isValidating: boolean
  result: ProviderValidateResult | null
  onValidate: (key: string, value: string) => void
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  const canValidate = key.trim().length > 0 && value.trim().length > 0

  return (
    <section role="region" aria-label="Provider key validation">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="ad-surface grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
            >
              <CheckCircle className="size-[18px]" />
            </span>
            <CardTitle>Validate provider key</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="-mt-1">
          <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
            Live-probe a provider API key before saving it. Hermes verifies the key against the
            provider directly.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="validate-key" className="text-[12px] font-medium text-foreground">
                Environment variable
              </label>
              <input
                id="validate-key"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. OPENAI_API_KEY"
                className="ad-surface rounded-[10px] border border-border bg-surface-1 px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-foreground-tertiary focus-visible:ad-focus"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="validate-value" className="text-[12px] font-medium text-foreground">
                Key value
              </label>
              <input
                id="validate-value"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-..."
                className="ad-surface rounded-[10px] border border-border bg-surface-1 px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-foreground-tertiary focus-visible:ad-focus"
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>
            <Button
              className="mt-1 self-start"
              disabled={!canValidate || isValidating}
              onClick={() => onValidate(key.trim(), value.trim())}
            >
              {isValidating ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Verifying...
                </>
              ) : (
                'Verify key'
              )}
            </Button>
          </div>
          {result && <ValidateResult result={result} />}
        </CardContent>
      </Card>
    </section>
  )
}

function ValidateResult({ result }: { result: ProviderValidateResult }) {
  if (result.ok && result.reachable) {
    return (
      <div
        className="mt-3 flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-[13px] text-success"
        role="status"
      >
        <CheckCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Key accepted: the provider recognized it.</span>
      </div>
    )
  }
  if (!result.ok && result.reachable) {
    return (
      <div
        className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
        role="alert"
      >
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{result.message || 'Key rejected: double-check it and try again.'}</span>
      </div>
    )
  }
  if (!result.reachable) {
    return (
      <div
        className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-[13px] text-warning"
        role="status"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {result.message || 'Could not reach the provider to verify the key.'} You can still save
          the key, but it may not work until the provider is reachable.
        </span>
      </div>
    )
  }
  return null
}

export function ProviderValidateBadge({ result }: { result: ProviderValidateResult | null }) {
  if (!result) return null
  if (result.ok && result.reachable) return <Badge variant="success">Verified</Badge>
  if (!result.ok && result.reachable) return <Badge variant="destructive">Rejected</Badge>
  return <Badge variant="warning">Unreachable</Badge>
}

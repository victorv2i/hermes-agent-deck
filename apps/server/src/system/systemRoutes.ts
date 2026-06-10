/**
 * SYSTEM / Maintenance-dock BFF routes (agent-deck-OWN, fs/exec-backed — NOT a
 * hermes-dashboard proxy):
 *
 *   GET  /api/agent-deck/system                  → SystemState
 *   POST /api/agent-deck/system/gateway/restart  → re-probed SystemGatewayState
 *   POST /api/agent-deck/system/hermes/update    → HermesUpdateApplyResult
 *
 * SECURITY / HONESTY:
 *  - SLIM + WHITELISTED. `hermes gateway status` returns a full systemd block
 *    (PID, unit path, memory, CGroup, log tail). We map it through the parsers in
 *    {@link ./hermesCli} to a single coarse run-state and parse the result through
 *    the protocol `SystemState`/`SystemGatewayState` schema — so a PID/path/log
 *    NEVER crosses the wire (asserted by the route's key-set test).
 *  - FAIL CLOSED. Availability is read from STDOUT (exit code is 0 either way);
 *    the parsers degrade to the conservative value (`unknown` / `up-to-date`).
 *  - agent-deck self-update reports `no-channel` when `git remote` is empty (a
 *    local build with no update channel) — the apply flow ships gated-off so it
 *    can never fake-succeed.
 *  - These mutating endpoints sit behind the SAME app-level auth/loopback gate as
 *    every other `/api/*` route (see app.ts onRequest hook) — no second gate here.
 *
 * The hermes update apply (`hermes update --backup --yes`) is exposed by the
 * Maintenance dock (S3): it runs the command, captures its output line-by-line
 * with EVERY line secret-scrubbed (token-shaped strings masked — git may echo a
 * credential-bearing remote URL), re-probes the installed version, and returns a
 * terminal {@link HermesUpdateApplyResult}. The apply is keyed off the read here:
 * the UI only enables it when `hermes.status === 'update-available'`.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import {
  SystemState,
  SystemGatewayState,
  HermesUpdateApplyResult,
  HermesUpdateChannel,
  HermesDoctorReport,
  type GatewayStatus,
  type HermesUpdateState,
  type HermesChannelState,
  type AgentDeckUpdateState,
  type AgentDeckUpdateStatus,
} from '@agent-deck/protocol'
import {
  runHermes,
  parseGatewayActive,
  parseUpdateCheck,
  parseVersion,
  parseDoctor,
  scrubSecrets,
  type ExecFileLike,
} from './hermesCli'

/**
 * The branch a `latest-commit` (bleeding-edge) channel tracks. Hermes ships from a
 * git checkout whose default branch is `main`; the latest-commit channel targets
 * that tip explicitly via `--branch main`. The `stable` channel uses NO `--branch`
 * flag — it tracks whatever the checkout already follows (the recommended default).
 */
const LATEST_COMMIT_BRANCH = 'main'

/** The argv suffix that selects a channel's update target (stable = none). */
function channelCheckArgs(channel: HermesUpdateChannel): string[] {
  return channel === 'latest-commit' ? ['--branch', LATEST_COMMIT_BRANCH] : []
}

/**
 * Resolve the apply route's optional `channel` body. An ABSENT channel defaults to
 * `stable`; a present-but-unrecognized value (e.g. a "tag" channel the CLI cannot
 * install) returns null → the route answers 400 rather than silently coercing it.
 * Validates by reusing the protocol's {@link HermesUpdateChannel} zod enum, so the
 * server needs no zod import of its own.
 */
function resolveChannel(body: unknown): HermesUpdateChannel | null {
  const raw = (body as { channel?: unknown } | null | undefined)?.channel
  if (raw === undefined || raw === null) return 'stable'
  const parsed = HermesUpdateChannel.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export interface SystemRouteDeps {
  /** Absolute path (or PATH name) of the `hermes` binary. */
  hermesBin: string
  /** Injectable execFile (tests). Forwarded to {@link runHermes}. */
  execFile?: ExecFileLike
  /** Running agent-deck version (package.json), or null when unreadable. */
  agentDeckVersion: string | null
  /**
   * List the configured git remotes for the agent-deck checkout. An EMPTY list →
   * `no-channel` (a local build, the self-update ships honestly disabled).
   * Injectable for tests; the integrator wires the real `git remote` probe.
   */
  listGitRemotes: () => Promise<string[]>
}

/** Probe the gateway run-state via `hermes gateway status` (fail-closed). */
async function probeGateway(deps: SystemRouteDeps): Promise<GatewayStatus> {
  try {
    const { stdout } = await runHermes(['gateway', 'status'], {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
    })
    return parseGatewayActive(stdout)
  } catch {
    // Spawn failure (hermes missing) → fail closed to unknown.
    return 'unknown'
  }
}

/**
 * Probe the installed Hermes version + BOTH channels' update availability (all
 * fail-closed). The top-level `status` mirrors the STABLE channel (the default the
 * checkout tracks) so a channel-unaware reader still sees an honest verdict; the
 * `channels` array carries each channel's independent `--check` result.
 */
async function probeHermesUpdate(deps: SystemRouteDeps): Promise<HermesUpdateState> {
  const currentVersion = await probeHermesVersion(deps)
  const channels = await probeHermesChannels(deps, currentVersion)
  const stable = channels.find((c) => c.channel === 'stable')
  return { status: stable?.status ?? 'up-to-date', currentVersion, channels }
}

/** Installed Hermes version, or null when `hermes version` cannot run/parse. */
async function probeHermesVersion(deps: SystemRouteDeps): Promise<string | null> {
  try {
    const v = await runHermes(['version'], { hermesBin: deps.hermesBin, execFile: deps.execFile })
    return parseVersion(v.stdout)
  } catch {
    return null
  }
}

/** Probe every honest channel's availability in parallel (each fail-closed). */
async function probeHermesChannels(
  deps: SystemRouteDeps,
  currentVersion: string | null,
): Promise<HermesChannelState[]> {
  const channels = HermesUpdateChannel.options
  return Promise.all(
    channels.map(async (channel) => ({
      channel,
      status: await probeHermesChannelStatus(deps, channel),
      currentVersion,
    })),
  )
}

/**
 * One channel's update availability from `hermes update --check [--branch main]`.
 * STDOUT-driven (exit code is 0 either way); fail closed to `up-to-date` on any
 * failure so a network hiccup or a missing branch never fabricates an update.
 */
async function probeHermesChannelStatus(
  deps: SystemRouteDeps,
  channel: HermesUpdateChannel,
): Promise<HermesChannelState['status']> {
  try {
    const c = await runHermes(['update', '--check', ...channelCheckArgs(channel)], {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
    })
    return parseUpdateCheck(c.stdout)
  } catch {
    return 'up-to-date'
  }
}

/**
 * Resolve the agent-deck self-update state. With NO git remote the repo has no
 * update channel → `no-channel` (the action ships disabled with a visible
 * reason). With a remote configured the channel exists but v1 still ships the
 * apply gated off, so the resting status is `idle` (the UI keeps the button
 * disabled either way in v1; the distinction is honest, not a promise to apply).
 */
async function probeAgentDeckUpdate(deps: SystemRouteDeps): Promise<AgentDeckUpdateState> {
  const status = await probeAgentDeckStatus(deps)
  return { status, currentVersion: deps.agentDeckVersion }
}

/** `no-channel` when no git remote (a local build); `idle` when a remote exists. */
async function probeAgentDeckStatus(deps: SystemRouteDeps): Promise<AgentDeckUpdateStatus> {
  try {
    const remotes = await deps.listGitRemotes()
    return remotes.length > 0 ? 'idle' : 'no-channel'
  } catch {
    return 'no-channel'
  }
}

/**
 * Apply a Hermes update on the chosen CHANNEL, capturing its output as a
 * SECRET-SCRUBBED log, then re-probe the installed version. The argv is the real
 * CLI: `stable` → `update --backup --yes` (the default channel); `latest-commit` →
 * `update --branch main --backup --yes` (the bleeding-edge branch tip). The
 * terminal status comes from the command's exit (`ok`): success → `up-to-date` (the
 * apply landed or there was nothing to do), non-zero / spawn failure → `failed`.
 * Every log line is scrubbed here — token-shaped strings are masked BEFORE they
 * leave the BFF, so the collapsible log can carry no credential (git may echo a
 * credential-bearing remote URL).
 */
async function applyHermesUpdate(
  deps: SystemRouteDeps,
  channel: HermesUpdateChannel,
): Promise<HermesUpdateApplyResult> {
  let status: HermesUpdateApplyResult['status']
  const rawLines: string[] = []
  try {
    const result = await runHermes(['update', ...channelCheckArgs(channel), '--backup', '--yes'], {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
      // The apply hits git/network; give it more headroom than the 60s probes.
      timeoutMs: 300_000,
    })
    status = result.ok ? 'up-to-date' : 'failed'
    rawLines.push(...splitLines(result.stdout), ...splitLines(result.stderr))
  } catch (err) {
    // A true spawn failure (hermes missing) → failed, with an honest one-liner.
    status = 'failed'
    rawLines.push(err instanceof Error ? err.message : 'The update command could not run.')
  }
  // Re-probe the version AFTER the apply so the card reflects reality, not a guess.
  const currentVersion = await probeHermesVersion(deps)
  // Scrub EVERY line before it crosses the wire; parse through the schema so only
  // the whitelisted keys can surface.
  return HermesUpdateApplyResult.parse({
    status,
    log: rawLines.map((l) => scrubSecrets(l)),
    currentVersion,
    channel,
  })
}

/**
 * Run `hermes doctor` and return the slim, secret-scrubbed {@link HermesDoctorReport}.
 * Read-only by design (NO `--fix`, which mutates config). The footer summary lines
 * are scrubbed before they cross the wire (doctor can echo a path/value); the parser
 * fails closed to `unavailable` on empty/garbled output, and a spawn failure (hermes
 * missing) lands there too — never a fabricated "healthy".
 */
async function runDoctor(deps: SystemRouteDeps): Promise<HermesDoctorReport> {
  let report: HermesDoctorReport
  try {
    const result = await runHermes(['doctor'], {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
      // doctor runs parallel connectivity checks; give it headroom past the 60s default.
      timeoutMs: 120_000,
    })
    report = parseDoctor(result.stdout)
  } catch {
    report = {
      status: 'unavailable',
      counts: { ok: 0, warning: 0, error: 0 },
      sections: [],
      summary: [],
    }
  }
  // Scrub the footer summary lines, then parse through the schema (slim — strips any
  // non-whitelisted key, so the raw multi-KB output can never ride along).
  return HermesDoctorReport.parse({
    ...report,
    summary: report.summary.map((l) => scrubSecrets(l)),
  })
}

/** Split captured output into non-empty trimmed-right lines (drops a trailing \n). */
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)
}

/** Build the combined SystemState (each probe independently fail-closed). */
async function readSystemState(deps: SystemRouteDeps): Promise<SystemState> {
  const [gateway, hermes, agentDeck] = await Promise.all([
    probeGateway(deps),
    probeHermesUpdate(deps),
    probeAgentDeckUpdate(deps),
  ])
  // Parse through the schema so only whitelisted keys can ever surface.
  return SystemState.parse({ gateway: { status: gateway }, hermes, agentDeck })
}

/**
 * Fastify plugin. Mount with no prefix (paths are absolute):
 *   await app.register(registerSystemRoutes, deps)
 */
export const registerSystemRoutes: FastifyPluginAsync<SystemRouteDeps> = async (
  app: FastifyInstance,
  deps: SystemRouteDeps,
) => {
  app.get('/api/agent-deck/system', async (): Promise<SystemState> => {
    return readSystemState(deps)
  })

  app.post('/api/agent-deck/system/gateway/restart', async (): Promise<SystemGatewayState> => {
    // Restart, then RE-PROBE — never report success from the restart command's
    // own exit (it backgrounds a systemd unit). The re-probe is the truth.
    try {
      await runHermes(['gateway', 'restart'], {
        hermesBin: deps.hermesBin,
        execFile: deps.execFile,
      })
    } catch {
      // A failed restart command still falls through to the honest re-probe
      // below — we report the gateway's ACTUAL state, not the command's exit.
    }
    const status = await probeGateway(deps)
    return SystemGatewayState.parse({ status })
  })

  app.post(
    '/api/agent-deck/system/hermes/update',
    async (req, reply): Promise<HermesUpdateApplyResult> => {
      // Resolve the requested channel (default STABLE when the body omits it). An
      // unknown channel value is a 400 — we never fabricate a channel the CLI lacks.
      const channel = resolveChannel(req.body)
      if (channel === null) {
        reply.code(400)
        return reply.send({ error: 'Invalid channel' }) as never
      }
      // Run the channel's real `hermes update` argv, scrub + capture the log,
      // re-probe the version. The apply restarts the gateway as a side effect (the
      // UI confirm states this); we report the TERMINAL outcome, never a fake one.
      return applyHermesUpdate(deps, channel)
    },
  )

  app.post('/api/agent-deck/system/doctor', async (): Promise<HermesDoctorReport> => {
    // Run `hermes doctor` (read-only) and return the slim, scrubbed health rollup.
    // On-demand: doctor is slow (parallel connectivity checks), so it never runs as
    // part of the resting GET read.
    return runDoctor(deps)
  })
}

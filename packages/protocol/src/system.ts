import { z } from 'zod'

/**
 * SYSTEM / maintenance contract — the typed shapes behind the Maintenance dock
 * (restart the gateway, update Hermes, the gated-off agent-deck self-update).
 *
 * Two hard rules live in these types:
 *  1. SLIM + WHITELISTED. `hermes gateway status` returns a full systemd block
 *     (PID, paths, memory, log tail). {@link SystemGatewayState} carries ONLY a
 *     coarse run-state, and `.parse()` strips everything else — a remote operator
 *     never learns the host's internals (see the key-set test).
 *  2. FAIL CLOSED. Availability comes from CLI STDOUT (exit code is 0 either
 *     way), so the BFF parsers resolve to the CONSERVATIVE value on unrecognized
 *     output — `unknown` for the gateway, `up-to-date` for an update — never
 *     guessing that an update exists.
 */

/** Coarse gateway run-state. `unknown` = fail-closed (unrecognized status output). */
export const GatewayStatus = z.enum(['running', 'stopped', 'failed', 'unknown'])
export type GatewayStatus = z.infer<typeof GatewayStatus>

/** The ONLY gateway info that crosses the wire (no PID/path/memory/log). */
export const SystemGatewayState = z.object({
  status: GatewayStatus,
})
export type SystemGatewayState = z.infer<typeof SystemGatewayState>

/** Result of `POST /api/agent-deck/system/gateway/restart` — the re-probed state. */
export const GatewayRestartResponse = SystemGatewayState
export type GatewayRestartResponse = z.infer<typeof GatewayRestartResponse>

/** Hermes self-update lifecycle. `up-to-date` is the fail-closed resting value. */
export const HermesUpdateStatus = z.enum([
  'idle',
  'checking',
  'up-to-date',
  'update-available',
  'updating',
  'failed',
])
export type HermesUpdateStatus = z.infer<typeof HermesUpdateStatus>

/**
 * The two HONEST Hermes update channels. Hermes ships from a git checkout, so the
 * only update lever the CLI exposes is a BRANCH (`hermes update` tracks the default
 * branch; `hermes update --branch NAME` targets another tip) — there is NO `--tag`
 * apply. So:
 *  - `stable`        → the DEFAULT channel the checkout already tracks (no `--branch`).
 *  - `latest-commit` → the bleeding-edge branch tip (`--branch main`), advanced.
 * We deliberately do NOT model a "release tag" channel: the CLI cannot install one,
 * and an honest UI never offers an action it cannot perform.
 */
export const HermesUpdateChannel = z.enum(['stable', 'latest-commit'])
export type HermesUpdateChannel = z.infer<typeof HermesUpdateChannel>

/**
 * One channel's independent `hermes update --check` verdict + the installed version.
 * `status` is fail-closed (`up-to-date` on unrecognized/failed check output, never a
 * fabricated "available").
 */
export const HermesChannelState = z.object({
  channel: HermesUpdateChannel,
  status: HermesUpdateStatus,
  /** Installed Hermes version, or null when unreadable. */
  currentVersion: z.string().nullable(),
})
export type HermesChannelState = z.infer<typeof HermesChannelState>

/** Hermes update state. `currentVersion` is ground-truth (`hermes version`). */
export const HermesUpdateState = z.object({
  status: HermesUpdateStatus,
  /** Installed Hermes version, or null when unreadable. Always shown. */
  currentVersion: z.string().nullable(),
  /**
   * Per-channel `--check` verdicts (stable + latest-commit), when the dock probed
   * them. OPTIONAL for back-compat: an older read without channels still parses,
   * and the card falls back to the single top-level `status` when absent.
   */
  channels: z.array(HermesChannelState).optional(),
})
export type HermesUpdateState = z.infer<typeof HermesUpdateState>

/**
 * agent-deck self-update lifecycle. `no-channel` = the repo has no update remote
 * configured (a local build) → the action ships HONESTLY DISABLED with a visible
 * reason, never a fake "update available".
 */
export const AgentDeckUpdateStatus = z.enum([
  'idle',
  'checking',
  'up-to-date',
  'update-available',
  'updating',
  'failed',
  'no-channel',
])
export type AgentDeckUpdateStatus = z.infer<typeof AgentDeckUpdateStatus>

/** agent-deck update state. */
export const AgentDeckUpdateState = z.object({
  status: AgentDeckUpdateStatus,
  /** Running agent-deck version (package.json), or null when unreadable. */
  currentVersion: z.string().nullable(),
})
export type AgentDeckUpdateState = z.infer<typeof AgentDeckUpdateState>

/** The combined read for `GET /api/agent-deck/system` (the Maintenance dock). */
export const SystemState = z.object({
  gateway: SystemGatewayState,
  hermes: HermesUpdateState,
  agentDeck: AgentDeckUpdateState,
})
export type SystemState = z.infer<typeof SystemState>

/**
 * Result of `POST /api/agent-deck/system/hermes/update` (`hermes update --backup
 * --yes`). The apply has run to completion, so the `status` is TERMINAL — never
 * the transient `checking`/`updating` (the route only resolves once the command
 * exits): `up-to-date` (succeeded / nothing to do) or `failed`.
 *
 * `log` is the command's captured output, ALREADY secret-scrubbed by the BFF
 * (token-shaped strings masked) — it is safe to render verbatim in the
 * collapsible log. `.parse()` is SLIM: it strips any extra key (raw stderr, a
 * PID), so an un-scrubbed internal can never ride along.
 */
export const HermesUpdateApplyResult = z.object({
  /** Terminal outcome of the apply (never mid-flight). */
  status: z.enum(['up-to-date', 'failed']),
  /** The command's captured output, already secret-scrubbed, line by line. */
  log: z.array(z.string()),
  /** Re-probed Hermes version after the apply, or null when unreadable. */
  currentVersion: z.string().nullable(),
  /** Which channel the apply targeted, echoed back. Optional for back-compat. */
  channel: HermesUpdateChannel.optional(),
})
export type HermesUpdateApplyResult = z.infer<typeof HermesUpdateApplyResult>

/* -------------------------------------------------------------------------- */
/* Doctor / health (hermes doctor)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Coarse health verdict from `hermes doctor`:
 *  - `ok`          → zero warnings and zero errors.
 *  - `warnings`    → at least one warning, no errors.
 *  - `issues`      → at least one error.
 *  - `unavailable` → the command could not run / produced no parseable output
 *                    (fail-closed honest state, never a fake "healthy").
 */
export const HermesDoctorStatus = z.enum(['ok', 'warnings', 'issues', 'unavailable'])
export type HermesDoctorStatus = z.infer<typeof HermesDoctorStatus>

/** A single `◆ Section` rollup — COUNTS only (no raw line, so no secret rides along). */
export const HermesDoctorSection = z.object({
  title: z.string(),
  ok: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
})
export type HermesDoctorSection = z.infer<typeof HermesDoctorSection>

/**
 * The slim, secret-scrubbed `hermes doctor` rollup the Doctor card renders. SLIM by
 * design: `.parse()` strips any extra key (the raw multi-KB output, a PID), so only
 * the whitelisted health summary crosses the wire — the same discipline as the
 * gateway status block. The footer `summary` lines (e.g. "Run 'hermes setup' …") are
 * scrubbed by the BFF before they land here.
 */
export const HermesDoctorReport = z.object({
  status: HermesDoctorStatus,
  /** Aggregate counts across all sections. */
  counts: z.object({
    ok: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  /** Per-section rollup (title + counts), in doctor's own order. */
  sections: z.array(HermesDoctorSection),
  /** The footer "Found N issue(s)" action lines, secret-scrubbed. */
  summary: z.array(z.string()),
})
export type HermesDoctorReport = z.infer<typeof HermesDoctorReport>

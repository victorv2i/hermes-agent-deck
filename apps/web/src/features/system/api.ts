import { apiFetch, apiPost } from '@/lib/apiFetch'
import {
  SystemState,
  SystemGatewayState,
  HermesUpdateApplyResult,
  HermesDoctorReport,
  type HermesUpdateChannel,
} from '@agent-deck/protocol'

/**
 * The Maintenance dock's BFF client (agent-deck-OWN routes — NOT hermes proxies):
 *
 *   GET  /api/agent-deck/system                  → SystemState
 *   POST /api/agent-deck/system/gateway/restart  → SystemGatewayState (re-probed)
 *   POST /api/agent-deck/system/hermes/update    → HermesUpdateApplyResult
 *   POST /api/agent-deck/system/doctor           → HermesDoctorReport
 *
 * Every response is parsed through the shared protocol zod schema, so a partial
 * or unexpected payload throws here (caught by the query/mutation) rather than
 * rendering a half-built card — and only the whitelisted, secret-free keys are
 * ever trusted on the client.
 */

/** Read the combined dock state (gateway run-state + both update reads). */
export async function fetchSystem(signal?: AbortSignal): Promise<SystemState> {
  return SystemState.parse(await apiFetch<unknown>('/system', { signal }))
}

/** Restart the gateway, returning the RE-PROBED run-state (never the cmd's exit). */
export async function restartGateway(): Promise<SystemGatewayState> {
  return SystemGatewayState.parse(await apiPost<unknown>('/system/gateway/restart', {}))
}

/**
 * Apply a Hermes update on the chosen CHANNEL. `stable` (default) runs the default
 * `hermes update --backup --yes`; `latest-commit` runs `… --branch main --backup
 * --yes` (the bleeding-edge branch tip). Resolves once the command has run to
 * completion with a TERMINAL status, the already-scrubbed log, the re-probed
 * version, and the channel echo. The route restarts the gateway as a side effect
 * (the confirm copy states this).
 */
export async function applyHermesUpdate(
  channel: HermesUpdateChannel = 'stable',
): Promise<HermesUpdateApplyResult> {
  return HermesUpdateApplyResult.parse(await apiPost<unknown>('/system/hermes/update', { channel }))
}

/**
 * Run `hermes doctor` (read-only) and return the slim, secret-scrubbed health
 * rollup. On-demand — doctor runs parallel connectivity checks, so it is never part
 * of the resting dock read.
 */
export async function runDoctor(): Promise<HermesDoctorReport> {
  return HermesDoctorReport.parse(await apiPost<unknown>('/system/doctor', {}))
}

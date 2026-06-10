/**
 * MESSAGING SERVICE — the PURE composition layer behind the Messaging Hub BFF.
 *
 * It fuses three reads into the wire {@link MessagingState}:
 *   1. the static {@link MESSAGING_REGISTRY} (which platforms + token env vars),
 *   2. the gateway's REAL per-platform connection truth from `/api/status`
 *      (`gateway_platforms[<id>].state` + `error_message`, + `gateway_running`),
 *   3. each token's SHAPE (is_set + redacted preview) from `/api/env`.
 *
 * No network here — the route module does the fetches and hands raw bodies in.
 * Everything is fail-closed: when the gateway isn't running we report `unknown`
 * (we cannot claim a platform is connected OR disconnected), and a plaintext
 * token never enters the result (we read ONLY `is_set` / `redacted_value`).
 */
import {
  MessagingState,
  type MessagingConnection,
  type MessagingPlatformState,
  type MessagingTokenField,
} from '@agent-deck/protocol'
import { MESSAGING_REGISTRY, type MessagingRegistryEntry } from './registry'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Raw `/api/env` entry shape (only the SHAPE-ONLY fields are ever read). */
interface RawEnvEntry {
  is_set?: unknown
  redacted_value?: unknown
}

/** Raw per-platform `/api/status` rollup entry. */
interface RawPlatformStatus {
  state?: unknown
  error_message?: unknown
  error_code?: unknown
}

/** Inputs to the per-platform connection decision. */
export interface ConnectionInputs {
  /** The gateway's reported `state` string for this id, or null if absent. */
  raw: string | null
  /** Whether at least one of this platform's tokens is stored. */
  tokenStored: boolean
  /** Whether the gateway is running at all (its truth is only live when true). */
  gatewayRunning: boolean
}

/**
 * Map the gateway's free-form per-platform state into the governed
 * {@link MessagingConnection}, fail-closed:
 *  - gateway DOWN → `unknown` (we cannot claim truth — never "disconnected").
 *  - a recognized healthy state → `connected`.
 *  - a recognized failure state → `error`.
 *  - an explicit `connecting`/transient state, OR an absent id while a token is
 *    stored → `connecting` (token present, waiting on the gateway).
 *  - absent + no token → `not_configured`.
 *  - anything else with the gateway up → `unknown` (don't invent a green dot).
 */
export function mapConnection(inputs: ConnectionInputs): MessagingConnection {
  const { raw, tokenStored, gatewayRunning } = inputs
  // The gateway's per-platform truth is only meaningful while it's running.
  if (!gatewayRunning) return 'unknown'

  const s = (raw ?? '').toLowerCase()
  // The REAL per-platform states (hermes gateway/run.py): connected/running/ok,
  // connecting/starting, error/failed/degraded, stopped/stopping. (There is no
  // "disconnected"/"down"/"reconnecting" on this surface.)
  if (s === 'connected' || s === 'running' || s === 'ok') return 'connected'
  if (s === 'error' || s === 'failed' || s === 'degraded') return 'error'
  if (s === 'connecting' || s === 'starting') return 'connecting'
  // `stopped`/`stopping`: configured but intentionally not active — neither a
  // green dot nor a red error. No dedicated enum value, so degrade to `unknown`
  // (the card renders a neutral "not connected", not an alarm).
  if (s === 'stopped' || s === 'stopping') return 'unknown'

  // No recognizable state from the gateway. If a token is stored we're honestly
  // "connecting" (stored, waiting on the gateway to pick it up); otherwise the
  // platform simply isn't configured yet.
  if (s === '') return tokenStored ? 'connecting' : 'not_configured'

  // An unrecognized non-empty state: don't guess a positive — degrade honestly.
  return 'unknown'
}

/**
 * Project a registry entry's token env vars onto SHAPE-ONLY wire fields, reading
 * `is_set` + `redacted_value` from the raw `/api/env` body. A missing entry is
 * treated as unset. The plaintext is NEVER read (the dashboard doesn't return it
 * on GET, and even a hostile body's `value` is ignored).
 */
export function buildTokenFields(
  entry: MessagingRegistryEntry,
  envBody: Record<string, unknown>,
): MessagingTokenField[] {
  return entry.tokenEnvVars.map((t) => {
    const rawEntry = envBody[t.envVar]
    const e: RawEnvEntry = rawEntry && typeof rawEntry === 'object' ? (rawEntry as RawEnvEntry) : {}
    const isSet = e.is_set === true
    const redacted = isSet && typeof e.redacted_value === 'string' ? e.redacted_value : null
    return { envVar: t.envVar, label: t.label, isSet, redactedValue: redacted }
  })
}

/** Read the per-platform status entry for an id from a raw `/api/status` body. */
function platformStatus(statusBody: Record<string, unknown>, id: string): RawPlatformStatus {
  const rollup = statusBody.gateway_platforms
  if (!rollup || typeof rollup !== 'object') return {}
  const entry = (rollup as Record<string, unknown>)[id]
  return entry && typeof entry === 'object' ? (entry as RawPlatformStatus) : {}
}

/**
 * Compose the whole {@link MessagingState} from a raw `/api/status` body and a
 * raw `/api/env` body. The result is parsed through the protocol schema so a
 * malformed upstream can never widen the wire shape.
 */
export function composeMessagingState(
  statusBody: Record<string, unknown>,
  envBody: Record<string, unknown>,
): MessagingState {
  const gatewayRunning = statusBody.gateway_running === true

  const platforms: MessagingPlatformState[] = MESSAGING_REGISTRY.map((entry) => {
    const tokens = buildTokenFields(entry, envBody)
    const tokenStored = tokens.some((t) => t.isSet)

    const ps = platformStatus(statusBody, entry.id)
    const rawState = str(ps.state) || null
    const connection = mapConnection({ raw: rawState, tokenStored, gatewayRunning })

    // A human error only when the connection is actually an error; prefer the
    // message, fall back to the code, else null. Never echo other fields.
    const errorMessage =
      connection === 'error' ? str(ps.error_message) || str(ps.error_code) || null : null

    return {
      platform: {
        id: entry.id,
        label: entry.label,
        setupUrl: entry.setupUrl,
        steps: [...entry.steps],
      },
      connection,
      errorMessage,
      tokens,
    }
  })

  return MessagingState.parse({ platforms, gatewayRunning })
}

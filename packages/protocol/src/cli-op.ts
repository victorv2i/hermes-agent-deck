import { z } from 'zod'

/**
 * CLI-OP contract — the typed shapes behind `POST /api/agent-deck/cli-op`.
 *
 * This is an agent-deck-OWN route (NOT a Hermes dashboard proxy). It dispatches
 * real `hermes` CLI invocations via the whitelist in `hermesCliOps.ts` (execFile,
 * no shell). The wire contract is intentionally SLIM:
 *
 *  - The REQUEST carries only the whitelisted opId + typed params (no raw argv).
 *  - The RESPONSE carries only the scrubbed stdout + a plain-English summary +
 *    the exit-code truth. No secrets, no PIDs, no raw stderr.
 *
 * SECURITY:
 *  - `opId` is validated against the server-side ALLOWED_OPS whitelist — an
 *    unknown id is rejected before execFile is called.
 *  - `params.provider` (for auth-status / auth-logout) is validated against
 *    KNOWN_PROVIDERS (an enum of safe slug strings) — never raw user input as argv.
 *  - `stdout` in the response has already been secret-scrubbed by the BFF.
 *
 * The zod schemas here are the single source of truth for the wire shape; both
 * the server route and the web client import from this module.
 */

/**
 * The whitelisted op IDs — must stay in sync with the server-side ALLOWED_OPS
 * registry. New ops MUST be added there first and here second (the server is the
 * authority; zod is the wire contract).
 */
export const CliOpId = z.enum([
  'doctor-fix',
  'auth-list',
  'auth-status',
  'auth-logout',
  'tools-list',
])
export type CliOpId = z.infer<typeof CliOpId>

/**
 * Op-specific params. For ops with no required params (`doctor-fix`, `auth-list`,
 * `tools-list`) this is an empty object. For provider-scoped ops the `provider`
 * slug is required.
 *
 * SECURITY: `provider` must be an alphanumeric/dash slug — the zod regex enforces
 * this format, and the server validates the value against KNOWN_PROVIDERS before
 * it ever reaches execFile. A hostile string that passes the regex would still be
 * caught by the server's enum check.
 */
export const CliOpParams = z
  .object({
    /** Provider slug, required for auth-status and auth-logout ops. */
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'provider must be a safe slug')
      .optional(),
  })
  .strict()
export type CliOpParams = z.infer<typeof CliOpParams>

/** Request body for `POST /api/agent-deck/cli-op`. */
export const CliOpRequest = z
  .object({
    /** The whitelisted op to run. */
    opId: CliOpId,
    /** Op-specific typed params (empty object for no-param ops). */
    params: CliOpParams.default({}),
  })
  .strict()
export type CliOpRequest = z.infer<typeof CliOpRequest>

/**
 * Response for `POST /api/agent-deck/cli-op`.
 *
 * `stdout` is the command's SCRUBBED captured output (token-shaped strings masked
 * before they leave the BFF). `summary` is a plain-English one-liner ("completed
 * successfully" / "exited with errors"). `exitCode` is the real terminal code —
 * zero for success, non-zero for failure, -1 for spawn failure. No raw stderr,
 * no PID, no path info.
 */
export const CliOpResponse = z.object({
  /** true when the command exited 0 */
  ok: z.boolean(),
  /** The command's scrubbed stdout, safe to render verbatim. */
  stdout: z.string(),
  /** Plain-English outcome. No raw error text from Hermes internals. */
  summary: z.string(),
  /** Real exit code (0 success, non-zero failure, -1 spawn failure). */
  exitCode: z.number().int(),
  /**
   * Op-specific parsed result (optional — the UI renders `stdout` for generic
   * display; `parsed` is for feature-specific structured reads like
   * auth-list → credential counts). Schema is not validated here; the server
   * owns the typed parse, the client reads what it understands.
   */
  parsed: z.unknown().optional(),
})
export type CliOpResponse = z.infer<typeof CliOpResponse>

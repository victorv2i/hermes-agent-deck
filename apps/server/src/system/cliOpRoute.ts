/**
 * CLI-OP BFF route (agent-deck-OWN, NOT a Hermes dashboard proxy):
 *
 *   POST /api/agent-deck/cli-op  → CliOpResponse
 *
 * Runs real `hermes` CLI ops via the whitelist in {@link dispatchHermesOp}.
 * This route deliberately lives in the agent-deck namespace rather than the
 * knownHermesRoutes proxy namespace — it shells out to the `hermes` binary
 * via execFile (no HTTP, no dashboard), so it is a different integration point
 * from the dashboard-proxy routes.
 *
 * SECURITY (all enforced in hermesCliOps.dispatchHermesOp):
 *  - opId is validated against ALLOWED_OPS before execFile is called.
 *  - provider params are validated against KNOWN_PROVIDERS (an enum whitelist)
 *    before they ever enter argv. No raw user string reaches execFile.
 *  - execFile only, no shell — no shell injection possible.
 *  - stdout is scrubbed through scrubSecrets before the response is sent.
 *  - Response carries no raw stderr, no PID, no internal paths.
 *
 * The route sits behind the SAME app-level auth/loopback gate as every other
 * `/api/*` route (see app.ts onRequest hook) — no second gate here.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { CliOpRequest, CliOpResponse } from '@agent-deck/protocol'
import { dispatchHermesOp } from './hermesCliOps'
import type { ExecFileLike } from './hermesCli'

export interface CliOpRouteDeps {
  /** Absolute path (or PATH name) of the `hermes` binary. */
  hermesBin: string
  /** Injectable execFile (tests). Forwarded to {@link dispatchHermesOp}. */
  execFile?: ExecFileLike
}

/**
 * Fastify plugin. Mount with no prefix (path is absolute):
 *   await app.register(registerCliOpRoute, deps)
 */
export const registerCliOpRoute: FastifyPluginAsync<CliOpRouteDeps> = async (
  app: FastifyInstance,
  deps: CliOpRouteDeps,
) => {
  app.post('/api/agent-deck/cli-op', async (req, reply) => {
    // 1. Parse + validate the request body through the zod schema. Unknown opIds
    //    and malformed params are rejected here (before dispatchHermesOp).
    const parsed = CliOpRequest.safeParse(req.body)
    if (!parsed.success) {
      reply.code(400)
      return reply.send({ error: 'invalid_request', detail: parsed.error.message })
    }

    const { opId, params } = parsed.data

    // 2. Dispatch through the whitelist. The dispatcher validates opId against
    //    ALLOWED_OPS, validates params (provider slug) against KNOWN_PROVIDERS,
    //    builds argv from FIXED fragments + enum-validated params, and runs via
    //    execFile. stdout is scrubbed before it reaches the result.
    const result = await dispatchHermesOp(opId, params as Record<string, unknown>, {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
    })

    // 3. Parse the result through the protocol schema — strips any extra key so
    //    only the whitelisted response fields can cross the wire.
    return CliOpResponse.parse(result)
  })
}

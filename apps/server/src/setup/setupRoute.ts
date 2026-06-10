/**
 * SETUP / onboarding BFF routes (agent-deck-OWN, fs/exec-backed):
 *
 *   GET  /api/agent-deck/setup-status        → SetupStatus (low-level probe)
 *   POST /api/agent-deck/setup/provider-key   → AgentDeckProviderKeyResponse
 *
 * `setup-status` is a SEPARATE low-level readiness probe — it does NOT proxy the
 * dashboard's `/api/status` (which presupposes the dashboard is up). Each field is
 * a genuine fs/exec check, never a remembered flag:
 *   hermesInstalled   ← `hermes version` resolves (which + run)
 *   providerConnected ← a usable model is reported (injected probe, fail-closed)
 *   agentNamed        ← the default profile has `.agent-deck/identity.json`
 *
 * `setup/provider-key` drives the one connect step the BFF can: a guarded
 * `hermes auth add <provider> --type api-key --api-key <key>`.
 *
 * SECURITY — the api key is a LIVE SECRET:
 *  - argv-only (no shell), so the key can never be re-parsed by a shell.
 *  - MASKED in any log line ({@link runHermes}'s `secretArgs` scrub) — the value
 *    is passed to `log` only as `[redacted]`. With no `log` wired, nothing about
 *    the argv is written at all.
 *  - NEVER echoed back: the response carries only the provider + a connected bool.
 *  - On failure the route returns a generic 502 with NO key in the body.
 *
 * These routes sit behind the SAME app-level auth/loopback gate as every other
 * `/api/*` route (app.ts onRequest hook).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import {
  SetupStatus,
  AgentDeckProviderKeyRequest,
  AgentDeckProviderKeyResponse,
} from '@agent-deck/protocol'
import { readProfileAvatar } from '../profiles/profilesReader'
import { runHermes, type ExecFileLike } from '../system/hermesCli'

export interface SetupRouteDeps {
  /** HERMES_HOME to probe the default profile's identity.json under. */
  hermesHome: string
  /** Absolute path (or PATH name) of the `hermes` binary. */
  hermesBin: string
  /** Injectable execFile (tests). Forwarded to {@link runHermes}. */
  execFile?: ExecFileLike
  /**
   * Probe whether a usable model/provider is connected. Injected so the route
   * stays decoupled from the dashboard client; the integrator wires it to a real
   * `/api/model/info` read. Throwing or resolving false → `providerConnected:false`
   * (fail closed — never claim a model is connected on an error).
   */
  probeProviderConnected: () => Promise<boolean>
  /**
   * Optional audit sink for the provider-key add (the argv is REDACTED before it
   * reaches this). Omitted → nothing is logged at all.
   */
  log?: (line: string) => void
}

/** True iff `hermes version` actually runs (binary present + executable). */
async function probeHermesInstalled(deps: SetupRouteDeps): Promise<boolean> {
  try {
    const { stdout } = await runHermes(['version'], {
      hermesBin: deps.hermesBin,
      execFile: deps.execFile,
    })
    // A genuine version banner is non-empty; an empty stdout means it didn't run.
    return stdout.trim().length > 0
  } catch {
    // Spawn failure (ENOENT / not executable) → not installed.
    return false
  }
}

/** Fail-closed wrapper around the injected provider-connected probe. */
async function probeProvider(deps: SetupRouteDeps): Promise<boolean> {
  try {
    return await deps.probeProviderConnected()
  } catch {
    return false
  }
}

/**
 * Fastify plugin. Mount with no prefix (paths are absolute):
 *   await app.register(registerSetupRoutes, deps)
 */
export const registerSetupRoutes: FastifyPluginAsync<SetupRouteDeps> = async (
  app: FastifyInstance,
  deps: SetupRouteDeps,
) => {
  app.get('/api/agent-deck/setup-status', async (): Promise<SetupStatus> => {
    const [hermesInstalled, providerConnected] = await Promise.all([
      probeHermesInstalled(deps),
      probeProvider(deps),
    ])
    // The agent is "named/faced" once the default profile carries an identity.
    const agentNamed = readProfileAvatar(deps.hermesHome, 'default') !== null
    return SetupStatus.parse({ hermesInstalled, providerConnected, agentNamed })
  })

  app.post('/api/agent-deck/setup/provider-key', async (req, reply: FastifyReply) => {
    const parsed = AgentDeckProviderKeyRequest.safeParse(req.body)
    if (!parsed.success) {
      // 400 BEFORE any exec — never shell out with a missing provider/key.
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'provider and apiKey (non-empty) are required' })
    }
    const { provider, apiKey } = parsed.data

    try {
      const result = await runHermes(
        ['auth', 'add', provider, '--type', 'api-key', '--api-key', apiKey],
        {
          hermesBin: deps.hermesBin,
          execFile: deps.execFile,
          // The key is scrubbed from the (optional) audit line; the real argv still
          // carries it so the command works.
          secretArgs: [apiKey],
          log: deps.log,
        },
      )
      if (!result.ok) {
        // The add itself failed (bad key, network). Generic 502 — NEVER echo the
        // key or the raw stderr (which could contain the key).
        return reply
          .code(502)
          .send({ error: 'auth_add_failed', message: 'Hermes could not add the credential.' })
      }
    } catch {
      return reply
        .code(502)
        .send({ error: 'auth_add_failed', message: 'Hermes could not add the credential.' })
    }

    // Re-probe whether a usable model is now reported. The response carries ONLY
    // the provider + the connected verdict — never the key.
    const connected = await probeProvider(deps)
    return reply.send(AgentDeckProviderKeyResponse.parse({ provider, connected }))
  })
}

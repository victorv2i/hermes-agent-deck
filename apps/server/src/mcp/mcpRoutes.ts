/**
 * MCP SERVER MANAGER BFF — `/api/agent-deck/mcp` (agent-deck-OWN routes).
 *
 *   GET    /api/agent-deck/mcp              → McpState (configured servers + catalog)
 *   POST   /api/agent-deck/mcp              → guided ADD (writes the mcp_servers slice)
 *   PATCH  /api/agent-deck/mcp/:name        → toggle enabled (config write)
 *   DELETE /api/agent-deck/mcp/:name        → remove (config write)
 *   POST   /api/agent-deck/mcp/:name/test   → REAL non-interactive probe
 *
 * TOPOLOGY: these are NOT dashboard proxies — the configured-server list + the
 * add/toggle/remove writes touch `~/.hermes/config.yaml`'s `mcp_servers` slice
 * DIRECTLY (path-guarded fs, the Files/profiles pattern); the catalog is a
 * path-guarded read of the `optional-mcps` manifests; the `test` probe execs
 * `hermes mcp test <name>` (argv-only). The ONLY dashboard call is the masked
 * key store via stock `PUT /api/env` (already a pinned route) — so no new hermes
 * route is introduced.
 *
 * HONESTY (non-negotiable):
 *  - `enabled` is the config flag, NEVER a "connected" state. No fake green dot.
 *  - Toggle/remove/add only take effect on a NEW gateway session →
 *    `restartRequired: true`; the UI reuses the real gateway restart.
 *  - OAuth servers: a clean probe is NOT proof of auth → an `authCaveat`.
 *  - A masked key is stored SHAPE-ONLY via `/api/env`; its plaintext never lands
 *    in config.yaml and is never logged/returned (the server entry references the
 *    env var via a `${VAR}` header).
 *
 * Mount under no prefix (paths already include `/api/agent-deck`).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  McpState,
  AddMcpServerRequest,
  ToggleMcpServerRequest,
  McpMutationResult,
  McpTestResult,
  type McpConfiguredServer,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { runHermes, scrubSecrets, type ExecFileLike } from '../system/hermesCli'
import { readMcpServers, writeMcpServers } from './mcpConfig'
import { projectServers, readAuthKind, type RawMcpServerConfig } from './mcpService'
import { readCatalog } from './mcpCatalog'
import { parseProbeOutput } from './mcpProbe'

export interface McpRoutesOptions {
  /** Absolute path (or PATH name) of the `hermes` binary (for the `test` probe). */
  hermesBin: string
  /** The hermes home holding `config.yaml` (the mcp_servers slice lives here). */
  hermesHome: string
  /** The curated catalog root (`optional-mcps/`); a missing dir → empty catalog. */
  catalogDir: string
  /** Gated dashboard client — used ONLY for the masked key store (`PUT /api/env`). */
  dashboard: DashboardClient
  /** Injectable execFile (tests). Forwarded to {@link runHermes}. */
  execFile?: ExecFileLike
}

/** Server name guard — lowercase letters/digits/`-`/`_`, matching the CLI + DTO. */
const NAME_RE = /^[A-Za-z0-9_-]+$/

/** Env var names the MCP add route may store via `/api/env`. */
const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Runtime/config names a guided MCP key must not overwrite. */
const PROTECTED_ENV_VAR_NAMES = new Set([
  'API_SERVER_KEY',
  'HOME',
  'HERMES_HOME',
  'LOGNAME',
  'NODE_ENV',
  'NODE_OPTIONS',
  'OLDPWD',
  'PATH',
  'PWD',
  'SHELL',
  'TERM',
  'USER',
])

/**
 * Prefixes a guided MCP key must NOT be stored under. Two classes:
 *  - process/runtime mutators that could alter Hermes or Agentdeck — incl.
 *    `PYTHON*` (PYTHONSTARTUP/PYTHONPATH/… = code injection into the Python
 *    Hermes process on its next restart);
 *  - provider/cloud credential names, so a malicious MCP can't trick the user
 *    into storing (clobbering / harvesting) another provider's real key.
 */
const PROTECTED_ENV_VAR_PREFIXES = [
  'AGENT_DECK_',
  'ANTHROPIC_',
  'AWS_',
  'AZURE_',
  'DYLD_',
  'GEMINI_',
  'GITHUB_',
  'GOOGLE_',
  'HERMES_',
  'LD_',
  'NODE_',
  'OPENAI_',
  'PYTHON',
  'SLACK_',
  'STRIPE_',
  'TWILIO_',
]

function isSafeMcpEnvVarName(name: string): boolean {
  if (!ENV_VAR_RE.test(name)) return false
  const upper = name.toUpperCase()
  if (PROTECTED_ENV_VAR_NAMES.has(upper)) return false
  return !PROTECTED_ENV_VAR_PREFIXES.some((prefix) => upper.startsWith(prefix))
}

/** Compose the full {@link McpState}: configured servers + the curated catalog. */
async function readState(opts: McpRoutesOptions): Promise<McpState> {
  const block = await readMcpServers(opts.hermesHome)
  const servers = projectServers(block)
  const installed = new Set(servers.map((s) => s.name))
  const catalog = await readCatalog(opts.catalogDir, installed)
  return McpState.parse({ servers, catalog })
}

export const registerMcpRoutes: FastifyPluginAsync<McpRoutesOptions> = async (fastify, opts) => {
  fastify.get('/api/agent-deck/mcp', async (_req, reply): Promise<McpState> => {
    try {
      return await readState(opts)
    } catch {
      reply.code(502)
      return { error: 'Unable to read the MCP configuration.' } as unknown as McpState
    }
  })

  // Guided ADD: validate, build the entry, optionally store a masked key via
  // /api/env, then write the mcp_servers slice. The plaintext key never lands in
  // config.yaml (the entry references the env var) and is never logged/returned.
  fastify.post('/api/agent-deck/mcp', async (req, reply) => {
    const parsed = AddMcpServerRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid server definition.',
      })
    }
    const body = parsed.data
    if (body.apiKeyEnvVar && !isSafeMcpEnvVarName(body.apiKeyEnvVar)) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'apiKeyEnvVar must be a safe, non-protected environment variable name.',
      })
    }

    const existing = await readMcpServers(opts.hermesHome)
    if (Object.prototype.hasOwnProperty.call(existing, body.name)) {
      return reply
        .code(409)
        .send({ error: 'already_exists', message: `A server named "${body.name}" already exists.` })
    }

    // Build the entry from the validated shape (no client-supplied keys leak in).
    const entry: RawMcpServerConfig & Record<string, unknown> = { enabled: true }
    if (body.transport === 'http') {
      entry.url = body.url
    } else {
      entry.command = body.command
      if (body.args && body.args.length > 0) entry.args = body.args
    }

    try {
      // Store the masked key FIRST (so a config entry never references an env var
      // that failed to save). The plaintext flows once to stock PUT /api/env and
      // is dropped; the entry references it via a ${VAR} header (http only).
      if (body.apiKeyEnvVar && body.apiKeyValue) {
        await opts.dashboard.putJson<unknown>('/api/env', {
          key: body.apiKeyEnvVar,
          value: body.apiKeyValue,
        })
        if (body.transport === 'http') {
          entry.headers = { Authorization: `Bearer \${${body.apiKeyEnvVar}}` }
        }
      }

      const next = { ...existing, [body.name]: entry }
      await writeMcpServers(opts.hermesHome, next)
      const state = await readState(opts)
      return reply.send(McpMutationResult.parse({ state, restartRequired: true }))
    } catch {
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not add the MCP server.' })
    }
  })

  // Toggle the `enabled` config flag of an existing server.
  fastify.patch<{ Params: { name: string } }>('/api/agent-deck/mcp/:name', async (req, reply) => {
    const name = req.params.name
    if (!NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid server name.' })
    }
    const parsed = ToggleMcpServerRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'Expected { enabled: boolean }.' })
    }

    const existing = await readMcpServers(opts.hermesHome)
    const current = existing[name]
    if (!current || typeof current !== 'object') {
      return reply.code(404).send({ error: 'not_found', message: `No server named "${name}".` })
    }

    try {
      const next = {
        ...existing,
        [name]: { ...(current as Record<string, unknown>), enabled: parsed.data.enabled },
      }
      await writeMcpServers(opts.hermesHome, next)
      const state = await readState(opts)
      return reply.send(McpMutationResult.parse({ state, restartRequired: true }))
    } catch {
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not update the MCP server.' })
    }
  })

  // Remove a server (config write only — OAuth token cleanup stays a CLI concern).
  fastify.delete<{ Params: { name: string } }>('/api/agent-deck/mcp/:name', async (req, reply) => {
    const name = req.params.name
    if (!NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid server name.' })
    }
    const existing = await readMcpServers(opts.hermesHome)
    if (!Object.prototype.hasOwnProperty.call(existing, name)) {
      return reply.code(404).send({ error: 'not_found', message: `No server named "${name}".` })
    }
    try {
      const next = { ...existing }
      delete next[name]
      await writeMcpServers(opts.hermesHome, next)
      const state = await readState(opts)
      return reply.send(McpMutationResult.parse({ state, restartRequired: true }))
    } catch {
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not remove the MCP server.' })
    }
  })

  // REAL non-interactive probe: `hermes mcp test <name>`. The result is the
  // server's tools (a one-shot connect, NOT a persisted connection), with an
  // OAuth caveat when the server uses OAuth. Every line is secret-scrubbed.
  fastify.post<{ Params: { name: string } }>(
    '/api/agent-deck/mcp/:name/test',
    async (req, reply) => {
      const name = req.params.name
      if (!NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Invalid server name.' })
      }
      const existing = await readMcpServers(opts.hermesHome)
      const current = existing[name]
      if (!current || typeof current !== 'object') {
        return reply.code(404).send({ error: 'not_found', message: `No server named "${name}".` })
      }
      const authKind = readAuthKind(current as RawMcpServerConfig)

      try {
        const { stdout, stderr } = await runHermes(['mcp', 'test', name], {
          hermesBin: opts.hermesBin,
          execFile: opts.execFile,
          // The probe opens a network/stdio connection; give it headroom.
          timeoutMs: 60_000,
        })
        // Scrub the captured output line-by-line before parsing — the probe echoes
        // the transport (which may carry a ${VAR}-resolved key) and server errors.
        const safe = `${stdout}\n${stderr}`
          .split('\n')
          .map((l) => scrubSecrets(l))
          .join('\n')
        const result = parseProbeOutput(name, authKind, safe)
        return reply.send(McpTestResult.parse(result))
      } catch {
        // A true spawn failure (hermes missing) → an honest failed probe, not a 500.
        return reply.send(
          McpTestResult.parse({
            name,
            ok: false,
            tools: [],
            error: 'The probe could not run (is the hermes CLI installed?).',
            authCaveat:
              authKind === 'oauth' ? `Authenticate via \`hermes mcp login ${name}\`.` : null,
          }),
        )
      }
    },
  )
}

/** Re-export for the route test's convenience. */
export type { McpConfiguredServer }

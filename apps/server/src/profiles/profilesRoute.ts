import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AgentDeckAvatarWriteRequest,
  AgentDeckProfileCreateRequest,
  AgentDeckProfileRenameRequest,
  AgentDeckProfileSwitchRequest,
  isProfileId,
  SOUL_PRESETS,
} from '@agent-deck/protocol'
import {
  readProfiles,
  readSoul,
  readMemory,
  readUserMemory,
  writeSoul,
  writeMemory,
  writeUserMemory,
  writeAvatar,
  writeActiveProfile,
  profileExists,
  ProfileNotFoundError,
  type ProfilesResult,
} from './profilesReader'
import { PathGuardError } from '../files/pathGuard'
import { runHermes, type ExecFileLike } from '../system/hermesCli'

/**
 * BFF route plugin for the Profiles surface.
 *
 *   GET /api/agent-deck/profiles -> { active, profiles[] }
 *
 * Reads the HERMES_HOME directory on the filesystem and exposes Agent Deck's
 * path-safe profile facade. Stock Hermes does expose a minimal dashboard
 * `/api/profiles` route today, but that shape includes absolute `path` values
 * and lacks Agent Deck's active flags, MEMORY/USER files, avatar sidecar, and
 * active-profile switch route. The BFF therefore keeps the filesystem/CLI path
 * and returns only browser-safe fields.
 *
 * Mount as a Fastify plugin (no prefix — the full path is baked in):
 *   await app.register(profilesRoutes)
 *
 * `hermesHome` can be injected (tests / non-default installs); it otherwise
 * follows the same precedence the rest of the server uses: HERMES_HOME env, then
 * ~/.hermes.
 */

export interface ProfilesRouteOptions extends FastifyPluginOptions {
  /** Override the HERMES_HOME directory to read profiles from. */
  hermesHome?: string
  /**
   * Absolute path (or PATH name) of the `hermes` binary used by the guarded
   * `hermes profile create` exec. Defaults to `hermes` on PATH.
   */
  hermesBin?: string
  /** Injectable execFile (tests). Forwarded to {@link runHermes}. */
  execFile?: ExecFileLike
  /**
   * Resolve the ACTIVE profile's skill count from the dashboard `/api/skills`
   * set (the known, enabled skills the user sees + can toggle). When supplied and
   * it resolves to a number, the active profile's `skillCount` is OVERRIDDEN with
   * it so the Agents surface agrees with the Skills browser. The raw fs SKILL.md
   * walk ({@link readProfiles}) over-counts (disabled + duplicate skills: 203 vs
   * the dashboard's 141), so the dashboard count is the user-meaningful one. The
   * dashboard only knows the ACTIVE profile, so non-active profiles keep their fs
   * count. Returns `null` (or throws) → keep the fs count (graceful fallback).
   */
  skillCountForActive?: () => Promise<number | null>
}

function resolveHermesHome(opts: ProfilesRouteOptions): string {
  if (opts.hermesHome) return opts.hermesHome
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  return join(homedir(), '.hermes')
}

function canonicalizeProfileName(name: string): string {
  return name.trim().toLowerCase()
}

function withCanonicalProfileField(body: unknown, field: 'name' | 'newName'): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string') return body
  return { ...(body as Record<string, unknown>), [field]: canonicalizeProfileName(value) }
}

export async function profilesRoutes(
  app: FastifyInstance,
  opts: ProfilesRouteOptions,
): Promise<void> {
  const hermesHome = resolveHermesHome(opts)
  const hermesBin = opts.hermesBin ?? 'hermes'

  app.get('/api/agent-deck/profiles', async (): Promise<ProfilesResult> => {
    const result = readProfiles(hermesHome)
    // Reconcile the ACTIVE profile's skillCount with the dashboard /api/skills
    // set so the Agents surface agrees with the Skills browser. Best-effort: a
    // null/thrown dashboard count leaves the fs walk in place.
    if (opts.skillCountForActive) {
      let dashboardCount: number | null
      try {
        dashboardCount = await opts.skillCountForActive()
      } catch {
        dashboardCount = null
      }
      if (typeof dashboardCount === 'number' && Number.isFinite(dashboardCount)) {
        for (const p of result.profiles) {
          if (p.isActive) p.skillCount = dashboardCount
        }
      }
    }
    return result
  })

  // ── SOUL / MEMORY / USER (agent-deck BFF — NOT a hermes contract route) ──
  // These read/write the profile dir directly because stock Hermes only exposes
  // SOUL over HTTP. MEMORY/USER and Agent Deck's avatar sidecar are BFF-owned.
  // The profile :name is path-guarded in profilesReader; a hostile name throws
  // a PathGuardError → 403 here.

  /** Map a thrown error to an HTTP reply (path-guard → 403, missing → 404). */
  function sendError(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof PathGuardError) {
      return reply.code(403).send({ error: 'forbidden', code: err.code, message: err.message })
    }
    if (err instanceof ProfileNotFoundError) {
      return reply.code(404).send({ error: 'not_found', message: err.message })
    }
    // HON-01: log the error type and message server-side so unexpected failures are
    // diagnosable without leaking internal detail to the browser response body.
    const errType = err instanceof Error ? err.constructor.name : typeof err
    const errMsg = err instanceof Error ? err.message : String(err)
    reply.log.error({ errType, errMsg }, 'profile request failed (unexpected error)')
    return reply.code(500).send({ error: 'internal_error', message: 'profile request failed' })
  }

  app.get<{ Params: { name: string } }>(
    '/api/agent-deck/profiles/:name/soul',
    async (req, reply) => {
      try {
        return await reply.send(readSoul(hermesHome, req.params.name))
      } catch (err) {
        return sendError(reply, err)
      }
    },
  )

  app.get<{ Params: { name: string } }>(
    '/api/agent-deck/profiles/:name/memory',
    async (req, reply) => {
      try {
        return await reply.send(readMemory(hermesHome, req.params.name))
      } catch (err) {
        return sendError(reply, err)
      }
    },
  )

  app.get<{ Params: { name: string } }>(
    '/api/agent-deck/profiles/:name/user',
    async (req, reply) => {
      try {
        return await reply.send(readUserMemory(hermesHome, req.params.name))
      } catch (err) {
        return sendError(reply, err)
      }
    },
  )

  /**
   * Shared PUT handler for an editable profile text file (SOUL / MEMORY / USER).
   * Validates a string body, then runs the supplied (already path-guarded) writer.
   * MEMORY.md + USER.md are editable SYMMETRIC to SOUL.md; the honest boundary
   * (editing MEMORY does not stop the runtime memory provider rewriting it) lives
   * in the UI copy, not here.
   */
  async function handleFileWrite(
    req: { params: { name: string }; body: { content?: unknown } | null | undefined },
    reply: FastifyReply,
    write: (home: string, name: string, content: string) => void,
  ): Promise<FastifyReply> {
    const content = req.body?.content
    if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'bad_request', message: 'content (string) is required' })
    }
    try {
      write(hermesHome, req.params.name, content)
      return await reply.send({ ok: true })
    } catch (err) {
      return sendError(reply, err)
    }
  }

  app.put<{ Params: { name: string }; Body: { content?: unknown } }>(
    '/api/agent-deck/profiles/:name/soul',
    (req, reply) => handleFileWrite(req, reply, writeSoul),
  )

  app.put<{ Params: { name: string }; Body: { content?: unknown } }>(
    '/api/agent-deck/profiles/:name/memory',
    (req, reply) => handleFileWrite(req, reply, writeMemory),
  )

  app.put<{ Params: { name: string }; Body: { content?: unknown } }>(
    '/api/agent-deck/profiles/:name/user',
    (req, reply) => handleFileWrite(req, reply, writeUserMemory),
  )

  // ── Avatar write (identity ceremony / picker) ──
  // PUT /api/agent-deck/profiles/:name/avatar  body { avatar } -> { ok }
  // Validates the avatar id against the governed enum, path-guards the name, and
  // atomically writes <profile_dir>/.agent-deck/identity.json (writeSoul discipline).
  app.put<{ Params: { name: string }; Body: unknown }>(
    '/api/agent-deck/profiles/:name/avatar',
    async (req, reply) => {
      const parsed = AgentDeckAvatarWriteRequest.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'avatar (a valid id) is required' })
      }
      try {
        writeAvatar(hermesHome, req.params.name, parsed.data.avatar, parsed.data.displayName)
        return await reply.send({ ok: true })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  )

  // ── Create (the birth ceremony) ──
  // POST /api/agent-deck/profiles  body { name, avatar? } -> 201 { name, avatar? }
  // Canonicalizes like Hermes (`normalize_profile_name`: trim + lowercase), then
  // re-validates the name server-side (PROFILE_ID_RE, via the schema) BEFORE any
  // exec. Runs guarded `hermes profile create <name>` (argv, NEVER a shell).
  // An optional avatar is written after a successful create.
  app.post<{ Body: unknown }>('/api/agent-deck/profiles', async (req, reply) => {
    const parsed = AgentDeckProfileCreateRequest.safeParse(
      withCanonicalProfileField(req.body, 'name'),
    )
    if (!parsed.success) {
      // 400 BEFORE exec — a name failing PROFILE_ID_RE never reaches the CLI.
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'name must be a valid profile id' })
    }
    const { name, avatar, soulPreset } = parsed.data
    if (name === 'default') {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'default is the built-in agent' })
    }

    try {
      const result = await runHermes(['profile', 'create', name], {
        hermesBin,
        execFile: opts.execFile,
      })
      if (!result.ok) {
        // Create failed (name taken, etc.) — honest 502 with a generic message
        // (never echo raw stderr, which may carry a path).
        return reply
          .code(502)
          .send({ error: 'create_failed', message: 'Hermes could not create the profile.' })
      }
    } catch {
      return reply
        .code(502)
        .send({ error: 'create_failed', message: 'Hermes could not create the profile.' })
    }

    // Born with a soul: write the chosen SOUL preset to the new profile's
    // SOUL.md. `default` is skipped — stock `hermes profile create` already
    // seeds Hermes' own default soul (seededByHermes), so overwriting it would
    // only risk drift. The dir now exists, so a path-guard refusal is surfaced.
    if (soulPreset && !SOUL_PRESETS[soulPreset].seededByHermes) {
      try {
        writeSoul(hermesHome, name, SOUL_PRESETS[soulPreset].soul)
      } catch (err) {
        return sendError(reply, err)
      }
    }

    // Born with a face: best-effort avatar write (a create that succeeded should
    // not 500 if the optional avatar write hiccups — but the dir now exists, so a
    // path-guard error is still surfaced).
    if (avatar) {
      try {
        writeAvatar(hermesHome, name, avatar)
      } catch (err) {
        return sendError(reply, err)
      }
    }
    return reply.code(201).send(avatar ? { name, avatar } : { name })
  })

  // ── Rename (guarded `hermes profile rename <old> <new>`) ──
  // POST /api/agent-deck/profiles/:name/rename  body { newName } -> { name }
  // BOTH names are canonicalized and PROFILE_ID_RE-validated BEFORE any exec:
  // the URL :name here (a hostile source can never reach the CLI), the body
  // newName via the schema.
  // The exec is argv (NEVER a shell). The BFF rejects `default` rename cases
  // before exec so non-technical users see a clear 400 instead of a generic CLI
  // failure. Other CLI failures still surface as generic 502s (we never echo raw
  // stderr, which may carry a path).
  app.post<{ Params: { name: string }; Body: unknown }>(
    '/api/agent-deck/profiles/:name/rename',
    async (req, reply) => {
      const oldName = req.params.name
      // Source name guard FIRST — a hostile :name never reaches the CLI.
      const oldCanonical = canonicalizeProfileName(oldName)
      if (!isProfileId(oldCanonical)) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'source name must be a valid profile id' })
      }
      if (oldCanonical === 'default') {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'the default agent cannot be renamed' })
      }
      const parsed = AgentDeckProfileRenameRequest.safeParse(
        withCanonicalProfileField(req.body, 'newName'),
      )
      if (!parsed.success) {
        // 400 BEFORE exec — a newName failing PROFILE_ID_RE never reaches the CLI.
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'newName must be a valid profile id' })
      }
      const { newName } = parsed.data
      if (newName === 'default') {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'default is the built-in agent' })
      }

      try {
        const result = await runHermes(['profile', 'rename', oldCanonical, newName], {
          hermesBin,
          execFile: opts.execFile,
        })
        if (!result.ok) {
          // Rename failed (source missing, target exists, default reserved, …) —
          // honest 502 with a generic message (never echo raw stderr).
          return reply
            .code(502)
            .send({ error: 'rename_failed', message: 'Hermes could not rename the profile.' })
        }
      } catch {
        return reply
          .code(502)
          .send({ error: 'rename_failed', message: 'Hermes could not rename the profile.' })
      }
      return reply.send({ name: newName })
    },
  )

  // ── Switch (atomic active_profile flip — NEVER touches the gateway) ──
  // POST /api/agent-deck/profiles/switch  body { name } -> { active }
  app.post<{ Body: unknown }>('/api/agent-deck/profiles/switch', async (req, reply) => {
    const parsed = AgentDeckProfileSwitchRequest.safeParse(
      withCanonicalProfileField(req.body, 'name'),
    )
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'name must be a valid profile id' })
    }
    try {
      if (!profileExists(hermesHome, parsed.data.name)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: `Profile "${parsed.data.name}" not found` })
      }
      writeActiveProfile(hermesHome, parsed.data.name)
      return await reply.send({ active: parsed.data.name })
    } catch (err) {
      return sendError(reply, err)
    }
  })
}

import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { isProfileId } from '@agent-deck/protocol'
import { runHermes, type ExecFileLike, type HermesResult } from '../system/hermesCli'

/**
 * PROFILE TRANSFER BFF - guarded export / import for one agent (a hermes profile).
 *
 *   GET  /api/agent-deck/profiles/:name/export -> streams <name>.tar.gz
 *   POST /api/agent-deck/profiles/import        body { name, archive(base64) } -> 201 { name }
 *
 * Both shell out to the SAME guarded `hermes` CLI the create/rename/delete routes
 * use (see profilesRoute.ts): argv via {@link runHermes}, NEVER a shell, with the
 * target name canonicalized (trim + lowercase, like hermes' normalize_profile_name)
 * and PROFILE_ID_RE-validated BEFORE any exec, so a hostile name (`../evil`) can
 * never reach the CLI. hermes owns the real archive build/extract (and its own
 * tar path-traversal guard); this BFF only stages the bytes through a temp file.
 *
 * HONESTY: hermes' `export_profile` deliberately EXCLUDES credentials (`.env`,
 * `auth.json`) from the archive for BOTH named and default profiles, so the
 * download is a credential-free portable snapshot - the web copy says exactly
 * that, and the import flow tells the user to re-add provider keys after.
 *
 * Failures surface as a generic 502; raw stderr (which may carry a path) is never
 * echoed to the browser. Mount with no prefix (full paths baked in):
 *   await app.register(profileTransferRoutes, { hermesHome })
 */

export interface ProfileTransferRouteOptions extends FastifyPluginOptions {
  /** Override the HERMES_HOME directory (tests / non-default installs). */
  hermesHome?: string
  /** Absolute path (or PATH name) of the `hermes` binary. Defaults to `hermes`. */
  hermesBin?: string
  /** Injectable execFile (tests). Forwarded to {@link runHermes}. */
  execFile?: ExecFileLike
}

/** A base64 import body exceeds the 1 MiB global bodyLimit; a profile archive can be larger. */
const IMPORT_BODY_LIMIT = 64 * 1024 * 1024

function resolveHermesHome(opts: ProfileTransferRouteOptions): string {
  if (opts.hermesHome) return opts.hermesHome
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  return join(homedir(), '.hermes')
}

function canonicalizeProfileName(name: string): string {
  return name.trim().toLowerCase()
}

/** Validate (and roundtrip-safe base64-decode) the uploaded archive, or null if bad. */
function decodeArchive(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  // Reject anything that isn't strictly base64 so we never stage garbage to disk.
  // A valid base64 string roundtrips byte-for-byte through decode→encode.
  const compact = raw.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  const buf = Buffer.from(compact, 'base64')
  if (buf.length === 0) return null
  if (buf.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null
  return buf
}

export async function profileTransferRoutes(
  app: FastifyInstance,
  opts: ProfileTransferRouteOptions,
): Promise<void> {
  // `hermesHome` is resolved for parity with the rest of the profile routes
  // (and is the home the injected CLI / ambient `HERMES_HOME` targets), but the
  // guarded CLI itself reads the ambient `HERMES_HOME` the same way the
  // create/rename/delete routes rely on - we never re-derive a home for it.
  void resolveHermesHome(opts)
  const hermesBin = opts.hermesBin ?? 'hermes'

  /** Run the guarded hermes CLI (argv-only, no shell), same discipline as profilesRoute. */
  function runProfileCli(args: string[]): Promise<HermesResult> {
    return runHermes(args, { hermesBin, execFile: opts.execFile })
  }

  // ── EXPORT (guarded `hermes profile export <name> -o <tmp>`) ──
  // Streams <name>.tar.gz for download. The name is canonicalized +
  // PROFILE_ID_RE-validated BEFORE any exec. `default` is allowed (hermes can
  // export the built-in agent). The archive is built into a temp dir, streamed,
  // then removed.
  app.get<{ Params: { name: string } }>(
    '/api/agent-deck/profiles/:name/export',
    async (req, reply) => {
      const canonical = canonicalizeProfileName(req.params.name)
      if (!isProfileId(canonical)) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'name must be a valid agent name' })
      }
      const stageDir = mkdtempSync(join(tmpdir(), 'agent-deck-export-'))
      const outPath = join(stageDir, `${canonical}.tar.gz`)
      try {
        let result: HermesResult
        try {
          result = await runProfileCli(['profile', 'export', canonical, '-o', outPath])
        } catch {
          return reply
            .code(502)
            .send({ error: 'export_failed', message: 'Hermes could not export the agent.' })
        }
        // honest capture: a non-zero exit OR a "success" that wrote no archive both
        // mean we have nothing trustworthy to stream → generic 502 (never raw stderr).
        if (!result.ok || !existsSync(outPath) || statSync(outPath).size === 0) {
          return reply
            .code(502)
            .send({ error: 'export_failed', message: 'Hermes could not export the agent.' })
        }
        const bytes = readFileSync(outPath)
        return reply
          .header('Content-Type', 'application/gzip')
          .header('Content-Disposition', `attachment; filename="${canonical}.tar.gz"`)
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'no-store')
          .send(bytes)
      } finally {
        rmSync(stageDir, { recursive: true, force: true })
      }
    },
  )

  // ── IMPORT (guarded `hermes profile import <tmp> --name <name>`) ──
  // Accepts the archive as base64 in the JSON body (mirrors the voice route's
  // base64 upload, with a raised bodyLimit). The target name is canonicalized +
  // PROFILE_ID_RE-validated BEFORE any exec; `default` is refused (the built-in
  // agent). The bytes are staged to a temp file, imported, then removed.
  app.post<{ Body: unknown }>(
    '/api/agent-deck/profiles/import',
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (req, reply) => {
      const body = (req.body ?? {}) as { name?: unknown; archive?: unknown }
      const rawName = typeof body.name === 'string' ? canonicalizeProfileName(body.name) : ''
      if (!isProfileId(rawName)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'name must be a valid agent name' })
      }
      if (rawName === 'default') {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'default is the built-in agent' })
      }
      const archive = decodeArchive(body.archive)
      if (!archive) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'archive must be a base64-encoded .tar.gz' })
      }

      const stageDir = mkdtempSync(join(tmpdir(), 'agent-deck-import-'))
      const archivePath = join(stageDir, `${rawName}.tar.gz`)
      try {
        writeFileSync(archivePath, archive)
        let result: HermesResult
        try {
          result = await runProfileCli(['profile', 'import', archivePath, '--name', rawName])
        } catch {
          return reply
            .code(502)
            .send({ error: 'import_failed', message: 'Hermes could not import the agent.' })
        }
        if (!result.ok) {
          // Import failed (name taken, malformed archive, …) - honest 502 with a
          // generic message (never echo raw stderr, which may carry a path).
          return reply
            .code(502)
            .send({ error: 'import_failed', message: 'Hermes could not import the agent.' })
        }
        return reply.code(201).send({ name: rawName })
      } finally {
        rmSync(stageDir, { recursive: true, force: true })
      }
    },
  )
}

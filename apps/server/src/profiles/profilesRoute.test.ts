import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profilesRoutes } from './profilesRoute'
import type { ExecFileLike } from '../system/hermesCli'

/**
 * The BFF route GET /api/agent-deck/profiles returns the active profile name
 * plus the full profile list, read from HERMES_HOME on the filesystem.
 */

let home: string
let app: FastifyInstance

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'hermes-profiles-route-'))
  app = Fastify({ logger: false })
  await app.register(profilesRoutes, { hermesHome: home })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  rmSync(home, { recursive: true, force: true })
})

describe('GET /api/agent-deck/profiles', () => {
  it('returns the default profile and active="default" for a bare home', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.active).toBe('default')
    expect(body.profiles).toHaveLength(1)
    expect(body.profiles[0]).toMatchObject({ name: 'default', isDefault: true, isActive: true })
  })

  it('lists named profiles with metadata and marks the active one', async () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'coder', 'config.yaml'), 'model:\n  default: sonnet\n')
    writeFileSync(join(home, 'active_profile'), 'coder\n')

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.active).toBe('coder')
    const coder = body.profiles.find((p: { name: string }) => p.name === 'coder')
    expect(coder).toMatchObject({
      name: 'coder',
      isDefault: false,
      isActive: true,
      model: 'sonnet',
    })
  })

  it('never leaks secrets from .env / config.yaml in the response', async () => {
    writeFileSync(join(home, '.env'), 'API_SERVER_KEY=top-secret-route')
    writeFileSync(
      join(home, 'config.yaml'),
      'model:\n  default: gpt-5.5\nAPI_SERVER_KEY: cfg-secret\n',
    )
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(res.payload).not.toContain('top-secret-route')
    expect(res.payload).not.toContain('cfg-secret')
    expect(res.payload).not.toContain('API_SERVER_KEY')
  })

  it('never leaks absolute profile paths in the response', async () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(res.statusCode).toBe(200)
    expect(res.payload).not.toContain(home)
    expect(res.json().profiles.find((p: { name: string }) => p.name === 'coder')).toMatchObject({
      displayPath: 'profiles/coder',
    })
  })

  it('defaults hermesHome to ~/.hermes when no option is given (does not throw)', async () => {
    const bare = Fastify({ logger: false })
    await bare.register(profilesRoutes)
    await bare.ready()
    const res = await bare.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.profiles)).toBe(true)
    // The default profile is always present regardless of the host's ~/.hermes.
    expect(body.profiles.some((p: { name: string }) => p.name === 'default')).toBe(true)
    await bare.close()
  })

  describe('skillCount reconciliation with the dashboard /api/skills set', () => {
    /**
     * The raw SKILL.md fs-walk over-counts (disabled + duplicate skills): stock
     * reports 203 there but the dashboard /api/skills set (the known, enabled
     * skills the user actually sees + can toggle) is 141. The Agents surface must
     * AGREE with the Skills browser, so the ACTIVE profile's skillCount is
     * overridden with the dashboard count.
     */
    async function buildWith(
      skillCountForActive: () => Promise<number | null>,
    ): Promise<FastifyInstance> {
      const a = Fastify({ logger: false })
      await a.register(profilesRoutes, { hermesHome: home, skillCountForActive })
      await a.ready()
      return a
    }

    it('overrides the ACTIVE profile skillCount with the dashboard count', async () => {
      // Seed 3 SKILL.md files on disk (the fs walk would report 3) but the
      // dashboard's known set is 2 → the active profile must report 2.
      for (const n of ['a', 'b', 'c']) {
        mkdirSync(join(home, 'skills', n), { recursive: true })
        writeFileSync(join(home, 'skills', n, 'SKILL.md'), '# skill')
      }
      const a = await buildWith(async () => 2)
      const body = (await a.inject({ method: 'GET', url: '/api/agent-deck/profiles' })).json()
      const def = body.profiles.find((p: { name: string }) => p.name === 'default')
      expect(def.isActive).toBe(true)
      expect(def.skillCount).toBe(2)
      await a.close()
    })

    it('only overrides the ACTIVE profile (named profiles keep their fs count)', async () => {
      // active = coder; default has 2 SKILL.md on disk, coder has 1.
      mkdirSync(join(home, 'skills', 'x'), { recursive: true })
      writeFileSync(join(home, 'skills', 'x', 'SKILL.md'), '# s')
      mkdirSync(join(home, 'skills', 'y'), { recursive: true })
      writeFileSync(join(home, 'skills', 'y', 'SKILL.md'), '# s')
      mkdirSync(join(home, 'profiles', 'coder', 'skills', 'z'), { recursive: true })
      writeFileSync(join(home, 'profiles', 'coder', 'skills', 'z', 'SKILL.md'), '# s')
      writeFileSync(join(home, 'active_profile'), 'coder\n')

      const a = await buildWith(async () => 99)
      const body = (await a.inject({ method: 'GET', url: '/api/agent-deck/profiles' })).json()
      const coder = body.profiles.find((p: { name: string }) => p.name === 'coder')
      const def = body.profiles.find((p: { name: string }) => p.name === 'default')
      // coder is active → overridden to the dashboard count.
      expect(coder.isActive).toBe(true)
      expect(coder.skillCount).toBe(99)
      // default is NOT active → keeps its fs-walked count (2).
      expect(def.skillCount).toBe(2)
      await a.close()
    })

    it('falls back to the fs count when the dashboard count is unavailable (null)', async () => {
      mkdirSync(join(home, 'skills', 'a'), { recursive: true })
      writeFileSync(join(home, 'skills', 'a', 'SKILL.md'), '# s')
      const a = await buildWith(async () => null)
      const body = (await a.inject({ method: 'GET', url: '/api/agent-deck/profiles' })).json()
      const def = body.profiles.find((p: { name: string }) => p.name === 'default')
      expect(def.skillCount).toBe(1)
      await a.close()
    })

    it('falls back to the fs count when the dashboard resolver throws', async () => {
      mkdirSync(join(home, 'skills', 'a'), { recursive: true })
      writeFileSync(join(home, 'skills', 'a', 'SKILL.md'), '# s')
      const a = await buildWith(async () => {
        throw new Error('dashboard down')
      })
      const body = (await a.inject({ method: 'GET', url: '/api/agent-deck/profiles' })).json()
      const def = body.profiles.find((p: { name: string }) => p.name === 'default')
      expect(def.skillCount).toBe(1)
      await a.close()
    })
  })
})

/**
 * SOUL BFF routes. These read/write the profile dir on the filesystem directly
 * (SOUL.md is a real per-profile file). The Studio READS + EDITS soul through
 * hermes's own API (the Studio route, covered by studioRoute.test.ts); this
 * on-disk pair is the ceremony path (onboarding seeds the default agent's soul
 * here, create seeds a new agent's preset). The former MEMORY.md / USER.md
 * flat-file editors were RETIRED — installed hermes has no such files (see the
 * dedicated "retired" describe block below).
 *   GET /api/agent-deck/profiles/:name/soul   -> { content, exists }
 *   PUT /api/agent-deck/profiles/:name/soul   body { content } -> { ok }
 */
describe('SOUL routes', () => {
  it('GET soul returns { content, exists } for the default profile', async () => {
    writeFileSync(join(home, 'SOUL.md'), 'soul body')
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/default/soul' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ content: 'soul body', exists: true })
  })

  it('GET soul returns exists:false for a missing file (never throws)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/default/soul' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ content: '', exists: false })
  })

  it('PUT soul writes the file and round-trips through GET', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/soul',
      payload: { content: '# Written soul\n' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ ok: true })
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe('# Written soul\n')

    const get = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/default/soul' })
    expect(get.json()).toMatchObject({ content: '# Written soul\n', exists: true })
  })

  it('PUT soul writes to a named profile dir', async () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/coder/soul',
      payload: { content: 'coder soul' },
    })
    expect(put.statusCode).toBe(200)
    expect(readFileSync(join(home, 'profiles', 'coder', 'SOUL.md'), 'utf8')).toBe('coder soul')
  })

  it('PUT soul for a missing profile returns 404', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/ghost/soul',
      payload: { content: 'x' },
    })
    expect(put.statusCode).toBe(404)
  })

  it('PUT soul with a non-string body returns 400', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/soul',
      payload: { content: 123 },
    })
    expect(put.statusCode).toBe(400)
  })

  // HON-01: unexpected errors on the 500 branch must be logged server-side
  // (type + message) and must NOT expose raw details in the browser response.
  describe('HON-01: 500 branch logs error type/message and keeps body generic', () => {
    it('logs errType+errMsg server-side and returns the generic 500 body on an unexpected write error', async () => {
      const loggedErrors: Array<Record<string, unknown>> = []
      // Create an app instance with a logger sink that captures error-level records.
      const logApp = Fastify({
        logger: {
          level: 'error',
          transport: undefined,
          stream: {
            write(msg: string) {
              try {
                const parsed = JSON.parse(msg) as Record<string, unknown>
                // pino records use numeric level: 50 = error
                if (parsed['level'] === 50) loggedErrors.push(parsed)
              } catch {
                // ignore non-JSON lines
              }
            },
          } as NodeJS.WritableStream,
        },
      })

      // We need writeSoul's atomicWrite to throw an unexpected fs error. We do that
      // by making the profile dir exist (so ProfileNotFoundError is not thrown) but
      // then chmod-ing it to 000 so the temp-file write throws EACCES.
      const badHome = mkdtempSync(join(tmpdir(), 'hon01-'))
      const { chmodSync } = await import('node:fs')
      mkdirSync(join(badHome, 'profiles', 'coder'), { recursive: true })
      // Make the profile dir unwritable so atomicWrite throws EACCES.
      chmodSync(join(badHome, 'profiles', 'coder'), 0o444)

      try {
        await logApp.register(profilesRoutes, { hermesHome: badHome })
        await logApp.ready()

        const res = await logApp.inject({
          method: 'PUT',
          url: '/api/agent-deck/profiles/coder/soul',
          payload: { content: 'x' },
        })

        // The HTTP response is a clean 500 with the generic message — no raw error leaked.
        expect(res.statusCode).toBe(500)
        const body = res.json() as Record<string, unknown>
        expect(body['error']).toBe('internal_error')
        expect(body['message']).toBe('profile request failed')
        // The raw node error must NOT appear in the response body.
        expect(res.payload).not.toContain('EACCES')

        // The server-side log must have captured errType + errMsg (diagnosable).
        expect(loggedErrors.length).toBeGreaterThan(0)
        const record = loggedErrors[0]!
        expect(typeof record['errType']).toBe('string')
        expect(typeof record['errMsg']).toBe('string')
        expect((record['errMsg'] as string).length).toBeGreaterThan(0)
      } finally {
        // Restore permissions before cleanup.
        try {
          chmodSync(join(badHome, 'profiles', 'coder'), 0o755)
        } catch {
          // best-effort
        }
        await logApp.close()
        rmSync(badHome, { recursive: true, force: true })
      }
    })
  })
})

/**
 * RETIRED flat-file memory/user editors. Installed hermes (config schema v29)
 * has NO flat MEMORY.md / USER.md files in a profile: memory is store-backed
 * plus an external memory provider. The BFF's former GET/PUT /profiles/:name/
 * memory and /user routes were removed; memory is now authored through the
 * Studio (provider + memory.* config). These tests pin that the dead routes are
 * GONE (404), so the flat-file write path cannot resurface.
 */
describe('retired flat-file memory/user routes', () => {
  it.each([
    ['GET', '/api/agent-deck/profiles/default/memory'],
    ['GET', '/api/agent-deck/profiles/default/user'],
    ['PUT', '/api/agent-deck/profiles/default/memory'],
    ['PUT', '/api/agent-deck/profiles/default/user'],
  ] as const)('%s %s is no longer served (404)', async (method, url) => {
    const res = await app.inject({
      method,
      url,
      ...(method === 'PUT' ? { payload: { content: 'x' } } : {}),
    })
    expect(res.statusCode).toBe(404)
  })

  it('does NOT write a MEMORY.md to disk on a PUT to the retired route', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/memory',
      payload: { content: '# should not be written\n' },
    })
    // The route is gone, so no flat-file write happened.
    expect(existsSync(join(home, 'memories', 'MEMORY.md'))).toBe(false)
  })
})

/**
 * Rename — POST /api/agent-deck/profiles/:name/rename. BOTH names are
 * canonicalized like Hermes and PROFILE_ID_RE-validated (the URL :name in the
 * path guard, the body newName in the schema) BEFORE any exec; the guarded
 * `hermes profile rename <old> <new>` runs as argv (never a shell). An honest
 * CLI failure → 502 with a generic message.
 */
describe('POST /api/agent-deck/profiles/:name/rename', () => {
  async function mountWithExec(exec: ExecFileLike): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    await a.register(profilesRoutes, { hermesHome: home, hermesBin: 'hermes', execFile: exec })
    await a.ready()
    return a
  }

  it('execs `hermes profile rename <old> <new>` with argv (no shell) and returns the new name', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      mkdirSync(join(home, 'profiles', args[3]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/atlas/rename',
      payload: { newName: 'mercury' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'mercury' })
    expect(calls[0]!.args).toEqual(['profile', 'rename', 'atlas', 'mercury'])
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
    await a.close()
  })

  it('rejects an invalid TARGET name with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    for (const newName of ['Bad Name', '../evil', '']) {
      const res = await a.inject({
        method: 'POST',
        url: '/api/agent-deck/profiles/atlas/rename',
        payload: { newName },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('canonicalizes mixed-case names before exec', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      mkdirSync(join(home, 'profiles', args[3]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/Atlas/rename',
      payload: { newName: 'Mercury' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'mercury' })
    expect(calls[0]).toEqual(['profile', 'rename', 'atlas', 'mercury'])
    await a.close()
  })

  it('rejects renaming to default with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/atlas/rename',
      payload: { newName: 'Default' },
    })
    expect(res.statusCode).toBe(400)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('rejects an invalid SOURCE name with 403/404 BEFORE any exec (path guard)', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/..%2f..%2fetc/rename',
      payload: { newName: 'mercury' },
    })
    expect([403, 404]).toContain(res.statusCode)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('returns 502 (honest capture, no crash) when the CLI rename fails', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('exists'), { code: 1 }), '', 'profile already exists')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/atlas/rename',
      payload: { newName: 'mercury' },
    })
    expect(res.statusCode).toBe(502)
    await a.close()
  })

  it('does not leak raw stderr (which may carry a path) on failure', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('boom'), { code: 1 }), '', '/home/secret/path leaked')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/atlas/rename',
      payload: { newName: 'mercury' },
    })
    expect(res.payload).not.toContain('/home/secret/path')
    await a.close()
  })
})

/**
 * Delete — DELETE /api/agent-deck/profiles/:name. The :name is canonicalized +
 * PROFILE_ID_RE-validated BEFORE any exec; `default` and the ACTIVE agent are
 * refused before exec; the guarded `hermes profile delete <name> --yes` runs as
 * argv (never a shell). An honest CLI failure → 502 with a generic message.
 */
describe('DELETE /api/agent-deck/profiles/:name', () => {
  async function mountWithExec(exec: ExecFileLike): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    await a.register(profilesRoutes, { hermesHome: home, hermesBin: 'hermes', execFile: exec })
    await a.ready()
    return a
  }

  it('execs `hermes profile delete <name> --yes` with argv (no shell) and returns ok', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      rmSync(join(home, 'profiles', args[2]!), { recursive: true, force: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/atlas' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
    expect(calls[0]!.args).toEqual(['profile', 'delete', 'atlas', '--yes'])
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
    await a.close()
  })

  it('canonicalizes a mixed-case name before exec', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/Atlas' })
    expect(res.statusCode).toBe(200)
    expect(calls[0]).toEqual(['profile', 'delete', 'atlas', '--yes'])
    await a.close()
  })

  it('rejects deleting default with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/default' })
    expect(res.statusCode).toBe(400)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('refuses to delete the ACTIVE agent with 409 BEFORE any exec', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    writeFileSync(join(home, 'active_profile'), 'atlas\n')
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/atlas' })
    expect(res.statusCode).toBe(409)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('rejects an invalid name with 403 BEFORE any exec (path guard)', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/..%2f..%2fetc' })
    expect([403, 404]).toContain(res.statusCode)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('returns 502 and does not leak raw stderr when the CLI delete fails', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('nope'), { code: 1 }), '', '/home/secret/path leaked')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({ method: 'DELETE', url: '/api/agent-deck/profiles/atlas' })
    expect(res.statusCode).toBe(502)
    expect(res.payload).not.toContain('/home/secret/path')
    await a.close()
  })
})

/**
 * Avatar write — PUT /api/agent-deck/profiles/:name/avatar. Validates the avatar
 * id, path-guards the name, atomically writes .agent-deck/identity.json.
 */
describe('PUT /api/agent-deck/profiles/:name/avatar', () => {
  it('writes the avatar and round-trips into the profile list', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/avatar',
      payload: { avatar: 'v3' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ ok: true })
    expect(JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))).toEqual({
      avatar: 'v3',
    })

    const list = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    const def = list.json().profiles.find((p: { name: string }) => p.name === 'default')
    expect(def.avatar).toBe('v3')
  })

  it('writes to a named profile dir', async () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/coder/avatar',
      payload: { avatar: 'v2' },
    })
    expect(put.statusCode).toBe(200)
    expect(existsSync(join(home, 'profiles', 'coder', '.agent-deck', 'identity.json'))).toBe(true)
  })

  it('rejects an invalid avatar id with 400 (no write)', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/avatar',
      payload: { avatar: 'v99' },
    })
    expect(put.statusCode).toBe(400)
    expect(existsSync(join(home, '.agent-deck', 'identity.json'))).toBe(false)
  })

  it('returns 404 for a missing profile', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/ghost/avatar',
      payload: { avatar: 'v1' },
    })
    expect(put.statusCode).toBe(404)
  })

  it('rejects a traversal profile name with 403 (path guard)', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/..%2f..%2fetc/avatar',
      payload: { avatar: 'v1' },
    })
    expect([403, 404]).toContain(put.statusCode)
    // Whatever the status, no identity.json escaped the home dir.
    expect(existsSync(join(home, '.agent-deck', 'identity.json'))).toBe(false)
  })

  it('persists displayName alongside the avatar when provided', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/avatar',
      payload: { avatar: 'v2', displayName: 'Mercury' },
    })
    expect(put.statusCode).toBe(200)
    const stored = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(stored).toEqual({ avatar: 'v2', displayName: 'Mercury' })

    // The profile list reflects the displayName.
    const list = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    const def = list.json().profiles.find((p: { name: string }) => p.name === 'default')
    expect(def.displayName).toBe('Mercury')
  })

  it('omits displayName from identity.json when not provided', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/default/avatar',
      payload: { avatar: 'v2' },
    })
    const stored = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(stored).toEqual({ avatar: 'v2' })
  })
})

/**
 * Profile create — POST /api/agent-deck/profiles. Re-validates the name
 * server-side after Hermes-style canonicalization, execs guarded
 * `hermes profile create <name>` (argv, no shell), and optionally writes the
 * avatar after.
 */
describe('POST /api/agent-deck/profiles (create)', () => {
  /** An exec that simulates `hermes profile create` by making the dir + echoing. */
  function createExec(): ExecFileLike {
    return (_file, args, _opts, cb) => {
      // args = ['profile', 'create', '<name>']
      const name = args[2]
      if (name) mkdirSync(join(home, 'profiles', name), { recursive: true })
      cb(null, `Created profile ${name}`, '')
      return undefined as never
    }
  }

  async function mountWithExec(exec: ExecFileLike): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    await a.register(profilesRoutes, { hermesHome: home, hermesBin: 'hermes', execFile: exec })
    await a.ready()
    return a
  }

  it('execs `hermes profile create <name>` with argv (no shell) and returns the profile', async () => {
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'researcher' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'researcher' })
    expect(calls[0]!.args).toEqual(['profile', 'create', 'researcher'])
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
    await a.close()
  })

  it('writes the optional avatar after a successful create', async () => {
    const a = await mountWithExec(createExec())
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'painter', avatar: 'v3' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'painter', avatar: 'v3' })
    expect(
      JSON.parse(
        readFileSync(join(home, 'profiles', 'painter', '.agent-deck', 'identity.json'), 'utf8'),
      ),
    ).toEqual({ avatar: 'v3' })
    await a.close()
  })

  it('writes the chosen SOUL preset to SOUL.md after a successful create', async () => {
    const a = await mountWithExec(createExec())
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'devbot', soulPreset: 'coder' },
    })
    expect(res.statusCode).toBe(201)
    const soul = readFileSync(join(home, 'profiles', 'devbot', 'SOUL.md'), 'utf8')
    expect(soul).toContain('software engineering partner')
    await a.close()
  })

  it('does NOT overwrite SOUL.md for the default preset (Hermes already seeded it)', async () => {
    // Simulate the stock seed: `hermes profile create` writes a SOUL.md the BFF
    // must leave untouched when the user keeps the Hermes default.
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      const dir = join(home, 'profiles', args[2]!)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SOUL.md'), 'STOCK SEED', 'utf8')
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'plainbot', soulPreset: 'default' },
    })
    expect(res.statusCode).toBe(201)
    expect(readFileSync(join(home, 'profiles', 'plainbot', 'SOUL.md'), 'utf8')).toBe('STOCK SEED')
    await a.close()
  })

  it('rejects an invalid name with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    for (const name of ['Bad Name', '../evil', '']) {
      const res = await a.inject({
        method: 'POST',
        url: '/api/agent-deck/profiles',
        payload: { name },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('canonicalizes a mixed-case name before exec and response', async () => {
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'Researcher' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'researcher' })
    expect(calls[0]).toEqual(['profile', 'create', 'researcher'])
    await a.close()
  })

  it('rejects creating the built-in default agent with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'Default' },
    })
    expect(res.statusCode).toBe(400)
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('returns 502 (honest stderr capture, no crash) when create fails', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('exists'), { code: 1 }), '', 'profile already exists')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'dupe' },
    })
    expect(res.statusCode).toBe(502)
    await a.close()
  })

  // ── Clone: create FROM a source profile (`hermes profile create <name>
  // --clone-from <source>`, which copies config.yaml/.env/SOUL.md/skills). The
  // source name is path-guard-validated server-side BEFORE any exec.
  it('passes --clone-from <source> when cloneFrom is provided (argv, no shell)', async () => {
    mkdirSync(join(home, 'profiles', 'mentor'), { recursive: true })
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      // args = ['profile', 'create', '<name>', '--clone-from', '<source>']
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'apprentice', cloneFrom: 'mentor' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'apprentice' })
    expect(calls[0]!.args).toEqual(['profile', 'create', 'apprentice', '--clone-from', 'mentor'])
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
    await a.close()
  })

  it('canonicalizes the clone SOURCE name like hermes (trim + lowercase) before exec', async () => {
    mkdirSync(join(home, 'profiles', 'mentor'), { recursive: true })
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'apprentice', cloneFrom: 'Mentor' },
    })
    expect(res.statusCode).toBe(201)
    expect(calls[0]).toEqual(['profile', 'create', 'apprentice', '--clone-from', 'mentor'])
    await a.close()
  })

  it('does NOT seed a SOUL preset when cloning (the clone already carries the source soul)', async () => {
    mkdirSync(join(home, 'profiles', 'mentor'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'mentor', 'SOUL.md'), 'MENTOR SOUL', 'utf8')
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      const dir = join(home, 'profiles', args[2]!)
      mkdirSync(dir, { recursive: true })
      // Simulate --clone-from copying the source soul into the new profile.
      writeFileSync(join(dir, 'SOUL.md'), 'MENTOR SOUL', 'utf8')
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      // A soulPreset is IGNORED on a clone: the cloned soul wins (no overwrite).
      payload: { name: 'apprentice', cloneFrom: 'mentor', soulPreset: 'coder' },
    })
    expect(res.statusCode).toBe(201)
    expect(readFileSync(join(home, 'profiles', 'apprentice', 'SOUL.md'), 'utf8')).toBe('MENTOR SOUL')
    await a.close()
  })

  it('rejects an invalid clone SOURCE name with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    // A traversal / illegal-character / spaced source is rejected before exec.
    for (const cloneFrom of ['Bad Name', '../evil', 'a/b']) {
      const res = await a.inject({
        method: 'POST',
        url: '/api/agent-deck/profiles',
        payload: { name: 'apprentice', cloneFrom },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
    await a.close()
  })

  it('treats an empty-string cloneFrom as "no clone" (plain create, 201)', async () => {
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'apprentice', cloneFrom: '' },
    })
    expect(res.statusCode).toBe(201)
    expect(calls[0]).toEqual(['profile', 'create', 'apprentice'])
    await a.close()
  })

  it('omits --clone-from entirely when cloneFrom is absent (plain create)', async () => {
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      mkdirSync(join(home, 'profiles', args[2]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    const a = await mountWithExec(exec)
    const res = await a.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles',
      payload: { name: 'solo' },
    })
    expect(res.statusCode).toBe(201)
    expect(calls[0]).toEqual(['profile', 'create', 'solo'])
    expect(calls[0]).not.toContain('--clone-from')
    await a.close()
  })
})

/**
 * Switch — POST /api/agent-deck/profiles/switch. Atomically writes/clears
 * active_profile; validates the name; NEVER touches the gateway.
 */
describe('POST /api/agent-deck/profiles/switch', () => {
  it('writes active_profile and the list reflects the new active', async () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/switch',
      payload: { name: 'coder' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ active: 'coder' })
    expect(readFileSync(join(home, 'active_profile'), 'utf8').trim()).toBe('coder')

    const list = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles' })
    expect(list.json().active).toBe('coder')
  })

  it('switches back to default', async () => {
    writeFileSync(join(home, 'active_profile'), 'coder\n')
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/switch',
      payload: { name: 'Default' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ active: 'default' })
    expect(existsSync(join(home, 'active_profile'))).toBe(false)
  })

  it('rejects an invalid name with 400 (no write)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/switch',
      payload: { name: 'Bad Name' },
    })
    expect(res.statusCode).toBe(400)
    expect(existsSync(join(home, 'active_profile'))).toBe(false)
  })

  it('404s a syntactically valid but nonexistent profile (no write)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/switch',
      payload: { name: 'ghost' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'not_found' })
    expect(existsSync(join(home, 'active_profile'))).toBe(false)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { profileTransferRoutes } from './profileTransferRoute'
import type { ExecFileLike } from '../system/hermesCli'

/**
 * Profile EXPORT / IMPORT BFF route tests.
 *
 * Both routes shell out to the SAME guarded `hermes` CLI the create/rename/delete
 * routes use (argv via runHermes, NEVER a shell), with the profile name
 * canonicalized + PROFILE_ID_RE-validated BEFORE any exec so a hostile name can
 * never reach the CLI. Export runs `hermes profile export <name> -o <tmp>` and
 * streams the resulting archive; import writes the uploaded archive to a temp
 * file and runs `hermes profile import <tmp> --name <name>`.
 *
 * These tests inject a mock execFile (the same pattern the existing
 * profilesRoute.test.ts uses) so no real CLI runs.
 */

let home: string
let app: FastifyInstance

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'hermes-transfer-route-'))
})
afterEach(async () => {
  if (app) await app.close()
  rmSync(home, { recursive: true, force: true })
})

async function mountWithExec(exec: ExecFileLike): Promise<FastifyInstance> {
  const a = Fastify({ logger: false })
  await a.register(profileTransferRoutes, { hermesHome: home, hermesBin: 'hermes', execFile: exec })
  await a.ready()
  return a
}

/** A `.tar.gz`-shaped buffer (a gzip member) so the bytes look like a real archive. */
function fakeArchiveBytes(): Buffer {
  return gzipSync(Buffer.from('fake profile archive contents'))
}

describe('GET /api/agent-deck/profiles/:name/export', () => {
  it('execs `hermes profile export <name> -o <tmp>` (argv, no shell) and streams the archive', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const archive = fakeArchiveBytes()
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      // args = ['profile', 'export', '<name>', '-o', '<tmpfile>'] — write the
      // archive to the requested output path so the route can stream it back.
      const outIdx = args.indexOf('-o')
      const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined
      if (outPath) writeFileSync(outPath, archive)
      cb(null, `Exported ${args[2]}`, '')
      return undefined as never
    }
    app = await mountWithExec(exec)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/atlas/export' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/gzip')
    expect(res.headers['content-disposition']).toContain('atlas.tar.gz')
    // The streamed bytes match the archive the CLI produced.
    expect(Buffer.from(res.rawPayload)).toEqual(archive)
    // argv shape + no shell.
    expect(calls[0]!.args.slice(0, 3)).toEqual(['profile', 'export', 'atlas'])
    expect(calls[0]!.args).toContain('-o')
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
  })

  it('canonicalizes a mixed-case name before exec and in the filename', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const archive = fakeArchiveBytes()
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      const outIdx = args.indexOf('-o')
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, archive)
      cb(null, 'ok', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/Atlas/export' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('atlas.tar.gz')
    expect(calls[0]!.slice(0, 3)).toEqual(['profile', 'export', 'atlas'])
  })

  it('exports the built-in default agent', async () => {
    const archive = fakeArchiveBytes()
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      const outIdx = args.indexOf('-o')
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, archive)
      cb(null, 'ok', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/default/export' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('default.tar.gz')
  })

  it('rejects an invalid name with 403 BEFORE any exec (path guard)', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/profiles/..%2f..%2fetc/export',
    })
    expect([403, 404]).toContain(res.statusCode)
    expect(execCalls).toBe(0)
  })

  it('returns 502 (no crash, no raw stderr leak) when the CLI export fails', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('boom'), { code: 1 }), '', '/home/secret/path leaked')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/atlas/export' })
    expect(res.statusCode).toBe(502)
    expect(res.payload).not.toContain('/home/secret/path')
  })

  it('returns 502 when the CLI reports success but writes no archive', async () => {
    mkdirSync(join(home, 'profiles', 'atlas'), { recursive: true })
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      // CLI claims ok but never wrote the file — the route must not stream garbage.
      cb(null, 'ok', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/profiles/atlas/export' })
    expect(res.statusCode).toBe(502)
  })
})

describe('POST /api/agent-deck/profiles/import', () => {
  /** A valid base64 import body for `name`. */
  function importBody(name: string): { name: string; archive: string } {
    return { name, archive: fakeArchiveBytes().toString('base64') }
  }

  it('writes the uploaded archive to a temp file and execs `hermes profile import <tmp> --name <name>`', async () => {
    const calls: Array<{ args: string[]; opts: Record<string, unknown> }> = []
    let importedArchive: Buffer | null = null
    const exec: ExecFileLike = (_file, args, opts, cb) => {
      calls.push({ args, opts: opts as Record<string, unknown> })
      // args = ['profile', 'import', '<tmpfile>', '--name', '<name>'] — read the
      // staged archive so we can assert the uploaded bytes reached the CLI.
      const archivePath = args[2]
      if (archivePath && existsSync(archivePath)) importedArchive = readFileSync(archivePath)
      // Simulate a successful import by creating the profile dir.
      const nameIdx = args.indexOf('--name')
      if (nameIdx >= 0) mkdirSync(join(home, 'profiles', args[nameIdx + 1]!), { recursive: true })
      cb(null, `Imported profile ${args[nameIdx + 1]}`, '')
      return undefined as never
    }
    app = await mountWithExec(exec)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: importBody('mercury'),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'mercury' })
    expect(calls[0]!.args.slice(0, 2)).toEqual(['profile', 'import'])
    expect(calls[0]!.args.slice(3)).toEqual(['--name', 'mercury'])
    expect(calls[0]!.opts.shell ?? false).toBeFalsy()
    // The exact uploaded bytes were staged for the CLI.
    expect(importedArchive).toEqual(fakeArchiveBytes())
  })

  it('cleans up the staged temp archive after the import', async () => {
    let stagedPath: string | undefined
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      stagedPath = args[2]
      const nameIdx = args.indexOf('--name')
      if (nameIdx >= 0) mkdirSync(join(home, 'profiles', args[nameIdx + 1]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: importBody('mercury'),
    })
    expect(stagedPath).toBeTruthy()
    // The temp archive must not linger on disk after the request.
    expect(existsSync(stagedPath!)).toBe(false)
  })

  it('canonicalizes a mixed-case target name before exec', async () => {
    const calls: string[][] = []
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      calls.push(args)
      const nameIdx = args.indexOf('--name')
      if (nameIdx >= 0) mkdirSync(join(home, 'profiles', args[nameIdx + 1]!), { recursive: true })
      cb(null, 'ok', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: importBody('Mercury'),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'mercury' })
    expect(calls[0]!.slice(3)).toEqual(['--name', 'mercury'])
  })

  it('rejects an invalid target name with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    for (const name of ['Bad Name', '../evil', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/profiles/import',
        payload: { name, archive: fakeArchiveBytes().toString('base64') },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
  })

  it('rejects importing OVER the built-in default agent with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: importBody('default'),
    })
    expect(res.statusCode).toBe(400)
    expect(execCalls).toBe(0)
  })

  it('rejects a missing/empty archive with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    for (const archive of ['', undefined, 123 as unknown as string]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/profiles/import',
        payload: { name: 'mercury', archive },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
  })

  it('rejects a non-base64 archive with 400 BEFORE any exec', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: { name: 'mercury', archive: 'not valid base64 @@@@ !!!!' },
    })
    expect(res.statusCode).toBe(400)
    expect(execCalls).toBe(0)
  })

  it('returns 502 (no crash, no raw stderr leak) when the CLI import fails', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('exists'), { code: 1 }), '', '/home/secret/path already exists')
      return undefined as never
    }
    app = await mountWithExec(exec)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/profiles/import',
      payload: importBody('mercury'),
    })
    expect(res.statusCode).toBe(502)
    expect(res.payload).not.toContain('/home/secret/path')
  })
})

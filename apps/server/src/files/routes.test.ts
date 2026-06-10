import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { FilesService } from './filesService'
import { filesRoutes } from './routes'

let app: FastifyInstance
let dashboard: MockDashboardHandle
let tmpRoot: string

async function buildAppWithFiles(): Promise<{ app: FastifyInstance; service: FilesService }> {
  const client = new DashboardClient({
    hermesDashboardUrl: dashboard.url,
    hermesDashboardHost: dashboard.host,
  })
  const service = new FilesService(client)
  service.setRootResolver(async (id) =>
    id === 'tmp'
      ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: false }
      : null,
  )
  const a = Fastify({ logger: false })
  await a.register(filesRoutes, { service })
  await a.ready()
  return { app: a, service }
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'ad-files-routes-'))
})

afterEach(async () => {
  await app?.close()
  await dashboard?.close()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('GET /files/roots', () => {
  it('returns the roots derived from /api/status hermes_home (home + workspace)', async () => {
    // hermes_home = tmpRoot with a default-profile workspace subdir present.
    await mkdir(join(tmpRoot, 'workspace'), { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/roots' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      roots: [
        // hermes_home is always first — the guaranteed root so Files is never blank.
        {
          id: 'home',
          label: 'Hermes home',
          description: 'hermes_home',
          path: tmpRoot,
          readOnly: true,
        },
        {
          id: 'default',
          label: 'Workspace',
          description: 'default',
          path: join(tmpRoot, 'workspace'),
          readOnly: false,
        },
      ],
    })
  })

  it('is NEVER blank on a stock layout (no ./workspace) — hermes_home alone', async () => {
    // Mirrors the verified stock reality: no ${hermes_home}/workspace at all.
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/roots' })
    expect(res.statusCode).toBe(200)
    const { roots } = res.json<{ roots: { id: string; path: string }[] }>()
    expect(roots.length).toBeGreaterThanOrEqual(1)
    expect(roots.some((r) => r.id === 'home' && r.path === tmpRoot)).toBe(true)
  })
})

describe('GET /files', () => {
  it('lists a directory (BFF-local fs read)', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'a.txt'), 'x')
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files?root=tmp&path=' })
    expect(res.statusCode).toBe(200)
    expect(res.json().entries[0].name).toBe('a.txt')
  })

  it('400s when root is missing', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files?path=' })
    expect(res.statusCode).toBe(400)
  })

  it('403s on a traversal path', async () => {
    dashboard = await startMockDashboard({ routes: { '/api/workspace/tree': { entries: [] } } })
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files?root=tmp&path=../escape' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /files/read', () => {
  it('returns file content (BFF-local fs read)', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'README.md'), '# Hi')
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/read?root=tmp&path=README.md' })
    expect(res.statusCode).toBe(200)
    expect(res.json().content).toBe('# Hi')
  })

  it('403s when reading a sensitive file', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, '.env'), 'SECRET=1')
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/read?root=tmp&path=.env' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /files/raw', () => {
  it('streams image bytes with a content-type', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'pixel.png'), png)
    const res = await app.inject({ method: 'GET', url: '/files/raw?root=tmp&path=pixel.png' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(Buffer.from(res.rawPayload).equals(png)).toBe(true)
  })

  it('403s a sensitive raw read', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/raw?root=tmp&path=.env' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /files/download', () => {
  it('streams a file as an attachment with a filename + octet-stream', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'report.csv'), 'a,b\n1,2\n')
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/download?root=tmp&path=report.csv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('filename="report.csv"')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.rawPayload.toString('utf8')).toBe('a,b\n1,2\n')
  })

  it('403s a sensitive download', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, '.env'), 'SECRET=1')
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/download?root=tmp&path=.env' })
    expect(res.statusCode).toBe(403)
  })

  it('400s when path is missing', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/download?root=tmp' })
    expect(res.statusCode).toBe(400)
  })

  it('404s a missing download target', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({ method: 'GET', url: '/files/download?root=tmp&path=nope.txt' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /files/write', () => {
  it('writes a file to disk', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({
      method: 'POST',
      url: '/files/write',
      payload: { root: 'tmp', path: 'out/note.txt', content: 'persisted' },
    })
    expect(res.statusCode).toBe(200)
    expect(await readFile(join(tmpRoot, 'out/note.txt'), 'utf8')).toBe('persisted')
    expect(res.json().size).toBe('persisted'.length)
  })

  it('403s on a sensitive write', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({
      method: 'POST',
      url: '/files/write',
      // auth.json is an unconditional credential file (config.yaml is now scoped
      // to the Hermes home, so it would be writable in this ordinary work root).
      payload: { root: 'tmp', path: 'auth.json', content: '{}' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('400s on a malformed body', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({
      method: 'POST',
      url: '/files/write',
      payload: { root: 'tmp' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /files/create, /files/rename, /files/delete', () => {
  it('creates a directory then a file', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    const dir = await app.inject({
      method: 'POST',
      url: '/files/create',
      payload: { root: 'tmp', path: 'd', kind: 'dir' },
    })
    expect(dir.statusCode).toBe(200)
    expect((await stat(join(tmpRoot, 'd'))).isDirectory()).toBe(true)

    const file = await app.inject({
      method: 'POST',
      url: '/files/create',
      payload: { root: 'tmp', path: 'd/f.txt', kind: 'file' },
    })
    expect(file.statusCode).toBe(200)
    expect(await readFile(join(tmpRoot, 'd/f.txt'), 'utf8')).toBe('')
  })

  it('409s when creating an existing entry', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    await writeFile(join(tmpRoot, 'dupe.txt'), 'x')
    const res = await app.inject({
      method: 'POST',
      url: '/files/create',
      payload: { root: 'tmp', path: 'dupe.txt', kind: 'file' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('renames a file', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    await writeFile(join(tmpRoot, 'from.txt'), 'data')
    const res = await app.inject({
      method: 'POST',
      url: '/files/rename',
      payload: { root: 'tmp', from: 'from.txt', to: 'to.txt' },
    })
    expect(res.statusCode).toBe(200)
    expect(await readFile(join(tmpRoot, 'to.txt'), 'utf8')).toBe('data')
  })

  it('deletes a file', async () => {
    dashboard = await startMockDashboard()
    ;({ app } = await buildAppWithFiles())
    await writeFile(join(tmpRoot, 'gone.txt'), 'x')
    const res = await app.inject({
      method: 'POST',
      url: '/files/delete',
      payload: { root: 'tmp', path: 'gone.txt' },
    })
    expect(res.statusCode).toBe(200)
    await expect(stat(join(tmpRoot, 'gone.txt'))).rejects.toThrow()
  })

  it('404s deleting an unknown root', async () => {
    dashboard = await startMockDashboard({ routes: { '/api/workspace/roots': { roots: [] } } })
    ;({ app } = await buildAppWithFiles())
    const res = await app.inject({
      method: 'POST',
      url: '/files/delete',
      payload: { root: 'nope', path: 'x.txt' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('read-only root enforcement (I1) → 403', () => {
  /** Build an app whose "ro" root reports read_only=true (the v1 default). */
  async function buildAppWithReadOnlyRoot(): Promise<FastifyInstance> {
    const client = new DashboardClient({
      hermesDashboardUrl: dashboard.url,
      hermesDashboardHost: dashboard.host,
    })
    const service = new FilesService(client)
    service.setRootResolver(async (id) =>
      id === 'ro'
        ? { id: 'ro', label: 'RO', description: '', path: tmpRoot, readOnly: true }
        : null,
    )
    const a = Fastify({ logger: false })
    await a.register(filesRoutes, { service })
    await a.ready()
    return a
  }

  it('403s a write to a read-only root and writes nothing', async () => {
    dashboard = await startMockDashboard()
    app = await buildAppWithReadOnlyRoot()
    const res = await app.inject({
      method: 'POST',
      url: '/files/write',
      payload: { root: 'ro', path: 'note.txt', content: 'x' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('read_only')
    await expect(stat(join(tmpRoot, 'note.txt'))).rejects.toThrow()
  })

  it('403s create on a read-only root', async () => {
    dashboard = await startMockDashboard()
    app = await buildAppWithReadOnlyRoot()
    const res = await app.inject({
      method: 'POST',
      url: '/files/create',
      payload: { root: 'ro', path: 'd', kind: 'dir' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403s rename on a read-only root', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'from.txt'), 'data')
    app = await buildAppWithReadOnlyRoot()
    const res = await app.inject({
      method: 'POST',
      url: '/files/rename',
      payload: { root: 'ro', from: 'from.txt', to: 'to.txt' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403s delete on a read-only root', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'keep.txt'), 'data')
    app = await buildAppWithReadOnlyRoot()
    const res = await app.inject({
      method: 'POST',
      url: '/files/delete',
      payload: { root: 'ro', path: 'keep.txt' },
    })
    expect(res.statusCode).toBe(403)
    expect(await readFile(join(tmpRoot, 'keep.txt'), 'utf8')).toBe('data')
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, rm, mkdir, symlink, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WorkspaceDefinitionSchema,
  ListWorkspacesResponseSchema,
  RootsResponseSchema,
  DirListResponseSchema,
  type WorkspaceRoot,
} from '@agent-deck/protocol'
import { workspaceRoutes } from './workspaceRoutes'
import { WorkspaceStore } from './workspaceStore'

const PREFIX = '/api/agent-deck/terminal'

let dir: string
let storePath: string
let app: FastifyInstance | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adk-ws-routes-'))
  storePath = join(dir, 'workspaces.json')
})
afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(dir, { recursive: true, force: true })
})

/** Build the plugin with an injected store + roots resolver (mirrors terminalRoutes.test). */
async function build(
  opts: {
    roots?: () => Promise<WorkspaceRoot[]>
    allowHome?: boolean
    home?: string
  } = {},
): Promise<FastifyInstance> {
  app = Fastify({ logger: false })
  await app.register(workspaceRoutes, {
    prefix: PREFIX,
    store: new WorkspaceStore(storePath),
    roots: opts.roots ?? (async () => []),
    allowHome: opts.allowHome ?? false,
    home: opts.home,
  })
  await app.ready()
  return app
}

describe('workspaceRoutes CRUD', () => {
  it('POST /workspaces creates a workspace with a generated id + timestamps', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'p1', label: 'one', cli: 'shell' }] },
    })
    expect(res.statusCode).toBe(200)
    const def = WorkspaceDefinitionSchema.parse(res.json())
    expect(def.name).toBe('Alpha')
    expect(def.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(def.panes).toEqual([{ id: 'p1', label: 'one', cli: 'shell' }])
    expect(def.createdAt).toBe(def.lastModifiedAt)
    expect(() => new Date(def.createdAt).toISOString()).not.toThrow()
  })

  it('POST /workspaces accepts a missing panes list (empty workspace)', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Empty' },
    })
    expect(res.statusCode).toBe(200)
    expect(WorkspaceDefinitionSchema.parse(res.json()).panes).toEqual([])
  })

  it('GET /workspaces lists slim summaries', async () => {
    const a = await build()
    await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'p1', label: 'one', cli: 'shell' }] },
    })
    const res = await a.inject({ method: 'GET', url: `${PREFIX}/workspaces` })
    expect(res.statusCode).toBe(200)
    const body = ListWorkspacesResponseSchema.parse(res.json())
    expect(body.workspaces.length).toBe(1)
    expect(body.workspaces[0]).toMatchObject({ name: 'Alpha', paneCount: 1 })
  })

  it('GET /workspaces/:id returns the full definition, 404 when missing', async () => {
    const a = await build()
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: `${PREFIX}/workspaces`,
          payload: { name: 'Alpha' },
        })
      ).json(),
    )
    const ok = await a.inject({ method: 'GET', url: `${PREFIX}/workspaces/${created.id}` })
    expect(ok.statusCode).toBe(200)
    expect(WorkspaceDefinitionSchema.parse(ok.json()).id).toBe(created.id)

    const miss = await a.inject({ method: 'GET', url: `${PREFIX}/workspaces/does-not-exist` })
    expect(miss.statusCode).toBe(404)
  })

  it('PATCH /workspaces/:id updates fields + bumps lastModifiedAt, 404 when missing', async () => {
    const a = await build()
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: `${PREFIX}/workspaces`,
          payload: { name: 'Alpha', description: 'first' },
        })
      ).json(),
    )
    const res = await a.inject({
      method: 'PATCH',
      url: `${PREFIX}/workspaces/${created.id}`,
      payload: { name: 'Renamed', panes: [{ id: 'p9', label: 'nine', cli: 'hermes' }] },
    })
    expect(res.statusCode).toBe(200)
    const updated = WorkspaceDefinitionSchema.parse(res.json())
    expect(updated.name).toBe('Renamed')
    expect(updated.panes).toEqual([{ id: 'p9', label: 'nine', cli: 'hermes' }])
    expect(updated.description).toBe('first') // untouched field preserved
    expect(updated.createdAt).toBe(created.createdAt) // createdAt is stable

    const miss = await a.inject({
      method: 'PATCH',
      url: `${PREFIX}/workspaces/nope`,
      payload: { name: 'x' },
    })
    expect(miss.statusCode).toBe(404)
  })

  it('DELETE /workspaces/:id removes the workspace', async () => {
    const a = await build()
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({ method: 'POST', url: `${PREFIX}/workspaces`, payload: { name: 'Alpha' } })
      ).json(),
    )
    const res = await a.inject({ method: 'DELETE', url: `${PREFIX}/workspaces/${created.id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    const gone = await a.inject({ method: 'GET', url: `${PREFIX}/workspaces/${created.id}` })
    expect(gone.statusCode).toBe(404)
  })
})

describe('workspaceRoutes validation', () => {
  it('rejects an empty name (400)', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an over-long name (>80 chars) (400)', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'x'.repeat(81) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a pane id outside the safe charset (400)', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'bad id!', label: 'x', cli: 'shell' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown CLI (400)', async () => {
    const a = await build()
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'p1', label: 'x', cli: 'rm-rf' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a PATCH body with an invalid pane id (400)', async () => {
    const a = await build()
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({ method: 'POST', url: `${PREFIX}/workspaces`, payload: { name: 'Alpha' } })
      ).json(),
    )
    const res = await a.inject({
      method: 'PATCH',
      url: `${PREFIX}/workspaces/${created.id}`,
      payload: { panes: [{ id: '../escape', label: 'x', cli: 'shell' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a cwd outside the allowlisted roots on create (400)', async () => {
    const root = join(dir, 'Projects')
    await mkdir(root, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'p1', label: 'x', cli: 'shell', cwd: '/etc' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a cwd that is inside an allowlisted root on create', async () => {
    const root = join(dir, 'Projects')
    const sub = join(root, 'repo')
    await mkdir(sub, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    const res = await a.inject({
      method: 'POST',
      url: `${PREFIX}/workspaces`,
      payload: { name: 'Alpha', panes: [{ id: 'p1', label: 'x', cli: 'shell', cwd: sub }] },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a cwd outside the allowlisted roots on PATCH (400)', async () => {
    const root = join(dir, 'Projects')
    await mkdir(root, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({ method: 'POST', url: `${PREFIX}/workspaces`, payload: { name: 'Alpha' } })
      ).json(),
    )
    const res = await a.inject({
      method: 'PATCH',
      url: `${PREFIX}/workspaces/${created.id}`,
      payload: { panes: [{ id: 'p1', label: 'x', cli: 'shell', cwd: '/etc' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a cwd that is inside an allowlisted root on PATCH (200)', async () => {
    const root = join(dir, 'Projects')
    const sub = join(root, 'repo')
    await mkdir(sub, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    const created = WorkspaceDefinitionSchema.parse(
      (
        await a.inject({ method: 'POST', url: `${PREFIX}/workspaces`, payload: { name: 'Alpha' } })
      ).json(),
    )
    const res = await a.inject({
      method: 'PATCH',
      url: `${PREFIX}/workspaces/${created.id}`,
      payload: { panes: [{ id: 'p1', label: 'x', cli: 'shell', cwd: sub }] },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('workspaceRoutes GET /roots', () => {
  it('returns the allowlisted roots from the injected resolver', async () => {
    const root = join(dir, 'Projects')
    await mkdir(root, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    const res = await a.inject({ method: 'GET', url: `${PREFIX}/roots` })
    expect(res.statusCode).toBe(200)
    const body = RootsResponseSchema.parse(res.json())
    expect(body.roots).toEqual([{ name: 'Projects', path: root }])
  })

  it('includes $HOME as a root only when allowHome is set', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adk-ws-home-'))
    try {
      const off = await build({ roots: async () => [], allowHome: false, home })
      expect(
        RootsResponseSchema.parse(
          (await off.inject({ method: 'GET', url: `${PREFIX}/roots` })).json(),
        ).roots,
      ).toEqual([])
      await off.close()

      const on = await build({ roots: async () => [], allowHome: true, home })
      const realHome = await realpath(home)
      const roots = RootsResponseSchema.parse(
        (await on.inject({ method: 'GET', url: `${PREFIX}/roots` })).json(),
      ).roots
      expect(roots.some((r) => r.path === realHome || r.path === home)).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('workspaceRoutes GET /dirs (security-hardened cwd picker)', () => {
  async function buildWithProjects(): Promise<{ a: FastifyInstance; root: string }> {
    const root = join(dir, 'Projects')
    await mkdir(join(root, 'repo-a'), { recursive: true })
    await mkdir(join(root, 'repo-b'), { recursive: true })
    await writeFile(join(root, 'README.md'), 'x', 'utf8') // a file, must NOT be listed
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    return { a, root }
  }

  it('lists immediate SUBDIRECTORIES of an allowlisted dir (files excluded)', async () => {
    const { a, root } = await buildWithProjects()
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent(root)}`,
    })
    expect(res.statusCode).toBe(200)
    const body = DirListResponseSchema.parse(res.json())
    expect(body.entries.map((e) => e.name).sort()).toEqual(['repo-a', 'repo-b'])
    expect(body.entries.every((e) => e.path.startsWith(root))).toBe(true)
  })

  it('omits parent when listing a root, includes it when listing a subdir', async () => {
    const { a, root } = await buildWithProjects()
    const atRoot = DirListResponseSchema.parse(
      (
        await a.inject({ method: 'GET', url: `${PREFIX}/dirs?path=${encodeURIComponent(root)}` })
      ).json(),
    )
    expect(atRoot.parent).toBeUndefined()

    const sub = join(root, 'repo-a')
    const atSub = DirListResponseSchema.parse(
      (
        await a.inject({ method: 'GET', url: `${PREFIX}/dirs?path=${encodeURIComponent(sub)}` })
      ).json(),
    )
    expect(atSub.parent).toBe(root)
  })

  it('defaults to the first root when no path is given', async () => {
    const { a, root } = await buildWithProjects()
    const res = await a.inject({ method: 'GET', url: `${PREFIX}/dirs` })
    expect(res.statusCode).toBe(200)
    expect(DirListResponseSchema.parse(res.json()).path).toBe(root)
  })

  // ---- SECURITY ----

  it('rejects ../ path traversal (400, never clamps)', async () => {
    const { a, root } = await buildWithProjects()
    const escape = join(root, '..', '..', 'etc')
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent(escape)}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a symlink that escapes the allowlisted root (400)', async () => {
    const { a, root } = await buildWithProjects()
    // A secret dir OUTSIDE the allowlist, and a symlink to it placed INSIDE.
    const secret = join(dir, 'secret-outside')
    await mkdir(secret, { recursive: true })
    const link = join(root, 'escape-link')
    await symlink(secret, link, 'dir')
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent(link)}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects the /Projects vs /Projects-evil sibling-prefix escape (400)', async () => {
    const root = join(dir, 'Projects')
    const evil = join(dir, 'Projects-evil')
    await mkdir(root, { recursive: true })
    await mkdir(evil, { recursive: true })
    const a = await build({ roots: async () => [{ name: 'Projects', path: root }] })
    // `Projects-evil` shares a textual prefix with `Projects` but is NOT inside it.
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent(evil)}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an absolute path fully outside any allowlisted root (400)', async () => {
    const { a } = await buildWithProjects()
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent('/etc')}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-existent path under a root (400, not a 500)', async () => {
    const { a, root } = await buildWithProjects()
    const ghost = join(root, 'does-not-exist')
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent(ghost)}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 (not 500) when there are no roots at all', async () => {
    const a = await build({ roots: async () => [] })
    const res = await a.inject({
      method: 'GET',
      url: `${PREFIX}/dirs?path=${encodeURIComponent('/tmp')}`,
    })
    expect(res.statusCode).toBe(400)
  })
})

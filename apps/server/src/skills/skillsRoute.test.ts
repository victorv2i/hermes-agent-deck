import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerSkillsRoutes } from './skillsRoute'

/**
 * Local mock of the gated dashboard skills endpoints. The shared
 * mockDashboard.test-support only canned GET routes; the toggle is a PUT with a
 * body, so this test owns a tiny loopback server that reproduces the same STOCK
 * auth recipe (trusted host + same-host Origin → token injected into the SPA
 * root's HTML, read via GET / → bearer) AND a real mutable disabled-set so the
 * toggle round-trips. Kept hermetic: binds 127.0.0.1:0.
 */
interface MockSkillsHandle {
  url: string
  host: string
  /** Current enabled state by skill name (reflects toggles). */
  enabled: Map<string, boolean>
  lastToggleBody: { name: string; enabled: boolean } | undefined
  lastIssuedToken: string | undefined
  close(): Promise<void>
}

async function startMock(
  initial: { name: string; description: string; category: string | null; enabled: boolean }[],
  opts: { failToggle?: boolean } = {},
): Promise<MockSkillsHandle> {
  const enabled = new Map(initial.map((s) => [s.name, s.enabled]))
  const meta = new Map(initial.map((s) => [s.name, s]))
  let activeToken: string | undefined
  let lastToggleBody: { name: string; enabled: boolean } | undefined

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const host = req.headers['host']
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined
    const auth =
      typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    const hostname = (host ?? '').split(':')[0]
    const sessionOk =
      hostname === '127.0.0.1' &&
      origin !== undefined &&
      (() => {
        try {
          return new URL(origin).host.toLowerCase() === (host ?? '').toLowerCase()
        } catch {
          return false
        }
      })()

    // Stock serves the session token inside the SPA root's index.html as
    // window.__HERMES_SESSION_TOKEN__ (read via GET /), not a JSON endpoint.
    if (req.method === 'GET' && path === '/') {
      if (!sessionOk) return json(403, { error: 'forbidden' })
      activeToken = `tok_${randomUUID()}`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<html><head><script>window.__HERMES_SESSION_TOKEN__="${activeToken}";</script></head></html>`,
      )
      return
    }

    if (auth !== `Bearer ${activeToken}` || activeToken === undefined) {
      return json(401, { error: 'unauthorized' })
    }

    if (req.method === 'GET' && path === '/api/skills') {
      const skills = [...meta.values()].map((s) => ({ ...s, enabled: enabled.get(s.name)! }))
      return json(200, skills)
    }

    if (req.method === 'PUT' && path === '/api/skills/toggle') {
      if (opts.failToggle) return json(500, { error: 'boom' })
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw) as { name: string; enabled: boolean }
        lastToggleBody = body
        enabled.set(body.name, body.enabled)
        json(200, { ok: true, name: body.name, enabled: body.enabled })
      })
      return
    }

    json(404, { error: 'not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const host = `127.0.0.1:${port}`
  return {
    url: `http://${host}`,
    host,
    enabled,
    get lastToggleBody() {
      return lastToggleBody
    },
    get lastIssuedToken() {
      return activeToken
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections?.()
      }),
  }
}

const SKILLS = [
  { name: 'axolotl', description: 'Fine-tune models.', category: 'mlops', enabled: true },
  {
    name: 'init',
    description: 'Initialize a starter project file.',
    category: null,
    enabled: true,
  },
  { name: 'verify', description: 'Verify a change.', category: 'qa', enabled: false },
]

let mock: MockSkillsHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await mock?.close()
  app = undefined
  mock = undefined
  while (emptyHomes.length) rmSync(emptyHomes.pop()!, { recursive: true, force: true })
})

async function buildAppFor(m: MockSkillsHandle): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const client = new DashboardClient({ hermesDashboardUrl: m.url, hermesDashboardHost: m.host })
  // Point at an EMPTY temp HERMES_HOME so the list's on-disk `path` enrichment is
  // deterministic (null) and these dashboard-only tests stay hermetic — never
  // dependent on the developer's real ~/.hermes skills tree.
  const emptyHome = mkdtempSync(join(tmpdir(), 'ad-skills-empty-'))
  emptyHomes.push(emptyHome)
  await fastify.register(registerSkillsRoutes, { dashboard: client, hermesHome: emptyHome })
  await fastify.ready()
  return fastify
}

const emptyHomes: string[] = []

describe('GET /api/agent-deck/skills', () => {
  it('maps the dashboard skills into the slim list shape', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/skills' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ skills: typeof SKILLS }>()
    expect(body.skills).toHaveLength(3)
    expect(body.skills[0]).toEqual({
      name: 'axolotl',
      description: 'Fine-tune models.',
      category: 'mlops',
      enabled: true,
      // Enriched with the on-disk path; null here (empty test HERMES_HOME).
      path: null,
    })
    // null category preserved; disabled flag preserved.
    expect(body.skills[1]!.category).toBeNull()
    expect(body.skills.find((s) => s.name === 'verify')!.enabled).toBe(false)
  })

  it('returns 502 when the dashboard is unreachable', async () => {
    const fastify = Fastify({ logger: false })
    const client = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerSkillsRoutes, { dashboard: client })
    await fastify.ready()
    app = fastify

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/skills' })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })

  it('never leaks the dashboard session token', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/skills' })
    expect(res.body).not.toMatch(/tok_/)
    expect(res.body).not.toContain(mock.lastIssuedToken ?? '__none__')
  })
})

describe('PUT /api/agent-deck/skills/toggle', () => {
  it('disables a skill and echoes the resolved state', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/toggle',
      payload: { name: 'axolotl', enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ name: 'axolotl', enabled: false })
    // The mutation reached the dashboard.
    expect(mock.lastToggleBody).toEqual({ name: 'axolotl', enabled: false })
    expect(mock.enabled.get('axolotl')).toBe(false)
  })

  it('re-enables a previously disabled skill', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/toggle',
      payload: { name: 'verify', enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ name: 'verify', enabled: true })
    expect(mock.enabled.get('verify')).toBe(true)
  })

  it('rejects a malformed body with 400 (no dashboard call)', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/toggle',
      payload: { name: '', enabled: true },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.lastToggleBody).toBeUndefined()
  })

  it('rejects a non-boolean enabled with 400', async () => {
    mock = await startMock(SKILLS)
    app = await buildAppFor(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/toggle',
      payload: { name: 'axolotl', enabled: 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 502 when the dashboard rejects the toggle', async () => {
    mock = await startMock(SKILLS, { failToggle: true })
    app = await buildAppFor(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/toggle',
      payload: { name: 'axolotl', enabled: false },
    })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })
})

/* ─────────────────────── Skills CRUD (fs-backed BFF) ───────────────────────
 * The create/edit/delete + body-read routes act on the on-disk skills tree
 * (NOT a dashboard proxy — stock hermes has no such routes), path-guarded. These
 * use a real temp HERMES_HOME and a dashboard pointed at a dead port (the fs
 * routes never call it). */
let home: string
let fsApp: FastifyInstance | undefined

function writeSkill(rel: string, body: string): void {
  const dir = join(home, 'skills', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8')
}

async function buildFsApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const client = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:1',
    hermesDashboardHost: '127.0.0.1:1',
    requestTimeoutMs: 200,
  })
  await fastify.register(registerSkillsRoutes, { dashboard: client, hermesHome: home })
  await fastify.ready()
  return fastify
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ad-skills-route-'))
  mkdirSync(join(home, 'skills'), { recursive: true })
})
afterEach(async () => {
  await fsApp?.close()
  fsApp = undefined
  if (home) rmSync(home, { recursive: true, force: true })
})

describe('GET /api/agent-deck/skills/body', () => {
  it('reads a skill SKILL.md by relative path', async () => {
    writeSkill('creative/ascii-art', '# ASCII\nbody')
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'GET',
      url: '/api/agent-deck/skills/body?path=creative/ascii-art',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ content: string; exists: boolean; hasExtraFiles: boolean }>()
    expect(body.exists).toBe(true)
    expect(body.content).toContain('# ASCII')
    expect(body.hasExtraFiles).toBe(false)
  })

  it('400s when path is missing', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({ method: 'GET', url: '/api/agent-deck/skills/body' })
    expect(res.statusCode).toBe(400)
  })

  it('403s on a traversal path (fail-closed)', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'GET',
      url: `/api/agent-deck/skills/body?path=${encodeURIComponent('../../etc/passwd')}`,
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /api/agent-deck/skills/body', () => {
  it('writes the SKILL.md body of an existing skill', async () => {
    writeSkill('mlops/axolotl', '# old')
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/body',
      payload: { path: 'mlops/axolotl', content: '# new body' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(readFileSync(join(home, 'skills', 'mlops/axolotl', 'SKILL.md'), 'utf8')).toBe(
      '# new body',
    )
  })

  it('404s when the skill does not exist (never conjures one)', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/body',
      payload: { path: 'ghost/skill', content: '# x' },
    })
    expect(res.statusCode).toBe(404)
    expect(existsSync(join(home, 'skills', 'ghost'))).toBe(false)
  })

  it('400s when content is not a string', async () => {
    writeSkill('a', '# a')
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/body',
      payload: { path: 'a', content: 123 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('403s on a traversal path before any write', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'PUT',
      url: '/api/agent-deck/skills/body',
      payload: { path: '../../evil', content: '# x' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/agent-deck/skills (create)', () => {
  it('creates a new skill from the minimal template', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'POST',
      url: '/api/agent-deck/skills',
      payload: { name: 'my-skill' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ path: 'my-skill' })
    const md = readFileSync(join(home, 'skills', 'my-skill', 'SKILL.md'), 'utf8')
    expect(md).toContain('name: my-skill')
  })

  it('creates a categorized skill', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'POST',
      url: '/api/agent-deck/skills',
      payload: { name: 'tagger', category: 'productivity' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ path: 'productivity/tagger' })
  })

  it('409s when the skill already exists', async () => {
    writeSkill('dup', '# already')
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'POST',
      url: '/api/agent-deck/skills',
      payload: { name: 'dup' },
    })
    expect(res.statusCode).toBe(409)
    expect(readFileSync(join(home, 'skills', 'dup', 'SKILL.md'), 'utf8')).toBe('# already')
  })

  it('400s an invalid skill name (no dir created)', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'POST',
      url: '/api/agent-deck/skills',
      payload: { name: 'Bad Name!' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400s a traversal name', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'POST',
      url: '/api/agent-deck/skills',
      payload: { name: '../escape' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/agent-deck/skills', () => {
  it('deletes a skill directory', async () => {
    writeSkill('throwaway/temp', '# temp')
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'DELETE',
      url: '/api/agent-deck/skills',
      payload: { path: 'throwaway/temp' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(existsSync(join(home, 'skills', 'throwaway/temp'))).toBe(false)
  })

  it('404s when the dir is not a skill (refuses to nuke a category dir)', async () => {
    mkdirSync(join(home, 'skills', 'creative'), { recursive: true })
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'DELETE',
      url: '/api/agent-deck/skills',
      payload: { path: 'creative' },
    })
    expect(res.statusCode).toBe(404)
    expect(existsSync(join(home, 'skills', 'creative'))).toBe(true)
  })

  it('400s a missing path', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({ method: 'DELETE', url: '/api/agent-deck/skills', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('403s a traversal path before any delete', async () => {
    fsApp = await buildFsApp()
    const res = await fsApp.inject({
      method: 'DELETE',
      url: '/api/agent-deck/skills',
      payload: { path: '../../home' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('skill list path enrichment', () => {
  it('GET /api/agent-deck/skills enriches each skill with its on-disk path', async () => {
    // A mock dashboard that lists one skill; the fs app resolves its path.
    writeSkill('creative/ascii-art', '---\nname: ascii-art\n---\n# A')
    const listMock = await startMock([
      { name: 'ascii-art', description: 'art', category: 'creative', enabled: true },
    ])
    const fastify = Fastify({ logger: false })
    const client = new DashboardClient({
      hermesDashboardUrl: listMock.url,
      hermesDashboardHost: listMock.host,
    })
    await fastify.register(registerSkillsRoutes, { dashboard: client, hermesHome: home })
    await fastify.ready()
    fsApp = fastify
    const res = await fsApp.inject({ method: 'GET', url: '/api/agent-deck/skills' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ skills: { name: string; path: string | null }[] }>()
    expect(body.skills[0]!.path).toBe('creative/ascii-art')
    await listMock.close()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { Organization, Project } from '@agent-deck/protocol'
import { OrganizationStore } from './organizationStore'
import { registerOrganizationRoutes, normalizeTags } from './organizationRoutes'

let dir: string
let store: OrganizationStore
let app: FastifyInstance

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-deck-org-routes-'))
  store = new OrganizationStore(join(dir, 'agent-deck', 'organization.json'))
  app = Fastify({ logger: false })
  await app.register(registerOrganizationRoutes, { store })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

async function createProject(name: string, color: string): Promise<Project> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agent-deck/projects',
    payload: { name, color },
  })
  return Project.parse(res.json())
}

describe('GET /api/agent-deck/organization', () => {
  it('returns an empty store on a fresh install', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/organization' })
    expect(res.statusCode).toBe(200)
    expect(Organization.parse(res.json())).toEqual({ projects: [], assignments: {} })
  })

  it('reflects created projects + assignments', async () => {
    const p = await createProject('CourseKit', 'teal')
    await app.inject({
      method: 'PUT',
      url: `/api/agent-deck/sessions/s1/organization`,
      payload: { projectId: p.id, tags: ['urgent'] },
    })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/organization' })
    const org = Organization.parse(res.json())
    expect(org.projects).toEqual([p])
    expect(org.assignments.s1).toEqual({ projectId: p.id, tags: ['urgent'] })
  })
})

describe('POST /api/agent-deck/projects', () => {
  it('creates a project with a server-assigned id (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/projects',
      payload: { name: '  Big Project ', color: 'amber' },
    })
    expect(res.statusCode).toBe(201)
    const p = Project.parse(res.json())
    expect(p.id).toBeTruthy()
    expect(p.name).toBe('Big Project') // trimmed
    expect(p.color).toBe('amber')
  })

  it('rejects a blank name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/projects',
      payload: { name: '   ', color: 'teal' },
    })
    expect(res.statusCode).toBe(400)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })

  it('rejects a missing color with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/projects',
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/agent-deck/projects/:id', () => {
  it('renames a project', async () => {
    const p = await createProject('Old', 'teal')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agent-deck/projects/${p.id}`,
      payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(Project.parse(res.json())).toEqual({ id: p.id, name: 'New', color: 'teal' })
  })

  it('recolors a project', async () => {
    const p = await createProject('X', 'teal')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agent-deck/projects/${p.id}`,
      payload: { color: 'rose' },
    })
    expect(res.statusCode).toBe(200)
    expect(Project.parse(res.json()).color).toBe('rose')
  })

  it('404s for an unknown project', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agent-deck/projects/missing',
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('400s for an empty update body', async () => {
    const p = await createProject('X', 'teal')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agent-deck/projects/${p.id}`,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/agent-deck/projects/:id', () => {
  it('deletes a project and clears its assignments', async () => {
    const p = await createProject('Doomed', 'rose')
    await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: p.id, tags: ['keep'] },
    })
    await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s2/organization',
      payload: { projectId: p.id, tags: [] },
    })

    const res = await app.inject({ method: 'DELETE', url: `/api/agent-deck/projects/${p.id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const org = Organization.parse(
      (await app.inject({ method: 'GET', url: '/api/agent-deck/organization' })).json(),
    )
    expect(org.projects).toHaveLength(0)
    // s1 keeps its tags, loses the dangling project; s2 (project-only) is pruned.
    expect(org.assignments.s1).toEqual({ tags: ['keep'] })
    expect(org.assignments.s2).toBeUndefined()
  })

  it('404s for an unknown project', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-deck/projects/missing' })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/agent-deck/sessions/:id/organization', () => {
  it('sets project + tags', async () => {
    const p = await createProject('X', 'teal')
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: p.id, tags: ['alpha'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ projectId: p.id, tags: ['alpha'] })
  })

  it('normalizes tags (trim, lowercase, dedupe, drop empties)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: null, tags: ['  Urgent ', 'urgent', 'REVIEW', '   ', 'review'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ tags: ['urgent', 'review'] })
  })

  it('null projectId + empty tags clears the assignment', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: 'p1', tags: ['x'] },
    })
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: null, tags: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({})
    const org = Organization.parse(
      (await app.inject({ method: 'GET', url: '/api/agent-deck/organization' })).json(),
    )
    expect(org.assignments.s1).toBeUndefined()
  })

  it('400s when tags is missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/sessions/s1/organization',
      payload: { projectId: null },
    })
    expect(res.statusCode).toBe(400)
  })

  it('never leaks the on-disk store path in a response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/organization' })
    expect(res.body).not.toContain(dir)
    expect(res.body).not.toContain('organization.json')
  })
})

describe('normalizeTags', () => {
  it('trims, lowercases, dedupes, drops empties', () => {
    expect(normalizeTags(['  A ', 'a', 'B', '', '   '])).toEqual(['a', 'b'])
  })

  it('caps tag length', () => {
    const long = 'x'.repeat(100)
    const [only] = normalizeTags([long])
    expect(only!.length).toBe(40)
  })

  it('caps the number of tags', () => {
    const many = Array.from({ length: 50 }, (_, i) => `t${i}`)
    expect(normalizeTags(many)).toHaveLength(30)
  })
})

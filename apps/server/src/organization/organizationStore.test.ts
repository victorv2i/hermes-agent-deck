import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrganizationStore, emptyOrganization, defaultStorePath } from './organizationStore'

let dir: string
let storePath: string
let store: OrganizationStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-deck-org-'))
  storePath = join(dir, 'agent-deck', 'organization.json')
  store = new OrganizationStore(storePath)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('OrganizationStore.load (tolerance)', () => {
  it('returns an empty store when the file is missing', async () => {
    expect(await store.load()).toEqual(emptyOrganization())
  })

  it('returns an empty store when the file is corrupt JSON', async () => {
    await writeFile(storePath.replace(/[^/]+$/, ''), '', 'utf8').catch(() => {})
    // create the dir + a garbage file
    await new OrganizationStore(storePath).save(emptyOrganization())
    await writeFile(storePath, '{ not json', 'utf8')
    expect(await store.load()).toEqual(emptyOrganization())
  })

  it('drops malformed projects/assignments but keeps valid ones', async () => {
    await store.save(emptyOrganization())
    await writeFile(
      storePath,
      JSON.stringify({
        projects: [
          { id: 'p1', name: 'Good', color: 'teal' },
          { id: 'p2', name: 42 }, // bad: name not a string
          'nope',
        ],
        assignments: {
          s1: { projectId: 'p1', tags: ['a', 7, 'b'] }, // 7 dropped
          s2: { junk: true }, // no projectId/tags → dropped
        },
      }),
      'utf8',
    )
    const org = await store.load()
    expect(org.projects).toEqual([{ id: 'p1', name: 'Good', color: 'teal' }])
    expect(org.assignments.s1).toEqual({ projectId: 'p1', tags: ['a', 'b'] })
    expect(org.assignments.s2).toBeUndefined()
  })
})

describe('OrganizationStore.save (round-trip + atomicity)', () => {
  it('round-trips a populated store', async () => {
    const data = {
      projects: [{ id: 'p1', name: 'CourseKit', color: 'teal' }],
      assignments: { s1: { projectId: 'p1', tags: ['urgent'] } },
    }
    await store.save(data)
    expect(await store.load()).toEqual(data)
  })

  it('creates the agent-deck dir if absent', async () => {
    await store.save(emptyOrganization())
    const text = await readFile(storePath, 'utf8')
    expect(JSON.parse(text)).toEqual(emptyOrganization())
  })

  it('leaves no temp files behind after a save', async () => {
    await store.save(emptyOrganization())
    const entries = await readdir(join(dir, 'agent-deck'))
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
    expect(entries).toContain('organization.json')
  })
})

describe('OrganizationStore project mutations', () => {
  it('createProject assigns a server id and persists', async () => {
    const p = await store.createProject({ name: 'Big', color: 'amber' })
    expect(p.id).toBeTruthy()
    expect(p).toMatchObject({ name: 'Big', color: 'amber' })
    expect((await store.load()).projects).toEqual([p])
  })

  it('updateProject renames/recolors and returns the project', async () => {
    const p = await store.createProject({ name: 'Old', color: 'teal' })
    const updated = await store.updateProject(p.id, { name: 'New' })
    expect(updated).toEqual({ id: p.id, name: 'New', color: 'teal' })
    expect((await store.load()).projects[0]!.name).toBe('New')
  })

  it('updateProject returns null for an unknown id', async () => {
    expect(await store.updateProject('missing', { name: 'X' })).toBeNull()
  })

  it('deleteProject removes the project and clears its assignments', async () => {
    const p = await store.createProject({ name: 'Doomed', color: 'rose' })
    await store.setSessionOrganization('s1', { projectId: p.id, tags: ['keepme'] })
    await store.setSessionOrganization('s2', { projectId: p.id, tags: [] })

    expect(await store.deleteProject(p.id)).toBe(true)
    const org = await store.load()
    expect(org.projects).toHaveLength(0)
    // s1 kept its tags but lost the dangling project; s2 (project-only) is pruned.
    expect(org.assignments.s1).toEqual({ tags: ['keepme'] })
    expect(org.assignments.s2).toBeUndefined()
  })

  it('deleteProject returns false for an unknown id', async () => {
    expect(await store.deleteProject('missing')).toBe(false)
  })
})

describe('OrganizationStore.setSessionOrganization', () => {
  it('sets project + tags', async () => {
    const a = await store.setSessionOrganization('s1', { projectId: 'p1', tags: ['x'] })
    expect(a).toEqual({ projectId: 'p1', tags: ['x'] })
    expect((await store.load()).assignments.s1).toEqual({ projectId: 'p1', tags: ['x'] })
  })

  it('null projectId + empty tags prunes the assignment entirely', async () => {
    await store.setSessionOrganization('s1', { projectId: 'p1', tags: ['x'] })
    const a = await store.setSessionOrganization('s1', { projectId: null, tags: [] })
    expect(a).toEqual({})
    expect((await store.load()).assignments.s1).toBeUndefined()
  })

  it('null projectId keeps tags', async () => {
    const a = await store.setSessionOrganization('s1', { projectId: null, tags: ['a', 'b'] })
    expect(a).toEqual({ tags: ['a', 'b'] })
  })
})

describe('defaultStorePath', () => {
  it('nests organization.json under agent-deck in hermes home', () => {
    expect(defaultStorePath('/home/u/.hermes')).toBe('/home/u/.hermes/agent-deck/organization.json')
  })
})

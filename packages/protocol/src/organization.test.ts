import { describe, it, expect } from 'vitest'
import {
  Project,
  Organization,
  SessionAssignment,
  ProjectCreateInput,
  ProjectUpdateInput,
  SessionOrganizationInput,
} from './organization'

describe('Project DTO', () => {
  it('parses a valid project', () => {
    const p = Project.parse({ id: 'p1', name: 'CourseKit', color: 'teal' })
    expect(p).toEqual({ id: 'p1', name: 'CourseKit', color: 'teal' })
  })

  it('drops unknown keys (no smuggling extra fields into the store)', () => {
    const p = Project.parse({ id: 'p1', name: 'X', color: 'teal', secret: 'leak' })
    expect(p).not.toHaveProperty('secret')
  })

  it('rejects an empty name', () => {
    expect(Project.safeParse({ id: 'p1', name: '', color: 'teal' }).success).toBe(false)
  })
})

describe('Organization DTO', () => {
  it('parses projects + assignments', () => {
    const org = Organization.parse({
      projects: [{ id: 'p1', name: 'X', color: 'teal' }],
      assignments: { s1: { projectId: 'p1', tags: ['urgent'] }, s2: { tags: [] } },
    })
    expect(org.projects).toHaveLength(1)
    expect(org.assignments.s1).toEqual({ projectId: 'p1', tags: ['urgent'] })
  })

  it('accepts an empty store', () => {
    expect(Organization.parse({ projects: [], assignments: {} })).toEqual({
      projects: [],
      assignments: {},
    })
  })

  it('allows an assignment with neither projectId nor tags', () => {
    expect(SessionAssignment.parse({})).toEqual({})
  })
})

describe('ProjectCreateInput', () => {
  it('trims the name', () => {
    expect(ProjectCreateInput.parse({ name: '  Big  ', color: 'amber' }).name).toBe('Big')
  })

  it('rejects a blank name', () => {
    expect(ProjectCreateInput.safeParse({ name: '   ', color: 'amber' }).success).toBe(false)
  })

  it('rejects a missing color', () => {
    expect(ProjectCreateInput.safeParse({ name: 'X' }).success).toBe(false)
  })
})

describe('ProjectUpdateInput', () => {
  it('accepts a name-only update', () => {
    expect(ProjectUpdateInput.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })

  it('accepts a color-only update', () => {
    expect(ProjectUpdateInput.parse({ color: 'rose' })).toEqual({ color: 'rose' })
  })

  it('rejects an empty update (no fields)', () => {
    expect(ProjectUpdateInput.safeParse({}).success).toBe(false)
  })
})

describe('SessionOrganizationInput', () => {
  it('accepts a project id + tags', () => {
    expect(SessionOrganizationInput.parse({ projectId: 'p1', tags: ['a', 'b'] })).toEqual({
      projectId: 'p1',
      tags: ['a', 'b'],
    })
  })

  it('accepts a null projectId (clear membership)', () => {
    expect(SessionOrganizationInput.parse({ projectId: null, tags: [] })).toEqual({
      projectId: null,
      tags: [],
    })
  })

  it('requires the tags array', () => {
    expect(SessionOrganizationInput.safeParse({ projectId: null }).success).toBe(false)
  })
})

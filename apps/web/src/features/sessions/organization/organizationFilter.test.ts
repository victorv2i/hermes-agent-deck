import { describe, it, expect } from 'vitest'
import {
  applyOrganizationFilter,
  projectCounts,
  sessionTags,
  sessionProjectId,
  allTags,
  EMPTY_ORGANIZATION,
  type OrganizationFilter,
} from './organizationFilter'
import type { Organization } from '@agent-deck/protocol'
import type { SessionSummary } from '../types'

function s(id: string): SessionSummary {
  const now = Math.floor(Date.now() / 1000)
  return {
    id,
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: id,
    preview: 'p',
    started_at: now,
    last_active: now,
    message_count: 1,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: 'none',
  }
}

const org: Organization = {
  projects: [
    { id: 'p1', name: 'Alpha', color: 'violet' },
    { id: 'p2', name: 'Beta', color: 'teal' },
  ],
  assignments: {
    a: { projectId: 'p1', tags: ['urgent', 'ui'] },
    b: { projectId: 'p1' },
    c: { projectId: 'p2', tags: ['ui'] },
    d: { tags: ['urgent'] },
  },
}

const sessions = [s('a'), s('b'), s('c'), s('d'), s('e')]

const NONE: OrganizationFilter = { projectId: null, tag: null }

describe('accessors', () => {
  it('reads a session project + tags, tolerating missing entries', () => {
    expect(sessionProjectId(org, 'a')).toBe('p1')
    expect(sessionProjectId(org, 'e')).toBeNull()
    expect(sessionTags(org, 'a')).toEqual(['urgent', 'ui'])
    expect(sessionTags(org, 'b')).toEqual([])
    expect(sessionTags(org, 'e')).toEqual([])
  })

  it('collects the union of all tags, sorted + deduped', () => {
    expect(allTags(org)).toEqual(['ui', 'urgent'])
    expect(allTags(EMPTY_ORGANIZATION)).toEqual([])
  })
})

describe('projectCounts', () => {
  it('counts only sessions that EXIST in the list (ignores orphan assignments)', () => {
    const orgWithOrphan: Organization = {
      ...org,
      assignments: { ...org.assignments, gone: { projectId: 'p1' } },
    }
    const counts = projectCounts(orgWithOrphan, sessions)
    // a + b are in p1 (gone is an orphan id not in the list → not counted)
    expect(counts.get('p1')).toBe(2)
    expect(counts.get('p2')).toBe(1)
  })
})

describe('applyOrganizationFilter', () => {
  it('returns every session when no filter is active', () => {
    expect(applyOrganizationFilter(sessions, org, NONE).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  it('filters to a project membership', () => {
    expect(
      applyOrganizationFilter(sessions, org, { projectId: 'p1', tag: null }).map((x) => x.id),
    ).toEqual(['a', 'b'])
  })

  it('filters by a tag across projects', () => {
    expect(
      applyOrganizationFilter(sessions, org, { projectId: null, tag: 'urgent' }).map((x) => x.id),
    ).toEqual(['a', 'd'])
  })

  it('composes project AND tag (both must match)', () => {
    expect(
      applyOrganizationFilter(sessions, org, { projectId: 'p1', tag: 'ui' }).map((x) => x.id),
    ).toEqual(['a'])
    // p2 + urgent → no session is both
    expect(applyOrganizationFilter(sessions, org, { projectId: 'p2', tag: 'urgent' })).toEqual([])
  })

  it('a tag filter is case-insensitive (matches the normalized store)', () => {
    expect(
      applyOrganizationFilter(sessions, org, { projectId: null, tag: 'URGENT' }).map((x) => x.id),
    ).toEqual(['a', 'd'])
  })

  it('preserves the input order (filtering only removes)', () => {
    const reversed = [...sessions].reverse()
    expect(
      applyOrganizationFilter(reversed, org, { projectId: 'p1', tag: null }).map((x) => x.id),
    ).toEqual(['b', 'a'])
  })
})

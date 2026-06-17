import { describe, it, expect } from 'vitest'
import {
  STUDIO_SECTIONS,
  DEFAULT_STUDIO_SECTION,
  STUDIO_VIEWS,
  DEFAULT_STUDIO_VIEW,
  isStudioSection,
  isStudioView,
  resolveStudioSection,
  resolveStudioView,
  resolveSelectedAgent,
  cloneName,
  type StudioSelection,
} from './selection'

describe('cloneName', () => {
  it('derives <source>-copy, then numbers it to dodge collisions', () => {
    expect(cloneName('mercury', [])).toBe('mercury-copy')
    expect(cloneName('mercury', ['mercury-copy'])).toBe('mercury-copy-2')
    expect(cloneName('mercury', ['mercury-copy', 'mercury-copy-2'])).toBe('mercury-copy-3')
  })
})

describe('STUDIO_SECTIONS', () => {
  it('is the closed, ordered workbench section set from the spec', () => {
    expect(STUDIO_SECTIONS).toEqual(['identity', 'soul', 'model', 'tools', 'memory', 'skills', 'env'])
  })

  it('defaults to identity', () => {
    expect(DEFAULT_STUDIO_SECTION).toBe('identity')
    expect(STUDIO_SECTIONS).toContain(DEFAULT_STUDIO_SECTION)
  })
})

describe('isStudioSection', () => {
  it('accepts every known section', () => {
    for (const s of STUDIO_SECTIONS) expect(isStudioSection(s)).toBe(true)
  })

  it('rejects an unknown / malformed value', () => {
    expect(isStudioSection('delegation')).toBe(false)
    expect(isStudioSection('')).toBe(false)
    expect(isStudioSection(null)).toBe(false)
    expect(isStudioSection(undefined)).toBe(false)
    expect(isStudioSection(3)).toBe(false)
  })
})

describe('resolveStudioSection', () => {
  it('returns a valid requested section unchanged', () => {
    expect(resolveStudioSection('model')).toBe('model')
  })

  it('falls back to the default for an unknown / missing section', () => {
    expect(resolveStudioSection('nope')).toBe('identity')
    expect(resolveStudioSection(null)).toBe('identity')
    expect(resolveStudioSection(undefined)).toBe('identity')
  })
})

describe('STUDIO_VIEWS', () => {
  it('is the closed top-level view set (agents default, then connections)', () => {
    expect(STUDIO_VIEWS).toEqual(['agents', 'connections'])
    expect(DEFAULT_STUDIO_VIEW).toBe('agents')
    expect(STUDIO_VIEWS).toContain(DEFAULT_STUDIO_VIEW)
  })
})

describe('isStudioView', () => {
  it('accepts every known view', () => {
    for (const v of STUDIO_VIEWS) expect(isStudioView(v)).toBe(true)
  })

  it('rejects an unknown / malformed value', () => {
    expect(isStudioView('settings')).toBe(false)
    expect(isStudioView('')).toBe(false)
    expect(isStudioView(null)).toBe(false)
    expect(isStudioView(undefined)).toBe(false)
    expect(isStudioView(2)).toBe(false)
  })
})

describe('resolveStudioView', () => {
  it('returns a valid requested view unchanged', () => {
    expect(resolveStudioView('connections')).toBe('connections')
    expect(resolveStudioView('agents')).toBe('agents')
  })

  it('falls back to the default (agents) for an unknown / missing view', () => {
    expect(resolveStudioView('nope')).toBe('agents')
    expect(resolveStudioView(null)).toBe('agents')
    expect(resolveStudioView(undefined)).toBe('agents')
  })
})

describe('resolveSelectedAgent', () => {
  const roster = ['default', 'coder', 'writer']

  it('prefers an explicit selection that exists in the roster', () => {
    expect(resolveSelectedAgent({ selected: 'writer', active: 'coder', roster })).toBe('writer')
  })

  it('ignores a stale selection (no longer in the roster) and uses the active agent', () => {
    expect(resolveSelectedAgent({ selected: 'deleted-agent', active: 'coder', roster })).toBe(
      'coder',
    )
  })

  it('falls back to the active agent when nothing is selected', () => {
    expect(resolveSelectedAgent({ selected: null, active: 'coder', roster })).toBe('coder')
  })

  it('falls back to the first roster entry when the active agent is unknown', () => {
    expect(resolveSelectedAgent({ selected: null, active: 'ghost', roster })).toBe('default')
  })

  it('returns null when the roster is empty (nothing to select)', () => {
    expect(resolveSelectedAgent({ selected: 'coder', active: 'coder', roster: [] })).toBeNull()
  })

  it('does not require a deep-link selection to match case-insensitively (exact match only)', () => {
    // Hermes profile names are case-sensitive; an off-case deep link is stale.
    expect(resolveSelectedAgent({ selected: 'Coder', active: 'default', roster })).toBe('default')
  })
})

describe('StudioSelection is serializable', () => {
  it('round-trips through JSON unchanged', () => {
    const sel: StudioSelection = { agent: 'coder', section: 'model' }
    expect(JSON.parse(JSON.stringify(sel))).toEqual(sel)
  })
})

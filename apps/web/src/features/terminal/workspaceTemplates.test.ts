import { describe, it, expect } from 'vitest'
import { WORKSPACE_TEMPLATES, findTemplate, instantiateTemplate } from './workspaceTemplates'

const PANE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

describe('workspace templates', () => {
  it('ships the documented presets', () => {
    const ids = WORKSPACE_TEMPLATES.map((t) => t.id)
    expect(ids).toContain('blank')
    expect(ids).toContain('hermes-claude')
    expect(ids).toContain('three-shells')
    expect(ids).toContain('build-watch')
  })

  it('instantiates Hermes + Claude as two panes with the right CLIs', () => {
    const panes = instantiateTemplate('hermes-claude', (i) => `s${i}`)
    expect(panes.map((p) => p.cli)).toEqual(['hermes', 'claude'])
    expect(panes.map((p) => p.label)).toEqual(['Hermes', 'Claude Code'])
  })

  it('mints arg-safe, unique pane ids', () => {
    const panes = instantiateTemplate('three-shells')
    expect(panes).toHaveLength(3)
    for (const p of panes) expect(p.id).toMatch(PANE_ID_RE)
    expect(new Set(panes.map((p) => p.id)).size).toBe(3) // all distinct
  })

  it('two instantiations of the same template do not collide', () => {
    const a = instantiateTemplate('build-watch')
    const b = instantiateTemplate('build-watch')
    const overlap = a.some((pa) => b.some((pb) => pb.id === pa.id))
    expect(overlap).toBe(false)
  })

  it('returns [] for an unknown template id', () => {
    expect(instantiateTemplate('nope')).toEqual([])
    expect(findTemplate('nope')).toBeUndefined()
  })
})

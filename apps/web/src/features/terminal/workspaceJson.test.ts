import { describe, it, expect } from 'vitest'
import type { WorkspaceDefinition } from '@agent-deck/protocol'
import {
  parseWorkspaceTemplate,
  serializeWorkspaceTemplate,
  workspaceToTemplate,
} from './workspaceJson'

const DEF: WorkspaceDefinition = {
  id: 'ws_abc',
  name: 'Client project',
  description: 'two panes',
  panes: [
    { id: 'p1', label: 'Hermes', cli: 'hermes' },
    { id: 'p2', label: 'Claude Code', cli: 'claude', cwd: '/work/app' },
  ],
  createdAt: '2026-06-17T00:00:00Z',
  lastModifiedAt: '2026-06-17T00:00:00Z',
}

describe('workspaceToTemplate', () => {
  it('strips server-owned id + timestamps, keeps the shareable shape', () => {
    const tpl = workspaceToTemplate(DEF)
    expect(tpl).toEqual({
      kind: 'agentdeck.workspace-template',
      name: 'Client project',
      description: 'two panes',
      panes: DEF.panes,
    })
    expect(tpl).not.toHaveProperty('id')
    expect(tpl).not.toHaveProperty('createdAt')
  })
})

describe('serialize → parse round-trip', () => {
  it('re-mints pane ids but preserves name, labels, clis, and cwds', () => {
    const json = serializeWorkspaceTemplate(DEF)
    const req = parseWorkspaceTemplate(json, (i) => `m${i}`)
    expect(req.name).toBe('Client project')
    expect(req.panes?.map((p) => p.label)).toEqual(['Hermes', 'Claude Code'])
    expect(req.panes?.map((p) => p.cli)).toEqual(['hermes', 'claude'])
    expect(req.panes?.[1]?.cwd).toBe('/work/app')
    // Ids are re-minted (NOT the original p1/p2), so an import never collides.
    expect(req.panes?.map((p) => p.id)).toEqual(['hermes-1-m0', 'claude-2-m1'])
  })
})

describe('parseWorkspaceTemplate validation', () => {
  it('throws on non-JSON', () => {
    expect(() => parseWorkspaceTemplate('not json')).toThrow(/not valid JSON/i)
  })

  it('throws on a JSON that is not a template shape', () => {
    expect(() => parseWorkspaceTemplate(JSON.stringify({ foo: 'bar' }))).toThrow(
      /not a valid workspace template/i,
    )
  })

  it('accepts a minimal template without the kind marker', () => {
    const req = parseWorkspaceTemplate(
      JSON.stringify({ name: 'Mini', panes: [{ id: 'x', label: 'S', cli: 'shell' }] }),
      () => 'z',
    )
    expect(req.name).toBe('Mini')
    expect(req.panes).toHaveLength(1)
  })

  it('rejects an over-long name', () => {
    expect(() =>
      parseWorkspaceTemplate(JSON.stringify({ name: 'x'.repeat(81), panes: [] })),
    ).toThrow(/not a valid workspace template/i)
  })
})

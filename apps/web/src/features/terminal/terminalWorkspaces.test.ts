import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_TERMINALS,
  WORKSPACE_LAYOUT_PRESETS,
  WORKSPACES_CACHE_KEY,
  WORKSPACE_STATE_KEY_PREFIX,
  LAST_WORKSPACE_KEY,
  paneSessionId,
  emptyWorkspace,
  workspaceStateKey,
  addPane,
  removePane,
  renamePane,
  setPaneCli,
  setPaneCwd,
  restartPane,
  setActivePane,
  setViewMode,
  applyLayoutPreset,
  isAtCap,
  fromDefinition,
  toPaneDefinitions,
  readWorkspacesCache,
  writeWorkspacesCache,
  readWorkspaceState,
  writeWorkspaceState,
  readLastWorkspaceId,
  writeLastWorkspaceId,
  panesFromSessions,
  type WorkspaceState,
} from './terminalWorkspaces'
import {
  emptySessions,
  openSession,
  openAttachSession,
  type TerminalSession,
} from './terminalSessions'

/** Add `n` panes of a given cli to a workspace, returning the final state. */
function addMany(state: WorkspaceState, n: number, cli: 'hermes' | 'shell' = 'shell') {
  let s = state
  for (let i = 0; i < n; i += 1) s = addPane(s, cli)
  return s
}

describe('paneSessionId (deterministic, cross-device)', () => {
  it('is ws_<wid>_<pid> at epoch 0 (no epoch suffix)', () => {
    expect(paneSessionId('w1', 'p1', 0)).toBe('ws_w1_p1')
  })

  it('appends _<epoch> only when epoch > 0', () => {
    expect(paneSessionId('w1', 'p1', 1)).toBe('ws_w1_p1_1')
    expect(paneSessionId('w1', 'p1', 5)).toBe('ws_w1_p1_5')
  })

  it('is stable for the same inputs (any device computes the same id)', () => {
    expect(paneSessionId('abc', 'pane-2', 0)).toBe(paneSessionId('abc', 'pane-2', 0))
  })

  it('distinguishes workspace and pane components', () => {
    expect(paneSessionId('w1', 'p1', 0)).not.toBe(paneSessionId('w1', 'p2', 0))
    expect(paneSessionId('w1', 'p1', 0)).not.toBe(paneSessionId('w2', 'p1', 0))
  })
})

describe('terminalWorkspaces reducers', () => {
  it('MAX_TERMINALS is 12 (reused, the shared cap)', () => {
    expect(MAX_TERMINALS).toBe(12)
  })

  it('emptyWorkspace seeds id/name with no panes and tab view', () => {
    const s = emptyWorkspace('w1', 'Build')
    expect(s.id).toBe('w1')
    expect(s.name).toBe('Build')
    expect(s.panes).toHaveLength(0)
    expect(s.activePane).toBeNull()
    expect(s.viewMode).toBe('tab')
  })

  it('emptyWorkspace accepts an explicit initial view mode', () => {
    expect(emptyWorkspace('w1', 'Build', 'grid').viewMode).toBe('grid')
  })

  it('adds a pane, makes it active, and records its cli', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'hermes')
    expect(s.panes).toHaveLength(1)
    expect(s.panes[0]!.cli).toBe('hermes')
    expect(s.panes[0]!.epoch).toBe(0)
    expect(s.activePane).toBe(s.panes[0]!.id)
  })

  it('assigns each pane a UNIQUE id', () => {
    const s = addMany(emptyWorkspace('w1', 'Build'), 3)
    const ids = new Set(s.panes.map((p) => p.id))
    expect(ids.size).toBe(3)
  })

  it('pane ids match the protocol id regex (safe to reach a tmux target)', () => {
    const s = addMany(emptyWorkspace('w1', 'Build'), 3)
    for (const p of s.panes) expect(p.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('derives a default pane label from the cli + an index when unnamed', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'hermes')
    s = addPane(s, 'hermes')
    expect(s.panes[0]!.label).not.toBe(s.panes[1]!.label)
    expect(s.panes[0]!.label.toLowerCase()).toContain('hermes')
  })

  it('newly added pane becomes the active one', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    const first = s.activePane
    s = addPane(s, 'hermes')
    expect(s.activePane).not.toBe(first)
    expect(s.activePane).toBe(s.panes[1]!.id)
  })

  it('enforces the 12-pane cap honestly (no-op same reference past the cap)', () => {
    const s = addMany(emptyWorkspace('w1', 'Build'), MAX_TERMINALS)
    expect(s.panes).toHaveLength(MAX_TERMINALS)
    expect(isAtCap(s)).toBe(true)
    const after = addPane(s, 'shell')
    expect(after).toBe(s)
    expect(after.panes).toHaveLength(MAX_TERMINALS)
  })

  it('removes a non-active pane, leaving the active one selected', () => {
    let s = addMany(emptyWorkspace('w1', 'Build'), 3)
    const active = s.activePane
    const toRemove = s.panes[0]!.id
    s = removePane(s, toRemove)
    expect(s.panes.map((p) => p.id)).not.toContain(toRemove)
    expect(s.activePane).toBe(active)
  })

  it('removing the active pane selects an adjacent neighbor', () => {
    let s = addMany(emptyWorkspace('w1', 'Build'), 3)
    const neighbor = s.panes[1]!.id
    s = removePane(s, s.activePane as string)
    expect(s.panes).toHaveLength(2)
    expect(s.activePane).toBe(neighbor)
  })

  it('removing the last pane clears the active id', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    s = removePane(s, s.activePane as string)
    expect(s.panes).toHaveLength(0)
    expect(s.activePane).toBeNull()
  })

  it('removing an unknown pane is a no-op (same reference)', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(removePane(s, 'nope')).toBe(s)
  })

  it('renames a pane by id, trimming; a blank rename is ignored', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    const id = s.panes[0]!.id
    s = renamePane(s, id, '  build watch  ')
    expect(s.panes[0]!.label).toBe('build watch')
    s = renamePane(s, id, '   ')
    expect(s.panes[0]!.label).toBe('build watch')
  })

  it('renaming an unknown pane is a no-op (same reference)', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(renamePane(s, 'nope', 'x')).toBe(s)
  })

  it('setPaneCli changes the pane cli and drops any attach (mutually exclusive)', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    const id = s.panes[0]!.id
    s = setPaneCli(s, id, 'codex')
    expect(s.panes[0]!.cli).toBe('codex')
    expect(s.panes[0]!.attach).toBeUndefined()
  })

  it('setPaneCli on an unknown pane is a no-op (same reference)', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(setPaneCli(s, 'nope', 'codex')).toBe(s)
  })

  it('setPaneCwd sets and clears (blank/whitespace clears to undefined)', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    const id = s.panes[0]!.id
    s = setPaneCwd(s, id, '/home/operator/Projects')
    expect(s.panes[0]!.cwd).toBe('/home/operator/Projects')
    s = setPaneCwd(s, id, '   ')
    expect(s.panes[0]!.cwd).toBeUndefined()
  })

  it('setPaneCwd on an unknown pane is a no-op (same reference)', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(setPaneCwd(s, 'nope', '/tmp')).toBe(s)
  })

  it('restartPane bumps the epoch, keeping id/label/cli', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    s = renamePane(s, s.panes[0]!.id, 'logs')
    const id = s.panes[0]!.id
    const before = s.panes[0]!.epoch
    s = restartPane(s, id)
    expect(s.panes[0]!.id).toBe(id)
    expect(s.panes[0]!.label).toBe('logs')
    expect(s.panes[0]!.cli).toBe('shell')
    expect(s.panes[0]!.epoch).toBe(before + 1)
  })

  it('restartPane drives a NEW deterministic sessionId (fresh shell)', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    const id = s.panes[0]!.id
    const before = paneSessionId('w1', id, s.panes[0]!.epoch)
    s = restartPane(s, id)
    const after = paneSessionId('w1', id, s.panes[0]!.epoch)
    expect(before).toBe(`ws_w1_${id}`)
    expect(after).toBe(`ws_w1_${id}_1`)
    expect(after).not.toBe(before)
  })

  it('restartPane on an unknown pane is a no-op (same reference)', () => {
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(restartPane(s, 'nope')).toBe(s)
  })

  it('setActivePane selects an existing pane and ignores unknown ids', () => {
    let s = addMany(emptyWorkspace('w1', 'Build'), 2)
    const first = s.panes[0]!.id
    s = setActivePane(s, first)
    expect(s.activePane).toBe(first)
    expect(setActivePane(s, 'nope')).toBe(s)
  })

  it('toggles the view mode between tab and grid', () => {
    let s = emptyWorkspace('w1', 'Build')
    s = setViewMode(s, 'grid')
    expect(s.viewMode).toBe('grid')
    s = setViewMode(s, 'tab')
    expect(s.viewMode).toBe('tab')
    // No-op same reference when unchanged.
    expect(setViewMode(s, 'tab')).toBe(s)
  })
})

describe('applyLayoutPreset', () => {
  it('exposes the 1/2/3/4/6 presets', () => {
    expect(WORKSPACE_LAYOUT_PRESETS).toEqual([1, 2, 3, 4, 6])
  })

  it('grows an empty workspace to the requested pane count (shell default) in grid', () => {
    const s = applyLayoutPreset(emptyWorkspace('w1', 'Build'), 4)
    expect(s.panes).toHaveLength(4)
    expect(s.panes.every((p) => p.cli === 'shell')).toBe(true)
    expect(s.viewMode).toBe('grid')
    expect(s.activePane).toBe(s.panes[0]!.id)
  })

  it('grows from a partial workspace, preserving existing panes', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'hermes')
    const keep = s.panes[0]!.id
    s = applyLayoutPreset(s, 3)
    expect(s.panes).toHaveLength(3)
    expect(s.panes[0]!.id).toBe(keep)
    expect(s.panes[0]!.cli).toBe('hermes')
  })

  it('shrinks to the requested count, keeping the first panes', () => {
    let s = addMany(emptyWorkspace('w1', 'Build'), 5)
    const firstTwo = s.panes.slice(0, 2).map((p) => p.id)
    s = applyLayoutPreset(s, 2)
    expect(s.panes.map((p) => p.id)).toEqual(firstTwo)
  })

  it('re-points the active pane when shrinking drops the active one', () => {
    let s = addMany(emptyWorkspace('w1', 'Build'), 5)
    // active is the last-added (index 4) — dropped by a shrink to 2.
    s = applyLayoutPreset(s, 2)
    expect(s.panes.some((p) => p.id === s.activePane)).toBe(true)
  })

  it('caps the preset at MAX_TERMINALS and rejects non-positive counts', () => {
    expect(applyLayoutPreset(emptyWorkspace('w1', 'Build'), 99).panes.length).toBe(MAX_TERMINALS)
    const s = addPane(emptyWorkspace('w1', 'Build'), 'shell')
    expect(applyLayoutPreset(s, 0)).toBe(s)
    expect(applyLayoutPreset(s, -2)).toBe(s)
  })

  it('is a no-op (same reference) when the count already matches', () => {
    const s = addMany(emptyWorkspace('w1', 'Build'), 2)
    expect(applyLayoutPreset(s, 2)).toBe(s)
  })
})

describe('fromDefinition / toPaneDefinitions (server is authoritative)', () => {
  it('hydrates a workspace state from a server definition at epoch 0', () => {
    const s = fromDefinition({
      id: 'w1',
      name: 'Build',
      description: 'the build box',
      panes: [
        { id: 'p1', label: 'editor', cli: 'shell', cwd: '/home/operator' },
        { id: 'p2', label: 'agent', cli: 'hermes' },
      ],
      createdAt: '2026-06-14T00:00:00.000Z',
      lastModifiedAt: '2026-06-14T00:00:00.000Z',
    })
    expect(s.id).toBe('w1')
    expect(s.name).toBe('Build')
    expect(s.description).toBe('the build box')
    expect(s.panes.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.panes.every((p) => p.epoch === 0)).toBe(true)
    expect(s.panes[0]!.cwd).toBe('/home/operator')
    expect(s.activePane).toBe('p1')
    expect(s.viewMode).toBe('tab')
  })

  it('hydrates an attach pane (cli undefined, attach set)', () => {
    const s = fromDefinition({
      id: 'w1',
      name: 'Build',
      panes: [{ id: 'p1', label: 'foreign', attach: 'my_session' }],
      createdAt: '2026-06-14T00:00:00.000Z',
      lastModifiedAt: '2026-06-14T00:00:00.000Z',
    })
    expect(s.panes[0]!.attach).toBe('my_session')
    expect(s.panes[0]!.cli).toBeUndefined()
  })

  it('an empty-pane definition hydrates with a null active pane', () => {
    const s = fromDefinition({
      id: 'w1',
      name: 'Build',
      panes: [],
      createdAt: '2026-06-14T00:00:00.000Z',
      lastModifiedAt: '2026-06-14T00:00:00.000Z',
    })
    expect(s.panes).toHaveLength(0)
    expect(s.activePane).toBeNull()
  })

  it('toPaneDefinitions serializes panes back for a PATCH (drops view-only fields)', () => {
    let s = addPane(emptyWorkspace('w1', 'Build'), 'hermes')
    s = setPaneCwd(s, s.panes[0]!.id, '/home/operator')
    s = restartPane(s, s.panes[0]!.id)
    const defs = toPaneDefinitions(s)
    expect(defs).toEqual([
      { id: s.panes[0]!.id, label: s.panes[0]!.label, cli: 'hermes', cwd: '/home/operator' },
    ])
    // epoch is a client-only restart counter, never persisted into the definition.
    expect(Object.prototype.hasOwnProperty.call(defs[0], 'epoch')).toBe(false)
  })

  it('round-trips a definition through hydrate then serialize (stable shape)', () => {
    const def = {
      id: 'w1',
      name: 'Build',
      panes: [
        { id: 'p1', label: 'editor', cli: 'shell' as const, cwd: '/home/operator' },
        { id: 'p2', label: 'foreign', attach: 'my_session' },
      ],
      createdAt: '2026-06-14T00:00:00.000Z',
      lastModifiedAt: '2026-06-14T00:00:00.000Z',
    }
    expect(toPaneDefinitions(fromDefinition(def))).toEqual(def.panes)
  })
})

describe('workspace persistence (cache only; server authoritative on load)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('workspaceStateKey is namespaced per workspace id', () => {
    expect(workspaceStateKey('w1')).toBe(`${WORKSPACE_STATE_KEY_PREFIX}w1`)
    expect(workspaceStateKey('w1')).not.toBe(workspaceStateKey('w2'))
  })

  it('round-trips the workspace-summary cache', () => {
    const summaries = [
      {
        id: 'w1',
        name: 'Build',
        paneCount: 2,
        createdAt: '2026-06-14T00:00:00.000Z',
        lastModifiedAt: '2026-06-14T00:00:00.000Z',
      },
    ]
    writeWorkspacesCache(summaries)
    expect(localStorage.getItem(WORKSPACES_CACHE_KEY)).not.toBeNull()
    expect(readWorkspacesCache()).toEqual(summaries)
  })

  it('returns null for a missing or corrupt workspace cache', () => {
    expect(readWorkspacesCache()).toBeNull()
    localStorage.setItem(WORKSPACES_CACHE_KEY, '{not json')
    expect(readWorkspacesCache()).toBeNull()
    localStorage.setItem(WORKSPACES_CACHE_KEY, JSON.stringify({ nope: 1 }))
    expect(readWorkspacesCache()).toBeNull()
  })

  it('round-trips per-workspace state so a reload restores panes/active/view', () => {
    let s = addPane(emptyWorkspace('w1', 'Build', 'grid'), 'hermes')
    s = addPane(s, 'shell')
    s = renamePane(s, s.panes[0]!.id, 'build')
    writeWorkspaceState(s)
    const restored = readWorkspaceState('w1')
    expect(restored).not.toBeNull()
    expect(restored!.panes.map((p) => p.id)).toEqual(s.panes.map((p) => p.id))
    expect(restored!.panes.map((p) => p.cli)).toEqual(['hermes', 'shell'])
    expect(restored!.panes[0]!.label).toBe('build')
    expect(restored!.activePane).toBe(s.activePane)
    expect(restored!.viewMode).toBe('grid')
  })

  it('returns null for a missing or corrupt per-workspace state', () => {
    expect(readWorkspaceState('w1')).toBeNull()
    localStorage.setItem(workspaceStateKey('w1'), '{not json')
    expect(readWorkspaceState('w1')).toBeNull()
    localStorage.setItem(workspaceStateKey('w1'), JSON.stringify({ panes: 'nope' }))
    expect(readWorkspaceState('w1')).toBeNull()
  })

  it('round-trips the last-active workspace id pointer', () => {
    expect(readLastWorkspaceId()).toBeNull()
    writeLastWorkspaceId('w1')
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('w1')
    expect(readLastWorkspaceId()).toBe('w1')
  })

  it('clears the last-active pointer when passed null', () => {
    writeLastWorkspaceId('w1')
    writeLastWorkspaceId(null)
    expect(readLastWorkspaceId()).toBeNull()
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBeNull()
  })
})

describe('panesFromSessions (Save-promote)', () => {
  it("carries each session's cli + label into a pane (no cwd: Scratch has none)", () => {
    let s = openSession(emptySessions(), 'hermes')
    s = openSession(s, 'shell')
    const panes = panesFromSessions(s.sessions)
    expect(panes).toHaveLength(2)
    expect(panes.map((p) => p.cli)).toEqual(['hermes', 'shell'])
    expect(panes.map((p) => p.label)).toEqual(['Hermes 1', 'Shell 2'])
    // Scratch sessions have no per-pane cwd, so none is sent (server default cwd).
    expect(panes.every((p) => p.cwd === undefined)).toBe(true)
  })

  it('promotes a foreign attach session to an attach pane (no cli)', () => {
    const s = openAttachSession(emptySessions(), 'my_session')
    const panes = panesFromSessions(s.sessions)
    expect(panes).toHaveLength(1)
    expect(panes[0]!.attach).toBe('my_session')
    expect(panes[0]!.cli).toBeUndefined()
  })

  it('keeps pane ids within the protocol charset', () => {
    const s = openSession(emptySessions(), 'shell')
    const panes = panesFromSessions(s.sessions)
    expect(panes[0]!.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('sanitizes + dedupes ids so two sessions never collide on one pane id', () => {
    // Two sessions whose ids sanitize to the same value must not collide (a reused
    // pane id would reattach to the wrong shell given the deterministic sessionId).
    const sessions: TerminalSession[] = [
      { id: 'a b', cli: 'shell', title: 'One', epoch: 0 },
      { id: 'a/b', cli: 'shell', title: 'Two', epoch: 0 },
    ]
    const panes = panesFromSessions(sessions)
    expect(panes).toHaveLength(2)
    expect(panes[0]!.id).not.toBe(panes[1]!.id)
    expect(panes.every((p) => /^[A-Za-z0-9_-]{1,64}$/.test(p.id))).toBe(true)
  })
})

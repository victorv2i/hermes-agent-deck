import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_TERMINALS,
  TERMINAL_VIEW_MODE_KEY,
  TERMINAL_SESSIONS_KEY,
  emptySessions,
  openSession,
  closeSession,
  renameSession,
  restartSession,
  setActive,
  setViewMode,
  isAtCap,
  readViewMode,
  writeViewMode,
  readPersistedSessions,
  writeSessions,
  type SessionsState,
} from './terminalSessions'

/** Open `n` sessions of a given cli, returning the final state. */
function openMany(state: SessionsState, n: number, cli: 'hermes' | 'shell' = 'shell') {
  let s = state
  for (let i = 0; i < n; i += 1) s = openSession(s, cli)
  return s
}

describe('terminalSessions', () => {
  it('starts empty in tab view with no active session', () => {
    const s = emptySessions()
    expect(s.sessions).toHaveLength(0)
    expect(s.activeId).toBeNull()
    expect(s.viewMode).toBe('tab')
  })

  it('opens a session, makes it active, and records its cli', () => {
    const s = openSession(emptySessions(), 'hermes')
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]!.cli).toBe('hermes')
    expect(s.activeId).toBe(s.sessions[0]!.id)
  })

  it('assigns each session a UNIQUE id', () => {
    const s = openMany(emptySessions(), 3)
    const ids = new Set(s.sessions.map((x) => x.id))
    expect(ids.size).toBe(3)
  })

  it('newly opened session becomes the active one', () => {
    let s = openSession(emptySessions(), 'shell')
    const first = s.activeId
    s = openSession(s, 'hermes')
    expect(s.activeId).not.toBe(first)
    expect(s.activeId).toBe(s.sessions[1]!.id)
  })

  it('enforces the 12-terminal cap honestly', () => {
    const s = openMany(emptySessions(), MAX_TERMINALS)
    expect(s.sessions).toHaveLength(MAX_TERMINALS)
    expect(isAtCap(s)).toBe(true)
    // Opening past the cap is a no-op (same reference, no 13th session).
    const after = openSession(s, 'shell')
    expect(after).toBe(s)
    expect(after.sessions).toHaveLength(MAX_TERMINALS)
  })

  it('MAX_TERMINALS is 12', () => {
    expect(MAX_TERMINALS).toBe(12)
  })

  it('closing a non-active session leaves the active one selected', () => {
    let s = openMany(emptySessions(), 3)
    const active = s.activeId
    const toClose = s.sessions[0]!.id
    s = closeSession(s, toClose)
    expect(s.sessions.map((x) => x.id)).not.toContain(toClose)
    expect(s.activeId).toBe(active)
  })

  it('closing the active session selects an adjacent neighbor', () => {
    let s = openMany(emptySessions(), 3)
    // active is the last-opened (index 2); close it → neighbor (index 1) active.
    const neighbor = s.sessions[1]!.id
    s = closeSession(s, s.activeId as string)
    expect(s.sessions).toHaveLength(2)
    expect(s.activeId).toBe(neighbor)
  })

  it('closing the last session clears the active id', () => {
    let s = openSession(emptySessions(), 'shell')
    s = closeSession(s, s.activeId as string)
    expect(s.sessions).toHaveLength(0)
    expect(s.activeId).toBeNull()
  })

  it('renames a session by id', () => {
    let s = openSession(emptySessions(), 'shell')
    const id = s.sessions[0]!.id
    s = renameSession(s, id, '  build watch  ')
    // Trimmed; empty rename is ignored.
    expect(s.sessions[0]!.title).toBe('build watch')
    s = renameSession(s, id, '   ')
    expect(s.sessions[0]!.title).toBe('build watch')
  })

  it('restart bumps a session epoch so the view can remount, keeping id+title', () => {
    let s = openSession(emptySessions(), 'shell')
    s = renameSession(s, s.sessions[0]!.id, 'logs')
    const id = s.sessions[0]!.id
    const before = s.sessions[0]!.epoch
    s = restartSession(s, id)
    expect(s.sessions[0]!.id).toBe(id)
    expect(s.sessions[0]!.title).toBe('logs')
    expect(s.sessions[0]!.epoch).toBe(before + 1)
  })

  it('setActive selects an existing session and ignores unknown ids', () => {
    let s = openMany(emptySessions(), 2)
    const first = s.sessions[0]!.id
    s = setActive(s, first)
    expect(s.activeId).toBe(first)
    const same = setActive(s, 'nope')
    expect(same).toBe(s)
  })

  it('toggles the view mode between tab and grid', () => {
    let s = emptySessions()
    s = setViewMode(s, 'grid')
    expect(s.viewMode).toBe('grid')
    s = setViewMode(s, 'tab')
    expect(s.viewMode).toBe('tab')
  })

  it('seeds emptySessions with an explicit initial view mode (default tab)', () => {
    expect(emptySessions().viewMode).toBe('tab')
    expect(emptySessions('grid').viewMode).toBe('grid')
  })

  it('derives a default title from the cli + an index when unnamed', () => {
    let s = openSession(emptySessions(), 'hermes')
    s = openSession(s, 'hermes')
    // Distinct default titles so two same-cli tabs are tellable apart.
    expect(s.sessions[0]!.title).not.toBe(s.sessions[1]!.title)
    expect(s.sessions[0]!.title.toLowerCase()).toContain('hermes')
  })
})

describe('view-mode persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to tab when nothing is persisted', () => {
    expect(readViewMode()).toBe('tab')
  })

  it('round-trips a written view mode so it survives a reload', () => {
    writeViewMode('grid')
    expect(localStorage.getItem(TERMINAL_VIEW_MODE_KEY)).toBe('grid')
    expect(readViewMode()).toBe('grid')
    writeViewMode('tab')
    expect(readViewMode()).toBe('tab')
  })

  it('ignores an invalid persisted value (falls back to tab)', () => {
    localStorage.setItem(TERMINAL_VIEW_MODE_KEY, 'bogus')
    expect(readViewMode()).toBe('tab')
  })
})

describe('session persistence (refresh resumes the SAME shells)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('gives each session a globally-unique id (no cross-reload collision)', () => {
    // Two independent "page loads" each open a session; their ids must differ so a
    // refresh never reuses a stable id the server already parked for another shell.
    const a = openSession(emptySessions(), 'shell').sessions[0]!.id
    const b = openSession(emptySessions(), 'shell').sessions[0]!.id
    expect(a).not.toBe(b)
  })

  it('round-trips the open sessions so a reload restores the same ids/clis/titles', () => {
    let s = openSession(emptySessions('grid'), 'hermes')
    s = openSession(s, 'shell')
    s = renameSession(s, s.sessions[0]!.id, 'build')
    writeSessions(s)
    const restored = readPersistedSessions()
    expect(restored).not.toBeNull()
    expect(restored!.sessions.map((x) => x.id)).toEqual(s.sessions.map((x) => x.id))
    expect(restored!.sessions.map((x) => x.cli)).toEqual(['hermes', 'shell'])
    expect(restored!.sessions[0]!.title).toBe('build')
    expect(restored!.activeId).toBe(s.activeId)
    expect(restored!.viewMode).toBe('grid')
  })

  it('returns null when nothing is persisted', () => {
    expect(readPersistedSessions()).toBeNull()
  })

  it('returns null for a corrupt persisted payload (falls back to a fresh open)', () => {
    localStorage.setItem(TERMINAL_SESSIONS_KEY, '{not json')
    expect(readPersistedSessions()).toBeNull()
    localStorage.setItem(TERMINAL_SESSIONS_KEY, JSON.stringify({ sessions: 'nope' }))
    expect(readPersistedSessions()).toBeNull()
  })

  it('does not persist an empty session list (clears the key instead)', () => {
    writeSessions(openSession(emptySessions(), 'shell'))
    expect(localStorage.getItem(TERMINAL_SESSIONS_KEY)).not.toBeNull()
    writeSessions(emptySessions())
    expect(localStorage.getItem(TERMINAL_SESSIONS_KEY)).toBeNull()
  })
})

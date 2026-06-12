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
  sessionKey,
  deckTmuxName,
  expectedTmuxName,
  openAttachSession,
  openRecoveredSession,
  reconcileSessions,
  formatEpochAge,
  markRestored,
  expectsResume,
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

describe('foreign attach sessions', () => {
  it('opens an attach tab titled with the tmux session name', () => {
    const s = openAttachSession(emptySessions(), 'victors_own')
    expect(s.sessions).toHaveLength(1)
    const tab = s.sessions[0]!
    expect(tab.attach).toBe('victors_own')
    expect(tab.title).toBe('victors_own')
    expect(s.activeId).toBe(tab.id)
  })

  it('attaching the same session twice only refocuses the existing tab', () => {
    let s = openAttachSession(emptySessions(), 'victors_own')
    s = openSession(s, 'shell')
    const before = s.sessions.length
    s = openAttachSession(s, 'victors_own')
    expect(s.sessions).toHaveLength(before)
    expect(s.activeId).toBe(s.sessions.find((x) => x.attach === 'victors_own')!.id)
  })

  it('attach tabs round-trip through persistence', () => {
    const s = openAttachSession(emptySessions(), 'victors_own')
    writeSessions(s)
    const restored = readPersistedSessions()
    expect(restored!.sessions[0]!.attach).toBe('victors_own')
  })
})

describe('recovered deck sessions + wire keys', () => {
  it('deckTmuxName mirrors the server mapping (sanitize + adk_ prefix + bound)', () => {
    expect(deckTmuxName('term-3-ab12cd:0')).toBe('adk_term-3-ab12cd-0')
    expect(deckTmuxName('a.b:c d/e')).toBe('adk_a-b-c-d-e')
    expect(deckTmuxName('x'.repeat(500)).length).toBeLessThanOrEqual(100)
  })

  it('a recovered session maps back to the SAME tmux name at epoch 0', () => {
    const s = openRecoveredSession(emptySessions(), 'adk_term-1-ab12cd34-0')
    const tab = s.sessions[0]!
    expect(tab.wire).toBe('term-1-ab12cd34-0')
    expect(sessionKey(tab)).toBe('term-1-ab12cd34-0')
    expect(deckTmuxName(sessionKey(tab))).toBe('adk_term-1-ab12cd34-0')
  })

  it('a Restart of a recovered session yields a NEW key (fresh shell, honestly)', () => {
    let s = openRecoveredSession(emptySessions(), 'adk_term-1-ab12cd34-0')
    s = restartSession(s, s.sessions[0]!.id)
    expect(sessionKey(s.sessions[0]!)).toBe('term-1-ab12cd34-0:1')
  })

  it('refuses to recover a non-deck name', () => {
    const empty = emptySessions()
    expect(openRecoveredSession(empty, 'victors_own')).toBe(empty)
    expect(openRecoveredSession(empty, 'adk_')).toBe(empty)
  })

  it('expectedTmuxName covers deck, recovered, and attach entries', () => {
    const deck = openSession(emptySessions(), 'shell').sessions[0]!
    expect(expectedTmuxName(deck)).toBe(deckTmuxName(sessionKey(deck)))
    const rec = openRecoveredSession(emptySessions(), 'adk_w1').sessions[0]!
    expect(expectedTmuxName(rec)).toBe('adk_w1')
    const att = openAttachSession(emptySessions(), 'victors_own').sessions[0]!
    expect(expectedTmuxName(att)).toBe('victors_own')
  })
})

describe('reconcileSessions (server list is the source of truth)', () => {
  const srv = (names: string[], tmuxAvailable = true) => ({
    tmuxAvailable,
    sessions: names.map((name) => ({ name, deckOwned: name.startsWith('adk_') })),
  })

  it('is a no-op (same reference) when tmux is unavailable (volatile behavior)', () => {
    const s = openSession(emptySessions(), 'shell')
    expect(reconcileSessions(s, srv([], false))).toBe(s)
  })

  it('is a no-op (same reference) when everything matches', () => {
    const s = openSession(emptySessions(), 'shell')
    expect(reconcileSessions(s, srv([expectedTmuxName(s.sessions[0]!)]))).toBe(s)
  })

  it('cleans entries whose tmux session no longer exists', () => {
    let s = openSession(emptySessions(), 'shell')
    s = openSession(s, 'hermes')
    const survivor = s.sessions[1]!
    const next = reconcileSessions(s, srv([expectedTmuxName(survivor)]))
    expect(next.sessions.map((x) => x.id)).toEqual([survivor.id])
    expect(next.activeId).toBe(survivor.id)
  })

  it('cleans an attach entry whose foreign session is gone', () => {
    const s = openAttachSession(emptySessions(), 'victors_own')
    const next = reconcileSessions(s, srv([]))
    expect(next.sessions).toHaveLength(0)
    expect(next.activeId).toBeNull()
  })

  it('recovers deck-owned server sessions this browser forgot', () => {
    const s = openSession(emptySessions(), 'shell')
    const mine = expectedTmuxName(s.sessions[0]!)
    const next = reconcileSessions(s, srv([mine, 'adk_forgotten-1', 'victors_own']))
    // The forgotten deck session appears; the foreign one is NOT auto-opened.
    expect(next.sessions).toHaveLength(2)
    const recovered = next.sessions.find((x) => x.wire === 'forgotten-1')!
    expect(recovered.title).toBe('forgotten-1')
    // The surviving active session keeps focus (recovery never steals it).
    expect(next.activeId).toBe(s.activeId)
  })

  it('recovers into an empty state (browser data loss)', () => {
    const next = reconcileSessions(emptySessions(), srv(['adk_lost-1', 'adk_lost-2']))
    expect(next.sessions.map((x) => x.wire).sort()).toEqual(['lost-1', 'lost-2'])
  })

  it('does not duplicate a deck session a local entry already maps to', () => {
    const s = openRecoveredSession(emptySessions(), 'adk_w7')
    expect(reconcileSessions(s, srv(['adk_w7']))).toBe(s)
  })
})

describe('markRestored + expectsResume (the fresh-shell honesty signal)', () => {
  it('marks every restored session as expecting a resume', () => {
    let s = openSession(emptySessions(), 'shell')
    s = openSession(s, 'hermes')
    const marked = markRestored(s)
    expect(marked.sessions.every((sess) => sess.restored === true)).toBe(true)
    expect(marked.sessions.every(expectsResume)).toBe(true)
    // Pure: the original state is untouched.
    expect(s.sessions.every((sess) => sess.restored === undefined)).toBe(true)
  })

  it('is a no-op (same reference) on an empty state', () => {
    const s = emptySessions()
    expect(markRestored(s)).toBe(s)
  })

  it('a brand-new open never expects a resume', () => {
    const s = openSession(emptySessions(), 'shell')
    expect(expectsResume(s.sessions[0]!)).toBe(false)
  })

  it('a recovered deck session (wire id at epoch 0) expects a resume', () => {
    const s = openRecoveredSession(emptySessions(), 'adk_lost-9')
    expect(expectsResume(s.sessions[0]!)).toBe(true)
  })

  it('a Restart clears the expectation (a fresh shell was asked for on purpose)', () => {
    // Restored session, then restarted: the epoch bump is a deliberate fresh
    // shell, so the fresh-shell notice must NOT fire for it.
    let s = markRestored(openSession(emptySessions(), 'shell'))
    expect(expectsResume(s.sessions[0]!)).toBe(true)
    s = restartSession(s, s.sessions[0]!.id)
    expect(s.sessions[0]!.restored).toBeUndefined()
    expect(expectsResume(s.sessions[0]!)).toBe(false)
    // Same for a recovered session: its wire id at a bumped epoch is a new name.
    let r = openRecoveredSession(emptySessions(), 'adk_lost-9')
    r = restartSession(r, r.sessions[0]!.id)
    expect(expectsResume(r.sessions[0]!)).toBe(false)
  })

  it('the restored marker survives a storage round-trip and re-marking', () => {
    const s = markRestored(openSession(emptySessions(), 'shell'))
    writeSessions(s)
    const back = readPersistedSessions()
    expect(back).not.toBeNull()
    expect(markRestored(back!).sessions[0]!.restored).toBe(true)
  })
})

describe('formatEpochAge', () => {
  const now = 1_765_000_000_000 // ms
  it('formats compact relative ages', () => {
    expect(formatEpochAge(1_765_000_000 - 30, now)).toBe('just now')
    expect(formatEpochAge(1_765_000_000 - 5 * 60, now)).toBe('5m ago')
    expect(formatEpochAge(1_765_000_000 - 3 * 3600, now)).toBe('3h ago')
    expect(formatEpochAge(1_765_000_000 - 2 * 86400, now)).toBe('2d ago')
  })
  it('never goes negative on clock skew', () => {
    expect(formatEpochAge(1_765_000_000 + 999, now)).toBe('just now')
  })
})

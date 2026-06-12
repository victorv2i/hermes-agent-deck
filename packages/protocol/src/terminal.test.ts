import { describe, it, expect } from 'vitest'
import { TerminalSessionsResponse, TerminalTmuxSession } from './terminal'

describe('TerminalTmuxSession', () => {
  it('parses a valid session entry', () => {
    const s = TerminalTmuxSession.parse({
      name: 'adk_term-1-ab12',
      deckOwned: true,
      attachedCount: 1,
      createdEpoch: 1765000000,
      persistent: true,
    })
    expect(s.name).toBe('adk_term-1-ab12')
    expect(s.deckOwned).toBe(true)
  })

  it('rejects negative or fractional counts/epochs', () => {
    const base = {
      name: 'x',
      deckOwned: false,
      attachedCount: 0,
      createdEpoch: 0,
      persistent: true,
    }
    expect(() => TerminalTmuxSession.parse({ ...base, attachedCount: -1 })).toThrow()
    expect(() => TerminalTmuxSession.parse({ ...base, createdEpoch: 1.5 })).toThrow()
  })
})

describe('TerminalSessionsResponse', () => {
  it('parses the tmux-unavailable empty shape', () => {
    const r = TerminalSessionsResponse.parse({ tmuxAvailable: false, sessions: [] })
    expect(r.tmuxAvailable).toBe(false)
    expect(r.sessions).toEqual([])
  })

  it('parses a mixed deck-owned + foreign list', () => {
    const r = TerminalSessionsResponse.parse({
      tmuxAvailable: true,
      sessions: [
        {
          name: 'adk_term-2-cd34',
          deckOwned: true,
          attachedCount: 0,
          createdEpoch: 1765000001,
          persistent: true,
        },
        {
          name: 'victors_own',
          deckOwned: false,
          attachedCount: 2,
          createdEpoch: 1764000000,
          persistent: true,
        },
      ],
    })
    expect(r.sessions).toHaveLength(2)
    expect(r.sessions.map((s) => s.deckOwned)).toEqual([true, false])
  })

  it('rejects a malformed list entry', () => {
    expect(() =>
      TerminalSessionsResponse.parse({ tmuxAvailable: true, sessions: [{ name: 'x' }] }),
    ).toThrow()
  })
})

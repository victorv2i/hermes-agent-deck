import { describe, it, expect } from 'vitest'
import { slashQuery, filterSlashCommands, SLASH_COMMANDS } from './slashCommands'

describe('slashQuery', () => {
  it('returns null for a value that does not start with "/"', () => {
    expect(slashQuery('hello')).toBeNull()
    expect(slashQuery('')).toBeNull()
    expect(slashQuery('a/b')).toBeNull()
  })

  it('returns the empty query for a bare "/"', () => {
    expect(slashQuery('/')).toBe('')
  })

  it('returns the lowercased token after the slash', () => {
    expect(slashQuery('/Mo')).toBe('mo')
    expect(slashQuery('/THEME')).toBe('theme')
  })

  it('closes (returns null) once any whitespace is typed — a real message is never hijacked', () => {
    // The key "send verbatim" guarantee: as soon as there's a space, it's prose.
    expect(slashQuery('/note to self')).toBeNull()
    expect(slashQuery('/usr/bin ls')).toBeNull()
    expect(slashQuery('/model ')).toBeNull()
  })
})

describe('filterSlashCommands', () => {
  it('lists every command for an empty query', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('matches by command name (without the leading slash)', () => {
    const out = filterSlashCommands('mo')
    expect(out.map((c) => c.id)).toContain('model')
    expect(out[0]!.id).toBe('model')
  })

  it('matches by keyword and ranks name matches first', () => {
    // "reset" is a keyword of /clear but not in any command name.
    const out = filterSlashCommands('reset')
    expect(out.map((c) => c.id)).toEqual(['clear'])
  })

  it('returns nothing for a non-matching query', () => {
    expect(filterSlashCommands('zzzzz')).toHaveLength(0)
  })

  it('exposes the expected command set (all local UI actions, no agent passthrough)', () => {
    expect(SLASH_COMMANDS.map((c) => c.id).sort()).toEqual([
      'clear',
      'model',
      'new',
      'theme',
      'usage',
    ])
  })

  it('does NOT offer a compaction command — the gateway does not act on slash text', () => {
    // `/compact` + `/compress` are interactive-TUI-only; sending them through the
    // run path would deliver text the agent never acts on (theater), so the menu
    // omits them entirely rather than fake the capability.
    const ids = SLASH_COMMANDS.map((c) => c.id)
    expect(ids).not.toContain('compact')
    expect(ids).not.toContain('compress')
    expect(filterSlashCommands('compact')).toHaveLength(0)
    expect(filterSlashCommands('compress')).toHaveLength(0)
  })

  it('finds /usage by name and by cost-related keywords', () => {
    expect(filterSlashCommands('usage').map((c) => c.id)).toContain('usage')
    expect(filterSlashCommands('cost').map((c) => c.id)).toContain('usage')
  })

  it('no longer offers the retired Run-panel command', () => {
    // The Activity drawer was removed; tool calls + approvals render inline in
    // the chat stream, so there is no live-run drawer to toggle.
    expect(SLASH_COMMANDS.some((c) => c.command === '/run')).toBe(false)
    expect(filterSlashCommands('run')).toHaveLength(0)
  })
})

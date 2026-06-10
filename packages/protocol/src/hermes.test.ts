import { describe, it, expect } from 'vitest'
import {
  SessionSourceEnum,
  SessionEndReasonEnum,
  PlatformEnum,
  SessionSourceLoose,
  SessionEndReasonLoose,
  PlatformLoose,
} from './hermes'

/**
 * These tests lock each enum to the EXACT membership count transcribed from
 * stock hermes v0.15.2 source plus one representative value. If stock adds or
 * drops a value and someone edits the enum without updating the count, this
 * fails — the deliberate friction that keeps the vocabulary from drifting away
 * from stock hermes-agent source.
 */

describe('SessionSourceEnum (hermes_state.py:227 source column / :801 create_session)', () => {
  it('pins the 6 production process-origin source tags', () => {
    expect(SessionSourceEnum.options).toHaveLength(6)
  })

  it('includes the representative `cli` origin', () => {
    expect(SessionSourceEnum.options).toContain('cli')
    expect(() => SessionSourceEnum.parse('cli')).not.toThrow()
  })

  it('rejects a value outside the pinned set', () => {
    // `telegram` is a PLATFORM source (covered by PlatformEnum), not a
    // process-origin tag — strict source enum rejects it on purpose.
    expect(() => SessionSourceEnum.parse('telegram')).toThrow()
  })
})

describe('SessionEndReasonEnum (hermes_state.py:235 end_reason column / :805-819 end_session)', () => {
  it('pins the 10 production end reasons (test-only fixtures excluded)', () => {
    expect(SessionEndReasonEnum.options).toHaveLength(10)
  })

  it('includes the representative `compression` reason', () => {
    expect(SessionEndReasonEnum.options).toContain('compression')
    expect(() => SessionEndReasonEnum.parse('compression')).not.toThrow()
  })

  it('excludes test-only fixtures that never ship', () => {
    for (const fixture of ['compressed', 'done', 'timeout', 'tui_close', 'user_exit']) {
      expect(SessionEndReasonEnum.options).not.toContain(fixture)
    }
  })
})

describe('PlatformEnum (gateway/config.py:100-129 Platform enum)', () => {
  it('pins the 22 built-in platforms', () => {
    expect(PlatformEnum.options).toHaveLength(22)
  })

  it('spans the source-ordered range local..yuanbao', () => {
    expect(PlatformEnum.options[0]).toBe('local')
    expect(PlatformEnum.options.at(-1)).toBe('yuanbao')
  })

  it('includes the representative `telegram` platform', () => {
    expect(() => PlatformEnum.parse('telegram')).not.toThrow()
  })
})

describe('wire-tolerant loose variants accept unknown stock/plugin values', () => {
  it('SessionSourceLoose accepts a platform-name source and a future tag', () => {
    expect(() => SessionSourceLoose.parse('telegram')).not.toThrow()
    expect(() => SessionSourceLoose.parse('some_future_origin')).not.toThrow()
  })

  it('SessionEndReasonLoose accepts an unrecognised reason', () => {
    expect(() => SessionEndReasonLoose.parse('some_future_reason')).not.toThrow()
  })

  it('PlatformLoose accepts a plugin-adapter platform (Platform._missing_)', () => {
    expect(() => PlatformLoose.parse('irc')).not.toThrow()
  })
})

import { describe, it, expect } from 'vitest'
import { AgentDeckLogs, AgentDeckLogEntry, LogFile, LogLevel, LOG_LEVEL_FILTERS } from './logs'

describe('AgentDeckLogs DTO', () => {
  it('parses a structured logs page', () => {
    const parsed = AgentDeckLogs.parse({
      file: 'agent',
      truncated: true,
      entries: [
        {
          id: 0,
          timestamp: '2026-05-30 22:35:00,123',
          level: 'INFO',
          logger: 'hermes.gateway',
          message: 'started',
          raw: '2026-05-30 22:35:00,123 INFO hermes.gateway started',
        },
        {
          id: 1,
          timestamp: null,
          level: 'unknown',
          logger: null,
          message: '  File "x.py", line 12',
          raw: '  File "x.py", line 12',
        },
      ],
    })
    expect(parsed.file).toBe('agent')
    expect(parsed.truncated).toBe(true)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[1]!.level).toBe('unknown')
  })

  it('constrains file to the known set', () => {
    expect(LogFile.options).toEqual(['agent', 'errors', 'gateway'])
    expect(() => LogFile.parse('secrets')).toThrow()
  })

  it('constrains level to the known set incl. the synthetic unknown', () => {
    expect(LogLevel.options).toEqual(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'unknown'])
    expect(() => LogLevel.parse('<script>')).toThrow()
  })

  it('offers DEBUG..CRITICAL as min-level filters (no synthetic unknown)', () => {
    expect(LOG_LEVEL_FILTERS).toEqual(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])
    expect(LOG_LEVEL_FILTERS).not.toContain('unknown')
  })

  it('rejects a negative entry id', () => {
    expect(() =>
      AgentDeckLogEntry.parse({
        id: -1,
        timestamp: null,
        level: 'INFO',
        logger: null,
        message: 'x',
        raw: 'x',
      }),
    ).toThrow()
  })
})

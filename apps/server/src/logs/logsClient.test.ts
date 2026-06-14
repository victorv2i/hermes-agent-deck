import { describe, it, expect } from 'vitest'
import { LogsClient, parseLogLine, type LogsDashboard } from './logsClient'

/** A tiny stub dashboard that records the path it was asked for and returns a
 * canned `{ file, lines }` body — the shape the real `GET /api/logs` returns. */
function stubDashboard(body: unknown): LogsDashboard & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getJson<T>(path: string): Promise<T> {
      calls.push(path)
      return body as T
    },
  }
}

const LINES = [
  '2026-05-30 22:35:00,123 INFO hermes.gateway: started on :8643',
  '2026-05-30 22:35:01,002 WARNING hermes.cron token nearing expiry',
  '2026-05-30 22:35:02,500 ERROR hermes.agent failed to dispatch',
  'Traceback (most recent call last):',
]

describe('parseLogLine', () => {
  it('extracts timestamp, level, logger, and stripped message', () => {
    const e = parseLogLine(LINES[0]!, 0)
    expect(e.id).toBe(0)
    expect(e.timestamp).toBe('2026-05-30 22:35:00,123')
    expect(e.level).toBe('INFO')
    expect(e.logger).toBe('hermes.gateway')
    expect(e.message).toBe('started on :8643')
    expect(e.raw).toBe(LINES[0])
  })

  it('handles a WARNING line and trims a trailing-colon logger', () => {
    const e = parseLogLine(LINES[1]!, 7)
    expect(e.id).toBe(7)
    expect(e.level).toBe('WARNING')
    expect(e.logger).toBe('hermes.cron')
    expect(e.message).toBe('token nearing expiry')
  })

  it('classifies a continuation/traceback line as unknown with the full raw text', () => {
    const e = parseLogLine(LINES[3]!, 3)
    expect(e.level).toBe('unknown')
    expect(e.timestamp).toBeNull()
    expect(e.logger).toBeNull()
    // No prefix to strip → message is the full line.
    expect(e.message).toBe('Traceback (most recent call last):')
  })

  it('never produces a level outside the known set (defends the DTO)', () => {
    const e = parseLogLine('2026-05-30 22:35:00 NOTICE weird.level something', 0)
    // NOTICE is not a python level → unknown, message keeps the whole tail.
    expect(e.level).toBe('unknown')
  })

  it('parses a live dashboard line: trailing newline + [run_id] bracket before the logger', () => {
    // The real GET /api/logs shape (verified live): `<ts> LEVEL [run_x] logger: msg\n`.
    const e = parseLogLine(
      '2026-05-31 18:03:52,502 INFO [run_20dc4223c7634a9383cb4bb037a7e5a5] agent.conversation_loop: conversation turn: model=gpt-5.5\n',
      5,
    )
    expect(e.level).toBe('INFO')
    expect(e.logger).toBe('agent.conversation_loop')
    expect(e.message).toBe('conversation turn: model=gpt-5.5')
    // the dangling newline is stripped from raw, not surfaced to the UI
    expect(e.raw.endsWith('\n')).toBe(false)
  })

  it('parses a line whose run-id was scrubbed to a nested [[redacted]] bracket (the errors file)', () => {
    // The `errors` file is exactly what a user opens when something breaks; its
    // run-id prefix is rewritten by the secret scrubber to [[redacted]] (a bracket
    // INSIDE a bracket). The skip must still strip it so the logger + message land
    // in the right columns instead of the run-id leaking into the message.
    const e = parseLogLine(
      '2026-06-13 09:41:26,909 ERROR [[redacted]] agent.conversation_loop: API call failed after retries\n',
      9,
    )
    expect(e.level).toBe('ERROR')
    expect(e.logger).toBe('agent.conversation_loop')
    expect(e.message).toBe('API call failed after retries')
  })
})

describe('LogsClient.getLogs', () => {
  it('requests the gated /api/logs with file + lines and parses the body', async () => {
    const dash = stubDashboard({ file: 'agent', lines: LINES })
    const client = new LogsClient(dash)

    const result = await client.getLogs({ file: 'agent', lines: 100 })

    expect(dash.calls[0]).toBe('/api/logs?file=agent&lines=100')
    expect(result.file).toBe('agent')
    expect(result.entries).toHaveLength(4)
    expect(result.entries[0]!.level).toBe('INFO')
    expect(result.entries[2]!.level).toBe('ERROR')
  })

  it('passes level and search through as query params (url-encoded)', async () => {
    const dash = stubDashboard({ file: 'gateway', lines: [] })
    const client = new LogsClient(dash)

    await client.getLogs({ file: 'gateway', lines: 50, level: 'WARNING', search: 'a b&c' })

    expect(dash.calls[0]).toBe('/api/logs?file=gateway&lines=50&level=WARNING&search=a+b%26c')
  })

  it('omits level/search params when not provided or set to ALL', async () => {
    const dash = stubDashboard({ file: 'agent', lines: [] })
    const client = new LogsClient(dash)

    await client.getLogs({ file: 'agent', lines: 100, level: 'ALL' })

    expect(dash.calls[0]).toBe('/api/logs?file=agent&lines=100')
  })

  it('clamps lines into [1, 500] (matching the dashboard cap)', async () => {
    const dash = stubDashboard({ file: 'agent', lines: [] })
    const client = new LogsClient(dash)

    await client.getLogs({ file: 'agent', lines: 99999 })
    expect(dash.calls[0]).toBe('/api/logs?file=agent&lines=500')

    await client.getLogs({ file: 'agent', lines: 0 })
    expect(dash.calls[1]).toBe('/api/logs?file=agent&lines=1')
  })

  it('marks truncated when the returned line count meets the requested cap', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `2026-05-30 22:35:0${i} INFO l m${i}`)
    const dash = stubDashboard({ file: 'agent', lines: many })
    const client = new LogsClient(dash)

    const full = await client.getLogs({ file: 'agent', lines: 10 })
    expect(full.truncated).toBe(true)

    const dash2 = stubDashboard({ file: 'agent', lines: many })
    const partial = await new LogsClient(dash2).getLogs({ file: 'agent', lines: 100 })
    expect(partial.truncated).toBe(false)
  })

  it('echoes the requested file even when the body omits it', async () => {
    const dash = stubDashboard({ lines: [] })
    const client = new LogsClient(dash)
    const result = await client.getLogs({ file: 'errors', lines: 20 })
    expect(result.file).toBe('errors')
    expect(result.entries).toEqual([])
  })

  it('scrubs token-shaped secrets before parsing and returning log lines', async () => {
    const secret = 'Bearer abcdef0123456789abcdef0123456789'
    const dash = stubDashboard({
      file: 'agent',
      lines: [`2026-05-30 22:35:00,123 ERROR hermes.gateway failed auth ${secret}`],
    })
    const client = new LogsClient(dash)

    const result = await client.getLogs({ file: 'agent', lines: 20 })

    expect(result.entries[0]!.message).toContain('[redacted]')
    expect(result.entries[0]!.raw).toContain('[redacted]')
    expect(result.entries[0]!.message).not.toContain(secret)
    expect(result.entries[0]!.raw).not.toContain(secret)
  })

  it('tolerates a non-array lines body (returns no entries)', async () => {
    const dash = stubDashboard({ file: 'agent', lines: null })
    const client = new LogsClient(dash)
    const result = await client.getLogs({ file: 'agent', lines: 20 })
    expect(result.entries).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

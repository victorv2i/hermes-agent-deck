import { describe, it, expect } from 'vitest'
import { buildExport } from './export'
import { parseTranscript } from './import'
import type { SessionDetail, SessionMessage } from './types'

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'sess-1',
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: 'Refactor the parser',
    preview: 'help me',
    started_at: 1,
    last_active: 2,
    message_count: 3,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.01,
    is_active: false,
    ended_at: 3,
    end_reason: 'completed',
    tool_call_count: 1,
    ...over,
  }
}

function msg(over: Partial<SessionMessage> & { id: string; role: string }): SessionMessage {
  return { content: '', timestamp: 1, reasoning: null, tool_name: null, tool_calls: [], ...over }
}

describe('parseTranscript — JSON (round-trips the export)', () => {
  it('round-trips a JSON document produced by buildExport', () => {
    const messages = [
      msg({ id: '1', role: 'user', content: 'hello agent' }),
      msg({
        id: '2',
        role: 'assistant',
        content: 'hi human',
        reasoning: 'plan first',
        tool_calls: ['bash'],
      }),
      msg({ id: '3', role: 'tool', tool_name: 'bash', content: 'ok' }),
    ]
    const { body } = buildExport(detail(), messages, 'json')

    const result = parseTranscript(body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session?.id).toBe('sess-1')
    expect(result.session?.title).toBe('Refactor the parser')
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]).toMatchObject({ id: '1', role: 'user', content: 'hello agent' })
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'hi human',
      reasoning: 'plan first',
      tool_calls: ['bash'],
    })
    expect(result.messages[2]).toMatchObject({ role: 'tool', tool_name: 'bash', content: 'ok' })
  })

  it('accepts a JSON document with a null session', () => {
    const body = JSON.stringify({
      session: null,
      messages: [{ id: '1', role: 'user', content: 'hi' }],
    })
    const result = parseTranscript(body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session).toBeNull()
    expect(result.messages[0]!.content).toBe('hi')
    // Optional message fields default to the canonical empty shape.
    expect(result.messages[0]).toMatchObject({
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    })
  })
})

describe('parseTranscript — Markdown (the role-block export format)', () => {
  it('parses the markdown role-block transcript into messages', () => {
    const messages = [
      msg({ id: '1', role: 'user', content: 'hello agent' }),
      msg({
        id: '2',
        role: 'assistant',
        content: 'hi human',
        reasoning: 'plan first',
        tool_calls: ['bash'],
      }),
      msg({ id: '3', role: 'tool', tool_name: 'bash', content: 'ok' }),
    ]
    const { body } = buildExport(detail(), messages, 'md')

    const result = parseTranscript(body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The markdown carries the title in the session header.
    expect(result.session?.title).toBe('Refactor the parser')
    const roles = result.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool'])
    expect(result.messages[0]!.content).toBe('hello agent')
    const assistant = result.messages[1]!
    expect(assistant.content).toBe('hi human')
    expect(assistant.reasoning).toBe('plan first')
    expect(assistant.tool_calls).toEqual(['bash'])
    expect(result.messages[2]).toMatchObject({ role: 'tool', tool_name: 'bash' })
  })

  it('preserves multi-line reasoning and content in markdown', () => {
    const messages = [
      msg({
        id: '1',
        role: 'assistant',
        content: 'line one\nline two',
        reasoning: 'think a\nthink b',
      }),
    ]
    const { body } = buildExport(detail(), messages, 'md')
    const result = parseTranscript(body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages[0]!.reasoning).toBe('think a\nthink b')
    expect(result.messages[0]!.content).toBe('line one\nline two')
  })

  it('assigns stable synthetic ids when markdown drops them', () => {
    const messages = [
      msg({ id: 'x', role: 'user', content: 'a' }),
      msg({ id: 'y', role: 'assistant', content: 'b' }),
    ]
    const { body } = buildExport(detail(), messages, 'md')
    const result = parseTranscript(body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length) // all unique
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

describe('parseTranscript — calm rejection of malformed input', () => {
  it('rejects empty input', () => {
    const result = parseTranscript('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/empty|paste|file/i)
  })

  it('rejects invalid JSON (looks like JSON but is broken)', () => {
    const result = parseTranscript('{ "session": null, "messages": [ ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(typeof result.error).toBe('string')
  })

  it('rejects JSON whose shape fails validation, without throwing', () => {
    // messages[0].role is required; here it is a number.
    const body = JSON.stringify({ session: null, messages: [{ id: '1', role: 7 }] })
    expect(() => parseTranscript(body)).not.toThrow()
    const result = parseTranscript(body)
    expect(result.ok).toBe(false)
  })

  it('rejects JSON missing the messages array', () => {
    const result = parseTranscript(JSON.stringify({ session: null }))
    expect(result.ok).toBe(false)
  })

  it('rejects unrecognized text (neither JSON nor a role-block transcript)', () => {
    const result = parseTranscript('just some notes\nwith no headings at all')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(typeof result.error).toBe('string')
  })

  it('never throws on adversarial input', () => {
    for (const bad of ['null', '[]', '{}', '"a string"', '42', '##', '# only a title']) {
      expect(() => parseTranscript(bad)).not.toThrow()
    }
  })
})

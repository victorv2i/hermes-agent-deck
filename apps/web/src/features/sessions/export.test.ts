import { describe, it, expect } from 'vitest'
import { buildExport, exportFilename } from './export'
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

describe('exportFilename', () => {
  it('slugifies the title with the format extension', () => {
    expect(exportFilename(detail(), 'md')).toBe('refactor-the-parser.md')
    expect(exportFilename(detail(), 'json')).toBe('refactor-the-parser.json')
  })

  it('falls back to preview, then id, then "session"', () => {
    expect(exportFilename(detail({ title: null, preview: 'My Chat!' }), 'md')).toBe('my-chat.md')
    expect(exportFilename(detail({ title: null, preview: '' }), 'json')).toBe('sess-1.json')
    expect(exportFilename(null, 'md')).toBe('session.md')
  })
})

describe('buildExport (markdown)', () => {
  it('renders a titled, role-labelled transcript', () => {
    const { body, mime } = buildExport(
      detail(),
      [
        msg({ id: '1', role: 'user', content: 'hello agent' }),
        msg({ id: '2', role: 'assistant', content: 'hi human' }),
      ],
      'md',
    )
    expect(mime).toBe('text/markdown')
    expect(body).toContain('# Refactor the parser')
    expect(body).toContain('## User')
    expect(body).toContain('hello agent')
    expect(body).toContain('## Assistant')
    expect(body).toContain('hi human')
  })

  it('includes reasoning and tool calls, drops system rows', () => {
    const { body } = buildExport(
      detail(),
      [
        msg({ id: '0', role: 'system', content: 'you are helpful' }),
        msg({
          id: '1',
          role: 'assistant',
          content: 'done',
          reasoning: 'plan first',
          tool_calls: ['bash'],
        }),
        msg({ id: '2', role: 'tool', tool_name: 'bash', content: 'ok' }),
      ],
      'md',
    )
    expect(body).not.toContain('you are helpful')
    expect(body).toContain('_Thinking:_ plan first')
    expect(body).toContain('tool calls: bash')
    expect(body).toContain('tool result · bash')
  })

  it('includes a model/source meta line', () => {
    const { body } = buildExport(detail(), [msg({ id: '1', role: 'user', content: 'hi' })], 'md')
    expect(body).toContain('anthropic/claude-sonnet-4')
    expect(body).toContain('**Source:** cli')
  })
})

describe('buildExport (markdown header date)', () => {
  it('renders an absolute Date meta bit from started_at', () => {
    // started_at = 1700000000 → 2023-11-14 (UTC). Assert the year/month appear,
    // independent of the host locale's exact day formatting.
    const { body } = buildExport(
      detail({ started_at: 1700000000 }),
      [msg({ id: '1', role: 'user', content: 'hi' })],
      'md',
    )
    expect(body).toContain('**Date:**')
    expect(body).toContain('2023')
  })
})

describe('buildExport (json)', () => {
  it('emits valid JSON carrying the detail + messages', () => {
    const messages = [msg({ id: '1', role: 'user', content: 'hi' })]
    const { body, mime } = buildExport(detail(), messages, 'json')
    expect(mime).toBe('application/json')
    const parsed = JSON.parse(body)
    expect(parsed.session.id).toBe('sess-1')
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].content).toBe('hi')
  })
})

describe('exportFilename (html)', () => {
  it('slugifies the title with the .html extension', () => {
    expect(exportFilename(detail(), 'html')).toBe('refactor-the-parser.html')
  })
})

describe('buildExport (html)', () => {
  it('emits a self-contained HTML document with inline styles', () => {
    const { body, mime } = buildExport(
      detail({ started_at: 1700000000 }),
      [
        msg({ id: '1', role: 'user', content: 'hello agent' }),
        msg({ id: '2', role: 'assistant', content: 'hi human' }),
      ],
      'html',
    )
    expect(mime).toBe('text/html')
    // Self-contained: a full doctype/head + an inline <style>, no external refs.
    expect(body).toMatch(/^<!doctype html>/i)
    expect(body).toContain('<style>')
    expect(body).not.toMatch(/<link[^>]+stylesheet/i)
    expect(body).not.toMatch(/<script/i)
    // Header carries title + model + date.
    expect(body).toContain('Refactor the parser')
    expect(body).toContain('anthropic/claude-sonnet-4')
    expect(body).toContain('2023')
    // Roles and content are legible/labelled.
    expect(body).toContain('hello agent')
    expect(body).toContain('hi human')
    expect(body.toLowerCase()).toContain('user')
    expect(body.toLowerCase()).toContain('assistant')
  })

  it('renders reasoning + tool blocks and drops system rows', () => {
    const { body } = buildExport(
      detail(),
      [
        msg({ id: '0', role: 'system', content: 'you are helpful' }),
        msg({
          id: '1',
          role: 'assistant',
          content: 'done',
          reasoning: 'plan first',
          tool_calls: ['bash'],
        }),
        msg({ id: '2', role: 'tool', tool_name: 'bash', content: 'ok' }),
      ],
      'html',
    )
    expect(body).not.toContain('you are helpful')
    expect(body).toContain('plan first')
    expect(body).toContain('bash')
    expect(body).toContain('ok')
  })

  it('escapes HTML-special characters in content (no injection)', () => {
    const { body } = buildExport(
      detail({ title: 'A <b> & "quote"' }),
      [msg({ id: '1', role: 'user', content: '<script>alert(1)</script> & <b>x</b>' })],
      'html',
    )
    // The raw payload must be entity-escaped, not present as live markup.
    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).toContain('&amp;')
    // The title is escaped too.
    expect(body).toContain('A &lt;b&gt; &amp; &quot;quote&quot;')
  })
})

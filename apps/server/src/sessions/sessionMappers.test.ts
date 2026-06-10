import { describe, it, expect } from 'vitest'
import {
  mapSessionSummary,
  mapSessionDetail,
  mapSessionMessage,
  mapSearchResult,
} from './sessionMappers'

describe('mapSessionSummary', () => {
  it('maps a rich dashboard session row into the SessionSummary shape', () => {
    const summary = mapSessionSummary({
      id: 'sess-abc',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      preview: 'help me refactor the parser please',
      started_at: 1_716_900_000,
      last_active: 1_716_900_900,
      ended_at: null,
      message_count: 12,
      input_tokens: 3400,
      output_tokens: 1200,
      estimated_cost_usd: 0.042,
      is_active: true,
      status: 'completed',
      end_reason: 'completed',
      handoff_state: 'none',
    })

    expect(summary).toEqual({
      id: 'sess-abc',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      preview: 'help me refactor the parser please',
      started_at: 1_716_900_000,
      last_active: 1_716_900_900,
      message_count: 12,
      input_tokens: 3400,
      output_tokens: 1200,
      total_tokens: 4600,
      cost_usd: 0.042,
      is_active: true,
      status: 'completed',
      end_reason: 'completed',
      handoff_state: 'none',
    })
  })

  it('falls back last_active to started_at and tolerates null/absent numeric fields', () => {
    const summary = mapSessionSummary({
      id: 'sess-min',
      source: 'telegram',
      model: null,
      title: null,
      started_at: 1_716_000_000,
      last_active: null,
      message_count: 0,
    })

    expect(summary.last_active).toBe(1_716_000_000)
    expect(summary.model).toBeNull()
    expect(summary.title).toBeNull()
    expect(summary.preview).toBe('')
    expect(summary.input_tokens).toBe(0)
    expect(summary.output_tokens).toBe(0)
    expect(summary.total_tokens).toBe(0)
    expect(summary.cost_usd).toBeNull()
    expect(summary.is_active).toBe(false)
    // New nullable fields stay null when the row omits them.
    expect(summary.status).toBeNull()
    expect(summary.end_reason).toBeNull()
    expect(summary.handoff_state).toBeNull()
  })

  it('throws on a payload that is not a session object', () => {
    expect(() => mapSessionSummary(null)).toThrow()
    expect(() => mapSessionSummary({ source: 'cli' })).toThrow()
  })
})

describe('mapSessionDetail', () => {
  it('maps a full session row, surfacing token + cost detail', () => {
    const detail = mapSessionDetail({
      id: 'sess-abc',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      started_at: 1_716_900_000,
      ended_at: 1_716_901_000,
      end_reason: 'completed',
      status: 'completed',
      handoff_state: 'none',
      message_count: 12,
      tool_call_count: 3,
      input_tokens: 3400,
      output_tokens: 1200,
      actual_cost_usd: 0.05,
      estimated_cost_usd: 0.042,
    })

    expect(detail.id).toBe('sess-abc')
    expect(detail.model).toBe('anthropic/claude-sonnet-4')
    expect(detail.title).toBe('Refactor the parser')
    expect(detail.ended_at).toBe(1_716_901_000)
    expect(detail.end_reason).toBe('completed')
    expect(detail.tool_call_count).toBe(3)
    expect(detail.total_tokens).toBe(4600)
    // Summary-level fields flow through to the detail shape too.
    expect(detail.status).toBe('completed')
    expect(detail.handoff_state).toBe('none')
    // Prefers actual cost over estimated when present.
    expect(detail.cost_usd).toBe(0.05)
    // last_active falls back to ended_at then started_at when not supplied.
    expect(detail.last_active).toBe(1_716_901_000)
  })
})

describe('mapSessionMessage', () => {
  it('maps a user message', () => {
    const msg = mapSessionMessage({
      id: 7,
      session_id: 'sess-abc',
      role: 'user',
      content: 'hello there',
      timestamp: 1_716_900_001,
    })
    expect(msg).toEqual({
      id: '7',
      role: 'user',
      content: 'hello there',
      timestamp: 1_716_900_001,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    })
  })

  it('maps an assistant message with reasoning + tool calls', () => {
    const msg = mapSessionMessage({
      id: 8,
      session_id: 'sess-abc',
      role: 'assistant',
      content: 'Done.',
      reasoning_content: 'I should read the file first.',
      timestamp: 1_716_900_002,
      tool_calls: [{ function: { name: 'read_file' } }, { name: 'bash' }],
    })
    expect(msg.role).toBe('assistant')
    expect(msg.reasoning).toBe('I should read the file first.')
    expect(msg.tool_calls).toEqual(['read_file', 'bash'])
  })

  it('maps a tool result message, carrying the tool name', () => {
    const msg = mapSessionMessage({
      id: 9,
      session_id: 'sess-abc',
      role: 'tool',
      content: 'file contents…',
      tool_name: 'read_file',
      timestamp: 1_716_900_003,
    })
    expect(msg.role).toBe('tool')
    expect(msg.tool_name).toBe('read_file')
  })

  it('coalesces empty/missing content to an empty string and tolerates missing reasoning', () => {
    const msg = mapSessionMessage({
      id: 10,
      session_id: 'sess-abc',
      role: 'assistant',
      content: null,
      timestamp: 1_716_900_004,
    })
    expect(msg.content).toBe('')
    expect(msg.reasoning).toBeNull()
  })
})

describe('mapSearchResult', () => {
  it('maps a dashboard search result into the wire shape', () => {
    const r = mapSearchResult({
      session_id: 'sess-xyz',
      snippet: 'matched <b>docker</b> here',
      role: 'user',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      session_started: 1_716_000_000,
    })
    expect(r).toEqual({
      id: 'sess-xyz',
      snippet: 'matched <b>docker</b> here',
      role: 'user',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      started_at: 1_716_000_000,
    })
  })
})

import { describe, it, expect } from 'vitest'
import { transcriptToTurns } from './transcript'
import type { SessionMessage } from './types'

function m(over: Partial<SessionMessage> & { id: string; role: string }): SessionMessage {
  return {
    content: '',
    timestamp: 1,
    reasoning: null,
    tool_name: null,
    tool_calls: [],
    ...over,
  }
}

describe('transcriptToTurns', () => {
  it('maps user + assistant rows to turns', () => {
    const turns = transcriptToTurns([
      m({ id: '1', role: 'user', content: 'hi' }),
      m({ id: '2', role: 'assistant', content: 'hello there' }),
    ])
    expect(turns).toEqual([
      // The fixture's unix-seconds timestamp (1) lifts to createdAt in ms.
      { id: 'h-1', role: 'user', content: 'hi', createdAt: 1000 },
      {
        id: 'h-2',
        role: 'assistant',
        content: 'hello there',
        toolCalls: [],
        reasoning: [],
        streaming: false,
        createdAt: 1000,
      },
    ])
  })

  it('omits createdAt when the persisted message has no timestamp', () => {
    const turns = transcriptToTurns([m({ id: '1', role: 'user', content: 'hi', timestamp: null })])
    expect(turns).toEqual([{ id: 'h-1', role: 'user', content: 'hi' }])
  })

  it('carries assistant reasoning into the turn', () => {
    const [turn] = transcriptToTurns([
      m({ id: '1', role: 'assistant', content: 'done', reasoning: 'think first' }),
    ])
    expect(turn).toMatchObject({ role: 'assistant', reasoning: ['think first'] })
  })

  it('renders assistant tool calls as completed tool cards', () => {
    const [turn] = transcriptToTurns([
      m({ id: '1', role: 'assistant', content: '', tool_calls: ['read_file', 'bash'] }),
    ])
    expect(turn).toMatchObject({
      role: 'assistant',
      toolCalls: [
        { tool: 'read_file', status: 'completed' },
        { tool: 'bash', status: 'completed' },
      ],
    })
  })

  it('attaches a tool result row to the preceding assistant turn as a preview', () => {
    const turns = transcriptToTurns([
      m({ id: '1', role: 'assistant', content: '', tool_calls: ['read_file'] }),
      m({ id: '2', role: 'tool', tool_name: 'read_file', content: 'file body line one\nline two' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [
        { tool: 'read_file', status: 'completed', preview: 'file body line one line two' },
      ],
    })
  })

  it('drops system rows and blank rows', () => {
    const turns = transcriptToTurns([
      m({ id: '1', role: 'system', content: 'you are helpful' }),
      m({ id: '2', role: 'assistant', content: '' }),
      m({ id: '3', role: 'user', content: '  ' }),
      m({ id: '4', role: 'user', content: 'real' }),
    ])
    expect(turns).toEqual([{ id: 'h-4', role: 'user', content: 'real', createdAt: 1000 }])
  })

  it('surfaces an orphan tool result on its own assistant turn', () => {
    const turns = transcriptToTurns([
      m({ id: '1', role: 'tool', tool_name: 'bash', content: 'oops' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ tool: 'bash', status: 'completed', preview: 'oops' }],
    })
  })
})

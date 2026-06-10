import { describe, it, expect } from 'vitest'
import {
  ChatServerEvent,
  RunCommand,
  RunAttachment,
  ResumeCommand,
  AbortCommand,
  ApprovalRespondCommand,
  APPROVAL_CHOICES,
} from './chat-events'

describe('ChatServerEvent — accepts valid live-shaped events', () => {
  it('accepts message.delta (raw gateway frame: run_id + timestamp, no session_id)', () => {
    const parsed = ChatServerEvent.parse({
      event: 'message.delta',
      run_id: 'run_abc',
      timestamp: 1780073401.13,
      delta: 'pong',
    })
    expect(parsed.event).toBe('message.delta')
  })

  it('accepts reasoning.available', () => {
    const parsed = ChatServerEvent.parse({
      event: 'reasoning.available',
      run_id: 'run_abc',
      text: 'thinking...',
    })
    expect(parsed.event).toBe('reasoning.available')
  })

  it('accepts run.completed with the confirmed usage shape', () => {
    const parsed = ChatServerEvent.parse({
      event: 'run.completed',
      run_id: 'run_abc',
      output: 'pong',
      usage: { input_tokens: 18866, output_tokens: 5, total_tokens: 18871 },
    })
    if (parsed.event === 'run.completed') {
      expect(parsed.usage?.total_tokens).toBe(18871)
    }
  })

  it('accepts tool.started and tool.completed', () => {
    expect(
      ChatServerEvent.parse({ event: 'tool.started', run_id: 'r', tool: 'bash', preview: 'ls' })
        .event,
    ).toBe('tool.started')
    expect(
      ChatServerEvent.parse({
        event: 'tool.completed',
        run_id: 'r',
        tool: 'bash',
        duration: 0.42,
        error: false,
      }).event,
    ).toBe('tool.completed')
  })

  it('accepts approval.request with the four live choices + command/description', () => {
    const parsed = ChatServerEvent.parse({
      event: 'approval.request',
      run_id: 'run_abc',
      command: 'rm -rf /tmp/x',
      description: 'delete a temp dir',
      pattern_key: 'rm',
      pattern_keys: ['rm', 'rm -rf'],
      choices: ['once', 'session', 'always', 'deny'],
    })
    if (parsed.event === 'approval.request') {
      expect(parsed.choices).toEqual([...APPROVAL_CHOICES])
    }
  })

  it('accepts approval.responded', () => {
    expect(
      ChatServerEvent.parse({
        event: 'approval.responded',
        run_id: 'r',
        choice: 'once',
        resolved: 1,
      }).event,
    ).toBe('approval.responded')
  })

  it('accepts run.failed / run.cancelled', () => {
    expect(ChatServerEvent.parse({ event: 'run.failed', run_id: 'r', error: 'boom' }).event).toBe(
      'run.failed',
    )
    expect(ChatServerEvent.parse({ event: 'run.cancelled', run_id: 'r' }).event).toBe(
      'run.cancelled',
    )
  })

  it('accepts BFF-synthesized run.started / message.started / run.stopping', () => {
    expect(
      ChatServerEvent.parse({ event: 'run.started', run_id: 'r', model: 'm', input: 'hi' }).event,
    ).toBe('run.started')
    expect(
      ChatServerEvent.parse({ event: 'message.started', run_id: 'r', role: 'assistant' }).event,
    ).toBe('message.started')
    expect(ChatServerEvent.parse({ event: 'run.stopping', run_id: 'r' }).event).toBe('run.stopping')
  })

  it('accepts BFF-synthesized run.heartbeat (transient liveness, no cursor required)', () => {
    expect(ChatServerEvent.parse({ event: 'run.heartbeat', run_id: 'r' }).event).toBe(
      'run.heartbeat',
    )
    // session_id may ride along when the BFF knows it (same envelope as the rest).
    const withSession = ChatServerEvent.parse({
      event: 'run.heartbeat',
      run_id: 'r',
      session_id: 's1',
    })
    if (withSession.event === 'run.heartbeat') expect(withSession.session_id).toBe('s1')
  })

  it('accepts BFF-added cursor + session_id alongside a gateway frame', () => {
    const parsed = ChatServerEvent.parse({
      event: 'message.delta',
      run_id: 'run_abc',
      session_id: 's1',
      cursor: 7,
      delta: 'x',
    })
    if (parsed.event === 'message.delta') {
      expect(parsed.cursor).toBe(7)
      expect(parsed.session_id).toBe('s1')
    }
  })
})

describe('ChatServerEvent — rejects invalid events', () => {
  it('rejects an unknown event type', () => {
    expect(() => ChatServerEvent.parse({ event: 'nope', run_id: 'r' })).toThrow()
  })

  it('rejects message.delta missing run_id', () => {
    expect(() => ChatServerEvent.parse({ event: 'message.delta', delta: 'x' })).toThrow()
  })

  it('rejects message.delta missing its delta payload', () => {
    expect(() => ChatServerEvent.parse({ event: 'message.delta', run_id: 'r' })).toThrow()
  })

  it('rejects approval.request with an out-of-vocabulary choice', () => {
    expect(() =>
      ChatServerEvent.parse({
        event: 'approval.request',
        run_id: 'r',
        command: 'c',
        description: 'd',
        choices: ['maybe'],
      }),
    ).toThrow()
  })

  it('rejects run.completed with a malformed usage object', () => {
    expect(() =>
      ChatServerEvent.parse({
        event: 'run.completed',
        run_id: 'r',
        usage: { input_tokens: 1 },
      }),
    ).toThrow()
  })
})

describe('client → BFF commands', () => {
  it('RunCommand accepts input-only and full shape', () => {
    expect(RunCommand.parse({ input: 'hi' }).input).toBe('hi')
    expect(RunCommand.parse({ input: 'hi', model: 'm', session_id: 's1' }).session_id).toBe('s1')
  })

  it('RunCommand rejects a missing input', () => {
    expect(() => RunCommand.parse({ model: 'm' })).toThrow()
  })

  it('RunCommand accepts optional image attachments (data-URL parts)', () => {
    const cmd = RunCommand.parse({
      input: 'what is this?',
      attachments: [
        {
          kind: 'image',
          name: 'shot.png',
          mime: 'image/png',
          data_url: 'data:image/png;base64,AAAA',
        },
      ],
    })
    expect(cmd.attachments).toHaveLength(1)
    expect(cmd.attachments?.[0]?.kind).toBe('image')
    expect(cmd.attachments?.[0]?.data_url).toBe('data:image/png;base64,AAAA')
  })

  it('RunCommand omits attachments when none are present (input-only stays clean)', () => {
    expect(RunCommand.parse({ input: 'hi' }).attachments).toBeUndefined()
  })

  it('RunAttachment requires an image data-URL and rejects an http(s) url', () => {
    expect(() =>
      RunAttachment.parse({
        kind: 'image',
        name: 'x.png',
        mime: 'image/png',
        data_url: 'https://example.com/x.png',
      }),
    ).toThrow()
  })

  it('RunAttachment rejects a non-image kind (the gateway only accepts images)', () => {
    expect(() =>
      RunAttachment.parse({
        kind: 'file',
        name: 'doc.pdf',
        mime: 'application/pdf',
        data_url: 'data:application/pdf;base64,AAAA',
      }),
    ).toThrow()
  })

  it('RunAttachment rejects SVG data URLs (XSS vector)', () => {
    // SVG is an XSS vector (can embed scripts): reject image/svg+xml even though
    // it starts with `data:image/`.
    expect(() =>
      RunAttachment.parse({
        kind: 'image',
        name: 'evil.svg',
        mime: 'image/svg+xml',
        data_url: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    ).toThrow()
  })

  it('RunAttachment allows safe raster types (png, jpeg, gif, webp)', () => {
    for (const [mime, ext] of [
      ['image/png', 'img.png'],
      ['image/jpeg', 'img.jpg'],
      ['image/gif', 'img.gif'],
      ['image/webp', 'img.webp'],
    ]) {
      expect(() =>
        RunAttachment.parse({
          kind: 'image',
          name: ext,
          mime,
          data_url: `data:${mime};base64,AAAA`,
        }),
      ).not.toThrow()
    }
  })

  it('ResumeCommand accepts run_id + optional after_cursor', () => {
    expect(ResumeCommand.parse({ run_id: 'r', after_cursor: 12 }).after_cursor).toBe(12)
    expect(ResumeCommand.parse({ run_id: 'r' }).run_id).toBe('r')
  })

  it('AbortCommand requires run_id', () => {
    expect(AbortCommand.parse({ run_id: 'r' }).run_id).toBe('r')
    expect(() => AbortCommand.parse({})).toThrow()
  })

  it('ApprovalRespondCommand accepts a valid choice and rejects an invalid one', () => {
    expect(
      ApprovalRespondCommand.parse({ run_id: 'r', approval_id: 'a1', choice: 'session' }).choice,
    ).toBe('session')
    expect(() => ApprovalRespondCommand.parse({ run_id: 'r', choice: 'approve' })).toThrow()
  })
})

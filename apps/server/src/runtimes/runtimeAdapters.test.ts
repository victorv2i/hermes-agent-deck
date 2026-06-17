import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listClaudeSessions, listCodexSessions, READ_ONLY_CAPABILITIES } from './runtimeAdapters'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-deck-runtimes-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function seedClaude(projectDir: string, file: string, lines: object[], mtimeMs = 0): void {
  const dir = join(home, '.claude', 'projects', projectDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000)
}

function seedCodex(datePath: string, file: string, lines: object[], mtimeMs = 0): void {
  const dir = join(home, '.codex', 'sessions', datePath)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000)
}

describe('read-only capabilities', () => {
  it('reports sessions+usage, never chat/approvals', () => {
    expect(READ_ONLY_CAPABILITIES).toEqual({
      chat: false,
      approvals: false,
      usage: true,
      sessions: true,
    })
  })
})

describe('listClaudeSessions', () => {
  it('returns [] when there are no transcripts', () => {
    expect(listClaudeSessions({ home })).toEqual([])
  })

  it('summarizes a session: id, cwd, title, model, tokens, message count', () => {
    seedClaude('-home-u-app', 'sess-1.jsonl', [
      {
        type: 'user',
        sessionId: 'sess-1',
        cwd: '/home/u/app',
        timestamp: '2026-06-17T10:00:00Z',
        message: { content: 'Fix the build' },
      },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-06-17T10:00:01Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 20 },
          content: [],
        },
      },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-06-17T10:00:02Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 50, output_tokens: 10 },
          content: [],
        },
      },
    ])
    const [s] = listClaudeSessions({ home })
    expect(s).toMatchObject({
      runtime: 'claude',
      id: 'sess-1',
      cwd: '/home/u/app',
      title: 'Fix the build',
      model: 'claude-sonnet-4-6',
      messageCount: 3,
      inputTokens: 150, // summed across assistant turns
      outputTokens: 30,
    })
    expect(s!.startedAt).toBe(Date.parse('2026-06-17T10:00:00Z'))
  })

  it('strips a slash-command wrapper from the title', () => {
    seedClaude('-p', 's.jsonl', [
      {
        type: 'user',
        sessionId: 's',
        timestamp: '2026-06-17T10:00:00Z',
        message: { content: '<command-name>/goal</command-name> ship it' },
      },
    ])
    const [s] = listClaudeSessions({ home })
    expect(s!.title).toBe('ship it')
  })

  it('orders newest-active first and honors the limit', () => {
    seedClaude(
      '-a',
      'old.jsonl',
      [{ type: 'user', sessionId: 'old', message: { content: 'a' } }],
      1_000,
    )
    seedClaude(
      '-b',
      'new.jsonl',
      [{ type: 'user', sessionId: 'new', message: { content: 'b' } }],
      9_000,
    )
    const all = listClaudeSessions({ home })
    expect(all.map((s) => s.id)).toEqual(['new', 'old'])
    expect(listClaudeSessions({ home, limit: 1 }).map((s) => s.id)).toEqual(['new'])
  })
})

describe('listCodexSessions', () => {
  it('summarizes a Codex rollout: id, cwd, tokens (max), message count', () => {
    seedCodex('2026/06/17', 'rollout-2026-06-17T10-00-00-x.jsonl', [
      {
        timestamp: '2026-06-17T10:00:00Z',
        type: 'session_meta',
        payload: { id: 'cdx-1', cwd: '/home/u/app', model_provider: 'openai' },
      },
      {
        timestamp: '2026-06-17T10:00:01Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Refactor' }],
        },
      },
      {
        timestamp: '2026-06-17T10:00:02Z',
        type: 'event_msg',
        payload: { type: 'token_count', input_tokens: 500, output_tokens: 80 },
      },
      {
        timestamp: '2026-06-17T10:00:03Z',
        type: 'event_msg',
        payload: { type: 'token_count', input_tokens: 1200, output_tokens: 200 },
      },
    ])
    const [s] = listCodexSessions({ home })
    expect(s).toMatchObject({
      runtime: 'codex',
      id: 'cdx-1',
      cwd: '/home/u/app',
      model: 'openai',
      title: 'Refactor',
      messageCount: 1,
      inputTokens: 1200, // cumulative max
      outputTokens: 200,
    })
  })

  it('returns [] when there are no rollouts', () => {
    expect(listCodexSessions({ home })).toEqual([])
  })
})

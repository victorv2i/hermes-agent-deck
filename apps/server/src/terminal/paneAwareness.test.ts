import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encodeClaudeProjectDir,
  readClaudePaneState,
  readCodexPaneState,
  readPaneState,
} from './paneAwareness'

let home: string
const CWD = '/home/u/Projects/app'

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-deck-pane-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Write a Claude Code transcript for CWD with the given JSONL lines, and stamp
 * its mtime so freshness is deterministic (relative to the test clock at 0). */
function seedTranscript(name: string, lines: object[], mtimeMs = 0): string {
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(CWD))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const seconds = mtimeMs / 1000
  utimesSync(path, seconds, seconds)
  return path
}

describe('encodeClaudeProjectDir', () => {
  it('replaces / and . with - (single segment, no traversal)', () => {
    expect(encodeClaudeProjectDir('/home/u/Projects/app')).toBe('-home-u-Projects-app')
    expect(encodeClaudeProjectDir('/home/u/.hermes')).toBe('-home-u--hermes')
    // A hostile cwd cannot produce a path separator after encoding.
    expect(encodeClaudeProjectDir('../../etc')).not.toContain('/')
  })
})

describe('readClaudePaneState', () => {
  it('returns unknown when no transcript dir exists', () => {
    const state = readClaudePaneState(CWD, { home, now: () => 0 })
    expect(state).toEqual({
      cli: 'claude',
      runState: 'unknown',
      activeFile: null,
      lastTool: null,
      sessionId: null,
      updatedAt: null,
    })
  })

  it('surfaces the last tool, active file, session id, and a working state when fresh', () => {
    seedTranscript(
      'sess-1.jsonl',
      [
        { type: 'user', sessionId: 'sess-1', timestamp: '2026-06-17T10:00:00Z' },
        {
          type: 'assistant',
          sessionId: 'sess-1',
          timestamp: '2026-06-17T10:00:01Z',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/x.ts' } }],
          },
        },
        {
          type: 'assistant',
          sessionId: 'sess-1',
          timestamp: '2026-06-17T10:00:02Z',
          message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
        },
      ],
      10_000,
    )
    // Clock 5s after the transcript mtime → within the 12s freshness window.
    const state = readClaudePaneState(CWD, { home, now: () => 15_000 })
    expect(state.runState).toBe('working')
    expect(state.lastTool).toBe('Bash') // most recent tool wins
    expect(state.activeFile).toBe('/a/x.ts') // last file-touching tool
    expect(state.sessionId).toBe('sess-1')
    expect(state.updatedAt).toBe('2026-06-17T10:00:02Z')
  })

  it('reports idle when the transcript has been quiet past the freshness window', () => {
    seedTranscript(
      'sess-1.jsonl',
      [
        {
          type: 'assistant',
          sessionId: 'sess-1',
          message: {
            content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/y.ts' } }],
          },
        },
      ],
      10_000,
    )
    // Clock 30s after mtime → past the 12s window.
    const state = readClaudePaneState(CWD, { home, now: () => 40_000 })
    expect(state.runState).toBe('idle')
    expect(state.lastTool).toBe('Edit')
    expect(state.activeFile).toBe('/a/y.ts')
  })

  it('picks the NEWEST transcript when a cwd has several sessions', () => {
    seedTranscript(
      'old.jsonl',
      [
        {
          type: 'assistant',
          sessionId: 'old',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/old.ts' } }],
          },
        },
      ],
      1_000,
    )
    seedTranscript(
      'new.jsonl',
      [
        {
          type: 'assistant',
          sessionId: 'new',
          message: {
            content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/new.ts' } }],
          },
        },
      ],
      9_000,
    )
    const state = readClaudePaneState(CWD, { home, now: () => 12_000 })
    expect(state.sessionId).toBe('new')
    expect(state.activeFile).toBe('/new.ts')
  })

  it('tolerates malformed JSON lines without throwing', () => {
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(CWD))
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess.jsonl')
    writeFileSync(
      path,
      'not json\n{"type":"assistant","sessionId":"s","message":{"content":[{"type":"tool_use","name":"Bash"}]}}\n',
    )
    utimesSync(path, 5, 5)
    const state = readClaudePaneState(CWD, { home, now: () => 6_000 })
    expect(state.sessionId).toBe('s')
    expect(state.lastTool).toBe('Bash')
  })
})

describe('readPaneState dispatch', () => {
  it('returns unknown for a missing cwd', () => {
    expect(readPaneState('claude', undefined, { home }).runState).toBe('unknown')
  })

  it('returns unknown for a CLI with no transcript reader (shell)', () => {
    expect(readPaneState('shell', CWD, { home }).runState).toBe('unknown')
  })

  it('routes claude to the Claude reader', () => {
    seedTranscript(
      's.jsonl',
      [
        {
          type: 'assistant',
          sessionId: 's',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/z.ts' } }] },
        },
      ],
      8_000,
    )
    const state = readPaneState('claude', CWD, { home, now: () => 10_000 })
    expect(state.cli).toBe('claude')
    expect(state.activeFile).toBe('/z.ts')
  })
})

/** Seed a Codex rollout under sessions/Y/M/D with a session_meta cwd + records. */
function seedCodexRollout(
  datePath: string,
  fileName: string,
  meta: { id: string; cwd: string },
  records: object[],
  mtimeMs = 0,
): string {
  const dir = join(home, '.codex', 'sessions', datePath)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, fileName)
  const lines = [
    { timestamp: '2026-06-17T00:00:00Z', type: 'session_meta', payload: { ...meta } },
    ...records,
  ]
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const seconds = mtimeMs / 1000
  utimesSync(path, seconds, seconds)
  return path
}

describe('readCodexPaneState', () => {
  it('returns unknown when no rollout matches the cwd', () => {
    seedCodexRollout(
      '2026/06/17',
      'rollout-2026-06-17T10-00-00-aaa.jsonl',
      { id: 'aaa', cwd: '/somewhere/else' },
      [],
      8_000,
    )
    expect(readCodexPaneState(CWD, { home, now: () => 10_000 }).runState).toBe('unknown')
  })

  it('matches a rollout by session_meta cwd and surfaces the last tool + file', () => {
    seedCodexRollout(
      '2026/06/17',
      'rollout-2026-06-17T10-00-00-bbb.jsonl',
      { id: 'bbb', cwd: CWD },
      [
        {
          timestamp: '2026-06-17T10:00:01Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'read_file',
            arguments: JSON.stringify({ path: '/a/in.ts' }),
          },
        },
        {
          timestamp: '2026-06-17T10:00:02Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: JSON.stringify({ cmd: 'ls' }),
          },
        },
      ],
      9_000,
    )
    const state = readCodexPaneState(CWD, { home, now: () => 12_000 })
    expect(state.cli).toBe('codex')
    expect(state.runState).toBe('working')
    expect(state.lastTool).toBe('exec_command') // most recent function_call
    expect(state.activeFile).toBe('/a/in.ts') // last tool carrying a path
    expect(state.sessionId).toBe('bbb')
  })

  it('picks the NEWEST matching rollout across days and reports idle when stale', () => {
    seedCodexRollout(
      '2026/06/16',
      'rollout-2026-06-16T10-00-00-old.jsonl',
      { id: 'old', cwd: CWD },
      [
        {
          timestamp: 't',
          type: 'response_item',
          payload: { type: 'function_call', name: 'old_tool', arguments: '{}' },
        },
      ],
      1_000,
    )
    seedCodexRollout(
      '2026/06/17',
      'rollout-2026-06-17T10-00-00-new.jsonl',
      { id: 'new', cwd: CWD },
      [
        {
          timestamp: 't',
          type: 'response_item',
          payload: { type: 'function_call', name: 'new_tool', arguments: '{}' },
        },
      ],
      5_000,
    )
    const state = readCodexPaneState(CWD, { home, now: () => 60_000 })
    expect(state.sessionId).toBe('new') // newest-first wins
    expect(state.lastTool).toBe('new_tool')
    expect(state.runState).toBe('idle') // 55s past the freshness window
  })
})

import { describe, it, expect } from 'vitest'
import { listGitRemotes } from './gitRemotes'
import type { ExecFileLike } from './hermesCli'

/**
 * listGitRemotes is the no-channel signal for the agent-deck self-update card. An
 * empty result (or any git failure) must mean "no channel" — fail closed.
 */
describe('listGitRemotes', () => {
  it('parses one-remote-per-line stdout, trimming blanks', () => {
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      expect(args).toEqual(['-C', '/repo', 'remote'])
      cb(null, 'origin\nupstream\n', '')
      return undefined as never
    }
    return expect(listGitRemotes({ cwd: '/repo', execFile: exec })).resolves.toEqual([
      'origin',
      'upstream',
    ])
  })

  it('returns [] for an empty remote list (a local build → no-channel)', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(null, '\n', '')
      return undefined as never
    }
    await expect(listGitRemotes({ execFile: exec })).resolves.toEqual([])
  })

  it('returns [] when git fails (not a repo / git missing)', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(
        Object.assign(new Error('not a git repo'), { code: 128 }),
        '',
        'fatal: not a git repository',
      )
      return undefined as never
    }
    await expect(listGitRemotes({ execFile: exec })).resolves.toEqual([])
  })

  it('invokes git with argv (no shell)', async () => {
    const seen: Array<Record<string, unknown>> = []
    const exec: ExecFileLike = (file, _args, opts, cb) => {
      expect(file).toBe('git')
      seen.push(opts as Record<string, unknown>)
      cb(null, 'origin\n', '')
      return undefined as never
    }
    await listGitRemotes({ execFile: exec })
    expect(seen[0]!.shell ?? false).toBeFalsy()
  })
})

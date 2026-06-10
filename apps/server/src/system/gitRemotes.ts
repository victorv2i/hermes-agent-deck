/**
 * List the configured git remotes for the agent-deck checkout — the signal the
 * Maintenance dock uses to decide whether a self-update CHANNEL even exists. An
 * empty list (this repo today: zero remotes, a local build) → the self-update
 * card ships HONESTLY DISABLED (`no-channel`), never a fake "update available".
 *
 * Runs `git -C <cwd> remote` via execFile (argv-only, no shell). Any failure
 * (not a git repo, git missing) resolves to `[]` — fail closed to no-channel.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import type { ExecFileLike } from './hermesCli'

export interface ListGitRemotesOptions {
  /** Directory of the agent-deck checkout. Defaults to process.cwd(). */
  cwd?: string
  /** Injectable execFile (tests). Defaults to node's child_process.execFile. */
  execFile?: ExecFileLike
}

/** Resolve the configured git remotes (one per line), or `[]` on any failure. */
export function listGitRemotes(opts: ListGitRemotesOptions = {}): Promise<string[]> {
  const exec = opts.execFile ?? (nodeExecFile as unknown as ExecFileLike)
  const cwd = opts.cwd ?? process.cwd()
  return new Promise<string[]>((resolve) => {
    exec('git', ['-C', cwd, 'remote'], { timeout: 5_000 }, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      resolve(
        (stdout ?? '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      )
    })
  })
}

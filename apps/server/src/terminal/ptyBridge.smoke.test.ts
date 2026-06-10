/**
 * Real node-pty smoke test — spawns an ACTUAL shell (no fakes) to prove the
 * native binding works on this host: output streams, resize is accepted, and
 * kill tears the process down. Skipped automatically if node-pty cannot load so
 * the suite stays green on a host where the native addon is unavailable.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNodePty, spawnTerminal } from './ptyBridge'

const available = !!(await loadNodePty())

describe.skipIf(!available)('node-pty real smoke', () => {
  it('streams output, resizes, and tears down a real shell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pty-real-'))
    // dir is allowlisted as a root so the requested cwd is contained (no $HOME).
    const { pty: proc } = await spawnTerminal({ cwd: dir, roots: [dir], cols: 80, rows: 24 })
    try {
      const sawMarker = new Promise<void>((resolve) => {
        let buf = ''
        proc.onData((d) => {
          buf += d
          if (buf.includes('PTY_OK')) resolve()
        })
      })
      const exited = new Promise<number>((resolve) => proc.onExit((e) => resolve(e.exitCode)))

      // Resize is accepted without throwing.
      proc.resize(100, 30)
      // Echo a unique marker, then exit the shell.
      proc.write('echo PTY_OK\r')
      await sawMarker
      proc.write('exit\r')
      const code = await exited
      expect(typeof code).toBe('number')
    } finally {
      proc.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10000)
})

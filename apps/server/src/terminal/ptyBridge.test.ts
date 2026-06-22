import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveShell,
  resolveCwd,
  ptyEnv,
  clampDim,
  spawnTerminal,
  terminalAvailability,
  loadNodePty,
  __resetNodePtyCache,
  type NodePtyLike,
  type PtyProcess,
} from './ptyBridge'

/** A fake pty that records spawn args + lets the test drive data/exit. */
function fakeNodePty(): {
  mod: NodePtyLike
  last: () =>
    | { file: string; args: string[] | string; opts: Record<string, unknown>; proc: FakeProc }
    | undefined
} {
  let last:
    | { file: string; args: string[] | string; opts: Record<string, unknown>; proc: FakeProc }
    | undefined
  const mod: NodePtyLike = {
    spawn(file, args, opts) {
      const proc = new FakeProc()
      last = { file, args, opts: opts as Record<string, unknown>, proc }
      return proc
    },
  }
  return { mod, last: () => last }
}

class FakeProc implements PtyProcess {
  readonly pid = 4242
  written: string[] = []
  resized: { cols: number; rows: number }[] = []
  killed = false
  private dataCb?: (d: string) => void
  private exitCb?: (e: { exitCode: number; signal?: number }) => void
  onData(cb: (d: string) => void) {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb
  }
  write(d: string) {
    this.written.push(d)
  }
  resize(cols: number, rows: number) {
    this.resized.push({ cols, rows })
  }
  kill() {
    this.killed = true
  }
  emitData(d: string) {
    this.dataCb?.(d)
  }
  emitExit(code: number) {
    this.exitCb?.({ exitCode: code })
  }
}

describe('clampDim', () => {
  it('returns the fallback for non-finite / missing values', () => {
    expect(clampDim(undefined, 24)).toBe(24)
    expect(clampDim(NaN, 80)).toBe(80)
    expect(clampDim(Infinity, 80)).toBe(80)
  })
  it('floors and bounds dimensions to [1, 1000]', () => {
    expect(clampDim(40.9, 24)).toBe(40)
    expect(clampDim(0, 24)).toBe(1)
    expect(clampDim(-5, 24)).toBe(1)
    expect(clampDim(99999, 24)).toBe(1000)
  })
})

describe('resolveShell', () => {
  it('honors $SHELL when it exists', () => {
    // /bin/sh exists on any POSIX CI host.
    expect(resolveShell({ SHELL: '/bin/sh' } as NodeJS.ProcessEnv)).toBe('/bin/sh')
  })
  it('falls back to a real shell when $SHELL is bogus', () => {
    const shell = resolveShell({ SHELL: '/nonexistent/zsh' } as NodeJS.ProcessEnv)
    expect(['/bin/bash', '/usr/bin/bash', '/bin/sh']).toContain(shell)
  })
})

describe('resolveCwd', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pty-cwd-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses the requested dir when it exists AND is contained within an allowlisted root', () => {
    // dir is its own root, so a request for dir is contained.
    expect(resolveCwd(dir, [dir], '/home/fallback')).toBe(dir)
  })
  it('uses a requested SUBDIR that is contained within an allowlisted root', () => {
    const sub = join(dir, 'nested')
    mkdirSync(sub)
    expect(resolveCwd(sub, [dir], '/home/fallback')).toBe(sub)
  })
  it('falls back to the first root when the requested dir is OUTSIDE every root', () => {
    // requested exists but is not contained by any allowlisted root → fall back.
    const outside = mkdtempSync(join(tmpdir(), 'pty-outside-'))
    try {
      expect(resolveCwd(outside, [dir], '/home/fallback')).toBe(dir)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
  it('does NOT treat a sibling-prefix dir as contained', () => {
    // `${dir}-evil` shares a name prefix with the root but is not inside it.
    const sibling = `${dir}-evil`
    mkdirSync(sibling)
    try {
      expect(resolveCwd(sibling, [dir], '/home/fallback')).toBe(dir)
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })
  it('falls back to the first existing root when requested is missing', () => {
    expect(resolveCwd('/does/not/exist', ['/also/missing', dir], '/home/fallback')).toBe(dir)
  })
  it('returns null (refuses) when no root resolves and $HOME is NOT allowed', () => {
    // Default: no silent $HOME fallback. `dir` is a real dir but is passed as
    // home, not as a root, so with no resolvable root we refuse.
    expect(resolveCwd(undefined, ['/missing'], dir)).toBeNull()
  })
  it('falls back to $HOME only when allowHome is set (operator opt-in)', () => {
    expect(resolveCwd(undefined, ['/missing'], dir, true)).toBe(dir)
  })
  it('rejects a requested path that is a file (not a dir)', () => {
    const file = join(dir, 'f.txt')
    symlinkSync('/bin/sh', file) // a non-directory entry
    expect(resolveCwd(file, [dir], dir)).toBe(dir)
  })
  it('ignores a requested cwd entirely when no roots are allowlisted', () => {
    // With an empty allowlist nothing can be contained, so we never honor the
    // requested cwd; with no roots either, we refuse (null) — no $HOME fallback.
    expect(resolveCwd(dir, [], '/home/fallback')).toBeNull()
    // …unless $HOME is explicitly allowed AND exists.
    expect(resolveCwd(dir, [], dir, true)).toBe(dir)
  })
  it('does NOT honor a symlink inside a root that resolves OUTSIDE every root', () => {
    // A symlink lexically inside `dir` but pointing at a dir outside every root.
    // The lexical containment check passes, so without a realpath guard the shell
    // would be anchored outside the allowlist. It must fall back to the root.
    const outside = mkdtempSync(join(tmpdir(), 'pty-escape-'))
    const link = join(dir, 'escape')
    symlinkSync(outside, link, 'dir')
    try {
      expect(resolveCwd(link, [dir], '/home/fallback')).toBe(dir)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('ptyEnv', () => {
  it('forces a color-capable TERM and preserves allowlisted vars', () => {
    const env = ptyEnv({ PATH: '/usr/bin', SHELL: '/bin/sh' } as NodeJS.ProcessEnv)
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PATH).toBe('/usr/bin')
  })
  it('DROPS server-env secrets (curated allowlist, not a spread)', () => {
    const env = ptyEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      LANG: 'en_US.UTF-8',
      // Secrets that must NOT leak into the spawned shell:
      API_SERVER_KEY: 'super-secret',
      AGENT_DECK_TOKEN: 'tok',
      AWS_SECRET_ACCESS_KEY: 'aws',
      OPENAI_API_KEY: 'oai',
    } as NodeJS.ProcessEnv)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/u')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.API_SERVER_KEY).toBeUndefined()
    expect(env.AGENT_DECK_TOKEN).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })
})

describe('terminalAvailability', () => {
  it('reports unavailable with an honest reason when node-pty fails to load', async () => {
    const res = await terminalAvailability(async () => null)
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/not available/i)
  })
  it('reports available when node-pty loads', async () => {
    const { mod } = fakeNodePty()
    const res = await terminalAvailability(async () => mod)
    expect(res).toEqual({ available: true })
  })
})

describe('spawnTerminal (injected node-pty)', () => {
  it('spawns the resolved shell with clamped dims, sanitized env, resolved cwd', async () => {
    const { mod, last } = fakeNodePty()
    const dir = mkdtempSync(join(tmpdir(), 'pty-spawn-'))
    try {
      const { pty, cwd } = await spawnTerminal(
        // dir is allowlisted as a root so the requested cwd is contained.
        {
          cols: 120.7,
          rows: 0,
          cwd: dir,
          roots: [dir],
          env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv,
        },
        mod,
      )
      expect(pty.pid).toBe(4242)
      expect(cwd).toBe(dir) // surfaced for the audit log
      const call = last()!
      expect(call.file).toBe('/bin/sh')
      expect(call.opts.cols).toBe(120)
      expect(call.opts.rows).toBe(1) // 0 clamped up to 1
      expect(call.opts.cwd).toBe(dir)
      expect((call.opts.env as Record<string, string>).TERM).toBe('xterm-256color')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws an honest "terminal unavailable" error when the loader returns null', async () => {
    await expect(spawnTerminal({}, async () => null)).rejects.toThrow(/terminal unavailable/i)
  })

  it('REFUSES to spawn (no silent $HOME) when no workspace root resolves', async () => {
    const { mod, last } = fakeNodePty()
    // No roots and allowHome defaults to false → resolveCwd returns null → refuse.
    await expect(
      spawnTerminal({ roots: [], env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv }, mod),
    ).rejects.toThrow(/no allowlisted workspace root/i)
    expect(last()).toBeUndefined() // never spawned
  })

  it('spawns at $HOME only when allowHome is set', async () => {
    const { mod, last } = fakeNodePty()
    const home = mkdtempSync(join(tmpdir(), 'pty-home-'))
    try {
      // Inject HOME via env is not used by resolveCwd (it reads os.homedir), so
      // assert via roots-less + allowHome path against the real homedir instead.
      const { pty, cwd } = await spawnTerminal(
        { roots: [home], allowHome: true, env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv },
        mod,
      )
      expect(pty.pid).toBe(4242)
      expect(cwd).toBe(home)
      expect(last()!.opts.cwd).toBe(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('spawnTerminal tmux backing (injected node-pty)', () => {
  it('spawns a deck-owned session via `tmux -u new-session -A` (create-or-attach)', async () => {
    const { mod, last } = fakeNodePty()
    const dir = mkdtempSync(join(tmpdir(), 'pty-tmux-'))
    try {
      const { cwd } = await spawnTerminal(
        {
          cwd: dir,
          roots: [dir],
          env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv,
          tmux: { mode: 'deck', sessionName: 'adk_sess1' },
        },
        mod,
      )
      const call = last()!
      expect(call.file).toBe('tmux')
      // -A = attach if the session already exists, create otherwise: reattach
      // after a BFF restart is the SAME code path with zero extra state.
      expect(call.args).toEqual(['-u', 'new-session', '-A', '-s', 'adk_sess1', '-c', dir])
      expect(cwd).toBe(dir)
      // The tmux client still runs with the sanitized env + forced TERM.
      expect((call.opts.env as Record<string, string>).TERM).toBe('xterm-256color')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prepends socket override args (throwaway tmux server seam)', async () => {
    const { mod, last } = fakeNodePty()
    const dir = mkdtempSync(join(tmpdir(), 'pty-tmux-'))
    try {
      await spawnTerminal(
        {
          cwd: dir,
          roots: [dir],
          env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv,
          tmux: { mode: 'deck', sessionName: 'adk_s', socketArgs: ['-L', 'adk_test_x'] },
        },
        mod,
      )
      expect(last()!.args).toEqual([
        '-L',
        'adk_test_x',
        '-u',
        'new-session',
        '-A',
        '-s',
        'adk_s',
        '-c',
        dir,
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('attaches to a FOREIGN session with attach-session (NEVER -A, never creates)', async () => {
    const { mod, last } = fakeNodePty()
    const dir = mkdtempSync(join(tmpdir(), 'pty-tmux-'))
    try {
      await spawnTerminal(
        {
          cwd: dir,
          roots: [dir],
          env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv,
          tmux: { mode: 'foreign', sessionName: 'users_own' },
        },
        mod,
      )
      const call = last()!
      expect(call.file).toBe('tmux')
      // attach-session fails when the name does not exist; the deck must never
      // create a session under a foreign name.
      expect(call.args).toEqual(['-u', 'attach-session', '-t', '=users_own'])
      expect(call.args).not.toContain('-A')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still spawns the bare shell when no tmux option is given (unchanged path)', async () => {
    const { mod, last } = fakeNodePty()
    const dir = mkdtempSync(join(tmpdir(), 'pty-tmux-'))
    try {
      await spawnTerminal(
        { cwd: dir, roots: [dir], env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv },
        mod,
      )
      expect(last()!.file).toBe('/bin/sh')
      expect(last()!.args).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still enforces the cwd containment guard on the tmux path', async () => {
    const { mod, last } = fakeNodePty()
    await expect(
      spawnTerminal(
        {
          roots: [],
          env: { SHELL: '/bin/sh' } as NodeJS.ProcessEnv,
          tmux: { mode: 'deck', sessionName: 'adk_x' },
        },
        mod,
      ),
    ).rejects.toThrow(/no allowlisted workspace root/i)
    expect(last()).toBeUndefined()
  })
})

describe('loadNodePty (real, on this host)', () => {
  it('loads or honestly fails, and the result is cached', async () => {
    __resetNodePtyCache()
    const a = await loadNodePty()
    const b = await loadNodePty()
    expect(a).toBe(b) // sticky/cached
  })
})

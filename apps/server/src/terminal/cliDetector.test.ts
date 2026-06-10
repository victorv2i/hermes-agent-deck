import { describe, it, expect, vi } from 'vitest'
import { detectClis, CLI_PRESETS, type ProbeExec, __resetCliDetectorCache } from './cliDetector'

/**
 * Build a fake interactive-shell probe runner. `resolved` is the set of preset
 * ids the shell `command -v` resolves (e.g. the `claude` shell ALIAS). Anything
 * else exits non-zero (not found), exactly like a real `command -v <missing>`.
 *
 * The runner asserts it is invoked as an INTERACTIVE shell (`-ic`) so the alias
 * case is actually exercised — a bare PATH scan would miss the `claude` alias.
 */
function fakeProbe(resolved: Set<string>): ProbeExec {
  return vi.fn(async (shell: string, args: string[]) => {
    expect(shell).toBeTruthy()
    // Must go through the interactive shell so aliases/functions/shims resolve.
    expect(args[0]).toBe('-ic')
    const script = args[1] ?? ''
    const name = /command -v (\S+)/.exec(script)?.[1]
    if (name && resolved.has(name)) {
      return { stdout: `/resolved/${name}\n`, code: 0 }
    }
    return { stdout: '', code: 1 }
  })
}

describe('detectClis', () => {
  it('reports a CLI resolved by the interactive shell as available (the `claude` ALIAS case)', async () => {
    // `claude` is a shell ALIAS — invisible to a bare PATH/`which` scan, but the
    // interactive-shell probe (`$SHELL -ic 'command -v claude'`) resolves it.
    const probe = fakeProbe(new Set(['claude']))
    const clis = await detectClis({ exec: probe, fresh: true })

    const claude = clis.find((c) => c.id === 'claude')
    expect(claude?.available).toBe(true)
    const hermes = clis.find((c) => c.id === 'hermes')
    expect(hermes?.available).toBe(false)
  })

  it('reports a missing CLI as unavailable WITH an install hint (never assumes present)', async () => {
    const probe = fakeProbe(new Set())
    const clis = await detectClis({ exec: probe, fresh: true })

    const codex = clis.find((c) => c.id === 'codex')
    expect(codex?.available).toBe(false)
    // Honest: a real install URL the UI can link to.
    expect(codex?.installUrl).toMatch(/^https?:\/\//)
  })

  it('always reports the raw shell as available (no probe needed)', async () => {
    const probe = fakeProbe(new Set())
    const clis = await detectClis({ exec: probe, fresh: true })

    const shell = clis.find((c) => c.id === 'shell')
    expect(shell?.available).toBe(true)
  })

  it('fails CLOSED (unavailable) when the probe throws or times out', async () => {
    // A probe that rejects (e.g. spawn failure / timeout) must NOT be read as
    // "available" — unknown resolves to not-available so we never offer to launch
    // a CLI we could not confirm.
    const exec: ProbeExec = vi.fn(async () => {
      throw new Error('spawn $SHELL ETIMEDOUT')
    })
    const clis = await detectClis({ exec, fresh: true })

    for (const id of ['hermes', 'claude', 'codex']) {
      expect(clis.find((c) => c.id === id)?.available).toBe(false)
    }
    // Raw shell stays available even when the probe is dead.
    expect(clis.find((c) => c.id === 'shell')?.available).toBe(true)
  })

  it('caches the probe per process; `fresh` bypasses the cache', async () => {
    const probe = fakeProbe(new Set(['hermes']))
    __resetCliDetectorCache()
    await detectClis({ exec: probe })
    await detectClis({ exec: probe })
    // One probe per detectable preset, run once and cached.
    const detectable = CLI_PRESETS.filter((p) => p.command).length
    expect((probe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(detectable)

    // `fresh` re-probes.
    await detectClis({ exec: probe, fresh: true })
    expect((probe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(detectable * 2)
  })
})

describe('CLI_PRESETS', () => {
  it('lists the four known presets with stable ids', () => {
    const ids = CLI_PRESETS.map((p) => p.id)
    expect(ids).toEqual(['hermes', 'claude', 'codex', 'shell'])
  })

  it('gives every probeable preset a seed command and an install URL', () => {
    for (const p of CLI_PRESETS) {
      if (p.id === 'shell') continue
      expect(p.command).toBeTruthy()
      expect(p.installUrl).toMatch(/^https?:\/\//)
    }
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  tmuxAvailable,
  __resetTmuxAvailableCache,
  deckSessionName,
  DECK_SESSION_PREFIX,
  listTmuxSessions,
  hasTmuxSession,
  killDeckSession,
  capturePane,
} from './tmux'

const run = promisify(execFile)

/** Probe the host directly (outside the module cache under test). */
const hostHasTmux = await run('tmux', ['-V']).then(
  () => true,
  () => false,
)

/**
 * Throwaway tmux server: `-L` names a PRIVATE socket in tmux's tmp dir, so this
 * suite creates/kills sessions on its own server and NEVER touches the user's
 * default tmux server.
 */
const SOCKET_NAME = `adk_test_${process.pid}`
const SOCKET = ['-L', SOCKET_NAME]

/** Run a raw tmux command against the throwaway server (test setup only). */
async function tmuxRaw(args: string[]): Promise<string> {
  const { stdout } = await run('tmux', [...SOCKET, ...args])
  return stdout
}

async function killTestServer(): Promise<void> {
  try {
    await run('tmux', [...SOCKET, 'kill-server'])
  } catch {
    // no server running on the throwaway socket — already clean
  }
  // Remove the throwaway socket file too (tmux leaves it behind in
  // $TMUX_TMPDIR/tmux-$UID, defaulting to /tmp/tmux-$UID).
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (uid !== null) {
    rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${uid}`, SOCKET_NAME), { force: true })
  }
}

describe('deckSessionName', () => {
  it('prefixes adk_ and keeps a safe id verbatim', () => {
    expect(deckSessionName('term-3-ab12cd')).toBe('adk_term-3-ab12cd')
    expect(deckSessionName('term-3-ab12cd').startsWith(DECK_SESSION_PREFIX)).toBe(true)
  })

  it('sanitizes characters tmux targets cannot carry (dots, colons, etc.)', () => {
    // tmux session names must avoid `.` and `:` (target syntax); everything
    // outside [A-Za-z0-9_-] maps to `-` so the name is always a safe -t target.
    expect(deckSessionName('a.b:c d/e')).toBe('adk_a-b-c-d-e')
    expect(deckSessionName('weird$#!id')).toBe('adk_weird---id')
  })

  it('bounds the name length', () => {
    const long = 'x'.repeat(500)
    expect(deckSessionName(long).length).toBeLessThanOrEqual(100)
    expect(deckSessionName(long).startsWith('adk_x')).toBe(true)
  })
})

describe('tmuxAvailable', () => {
  it('returns false when AGENT_DECK_DISABLE_TMUX=1, regardless of the host', async () => {
    await expect(
      tmuxAvailable({ AGENT_DECK_DISABLE_TMUX: '1' } as NodeJS.ProcessEnv),
    ).resolves.toBe(false)
  })

  it('probes the host and caches the result per process', async () => {
    __resetTmuxAvailableCache()
    const env = {} as NodeJS.ProcessEnv
    const first = await tmuxAvailable(env)
    expect(first).toBe(hostHasTmux)
    // Cached: a second call agrees without re-probing (same sticky value).
    await expect(tmuxAvailable(env)).resolves.toBe(first)
  })
})

describe('killDeckSession guard', () => {
  it('REFUSES to kill a session not owned by the deck (no adk_ prefix)', async () => {
    // The guard throws before any tmux command runs, so this needs no tmux.
    await expect(killDeckSession('user-session', SOCKET)).rejects.toThrow(/adk_/)
    await expect(killDeckSession('', SOCKET)).rejects.toThrow(/adk_/)
  })
})

describe.skipIf(!hostHasTmux)('tmux helpers (throwaway tmux server)', () => {
  beforeAll(async () => {
    await killTestServer()
  })
  afterAll(async () => {
    await killTestServer()
  })

  it('listTmuxSessions returns [] when no server is running (not an error)', async () => {
    await expect(listTmuxSessions(SOCKET)).resolves.toEqual([])
  })

  it('lists sessions with name, createdEpoch, lastActivityEpoch, attachedCount, deckOwned', async () => {
    await tmuxRaw(['new-session', '-d', '-s', 'adk_alpha'])
    await tmuxRaw(['new-session', '-d', '-s', 'user_beta'])
    const sessions = await listTmuxSessions(SOCKET)
    const names = sessions.map((s) => s.name).sort()
    expect(names).toEqual(['adk_alpha', 'user_beta'])
    const alpha = sessions.find((s) => s.name === 'adk_alpha')!
    const beta = sessions.find((s) => s.name === 'user_beta')!
    expect(alpha.deckOwned).toBe(true)
    expect(beta.deckOwned).toBe(false)
    expect(alpha.attachedCount).toBe(0) // created detached
    expect(alpha.createdEpoch).toBeGreaterThan(1_600_000_000)
    // Activity is at least the creation moment (cruft-age signal for the UI).
    expect(alpha.lastActivityEpoch).toBeGreaterThanOrEqual(alpha.createdEpoch)
  })

  it('hasTmuxSession answers exactly (no tmux prefix-matching surprises)', async () => {
    await expect(hasTmuxSession('adk_alpha', SOCKET)).resolves.toBe(true)
    // `adk_alp` is a PREFIX of adk_alpha; exact matching must say no.
    await expect(hasTmuxSession('adk_alp', SOCKET)).resolves.toBe(false)
    await expect(hasTmuxSession('nope', SOCKET)).resolves.toBe(false)
  })

  it('killDeckSession refuses a foreign name and leaves it running', async () => {
    await expect(killDeckSession('user_beta', SOCKET)).rejects.toThrow(/adk_/)
    await expect(hasTmuxSession('user_beta', SOCKET)).resolves.toBe(true)
  })

  it('killDeckSession kills a deck-owned session', async () => {
    await killDeckSession('adk_alpha', SOCKET)
    await expect(hasTmuxSession('adk_alpha', SOCKET)).resolves.toBe(false)
    // The foreign session is untouched.
    await expect(hasTmuxSession('user_beta', SOCKET)).resolves.toBe(true)
  })

  it('capturePane returns the recent pane contents', async () => {
    await tmuxRaw(['new-session', '-d', '-s', 'adk_cap'])
    await tmuxRaw(['send-keys', '-t', '=adk_cap:', 'echo CAP_MARKER_42', 'Enter'])
    // Give the shell a moment to run the echo.
    await new Promise((r) => setTimeout(r, 500))
    const text = await capturePane('adk_cap', 200, SOCKET)
    expect(text).toContain('CAP_MARKER_42')
  }, 10000)
})

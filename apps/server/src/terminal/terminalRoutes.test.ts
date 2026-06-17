import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { TerminalSessionsResponse } from '@agent-deck/protocol'
import { terminalRoutes, type TerminalRoutesOptions } from './terminalRoutes'
import type { NodePtyLike } from './ptyBridge'
import type { DetectedCli } from './cliDetector'
import type { TmuxSessionInfo } from './tmux'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

async function build(
  loadNodePty: () => Promise<NodePtyLike | null>,
  enabled = true,
  cwdAvailable: () => Promise<boolean> = async () => true,
  detectClis?: () => Promise<DetectedCli[]>,
  tmux?: Pick<TerminalRoutesOptions, 'tmuxAvailable' | 'listTmuxSessions'>,
): Promise<FastifyInstance> {
  app = Fastify({ logger: false })
  await app.register(terminalRoutes, {
    prefix: '/api/agent-deck/terminal',
    loadNodePty,
    enabled,
    cwdAvailable,
    detectClis,
    ...tmux,
  })
  await app.ready()
  return app
}

interface StatusBody {
  available: boolean
  cwd_available: boolean
  reason?: string
}

describe('terminalRoutes GET /status', () => {
  it('reports available + cwd_available when node-pty loads and a workspace cwd exists', async () => {
    const stub: NodePtyLike = { spawn: () => ({}) as never }
    const a = await build(
      async () => stub,
      true,
      async () => true,
    )
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: true, cwd_available: true })
  })

  it('reports unavailable with an honest reason when node-pty fails to load', async () => {
    const a = await build(async () => null)
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as StatusBody
    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/not available/i)
  })

  it('reports unavailable (gated) when the terminal is disabled, even if node-pty loads', async () => {
    const stub: NodePtyLike = { spawn: () => ({}) as never }
    const a = await build(async () => stub, false)
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as StatusBody
    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/disabled/i)
  })

  it('reports cwd_available:false when node-pty loads but no workspace cwd resolves', async () => {
    // node-pty is fine, terminal enabled — but there is no workspace root to
    // anchor the shell in, so a spawn would be DOOMED. The probe surfaces this
    // BEFORE the UI shows the scary real-shell consent.
    const stub: NodePtyLike = { spawn: () => ({}) as never }
    const a = await build(
      async () => stub,
      true,
      async () => false,
    )
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as StatusBody
    expect(body.cwd_available).toBe(false)
    expect(body.reason).toMatch(/workspace/i)
  })
})

describe('terminalRoutes GET /clis', () => {
  const stub: NodePtyLike = { spawn: () => ({}) as never }

  it('returns the detected CLI list (available flags + install hints for missing)', async () => {
    const detected: DetectedCli[] = [
      { id: 'hermes', label: 'Hermes CLI', available: true },
      {
        id: 'claude',
        label: 'Claude Code',
        available: false,
        installUrl: 'https://docs.anthropic.com/claude-code',
      },
      { id: 'shell', label: 'Raw shell', available: true },
    ]
    const a = await build(
      async () => stub,
      true,
      async () => true,
      async () => detected,
    )
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/clis' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { clis: DetectedCli[] }
    expect(body.clis).toEqual(detected)
    // The missing CLI carries a real install hint; the available ones don't.
    expect(body.clis.find((c) => c.id === 'claude')?.installUrl).toMatch(/^https?:\/\//)
    expect(body.clis.find((c) => c.id === 'hermes')?.installUrl).toBeUndefined()
  })
})

describe('terminalRoutes GET /sessions', () => {
  const stub: NodePtyLike = { spawn: () => ({}) as never }

  it('lists deck-owned + foreign tmux sessions (all persistent) when tmux is available', async () => {
    const listed: TmuxSessionInfo[] = [
      {
        name: 'adk_term-1-ab',
        createdEpoch: 1765000000,
        lastActivityEpoch: 1765000050,
        attachedCount: 1,
        deckOwned: true,
      },
      {
        name: 'my_session',
        createdEpoch: 1764000000,
        lastActivityEpoch: 1764999999,
        attachedCount: 0,
        deckOwned: false,
      },
    ]
    const a = await build(
      async () => stub,
      true,
      async () => true,
      undefined,
      { tmuxAvailable: async () => true, listTmuxSessions: async () => listed },
    )
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/sessions' })
    expect(res.statusCode).toBe(200)
    // The wire shape is the shared protocol contract.
    const body = TerminalSessionsResponse.parse(res.json())
    expect(body.tmuxAvailable).toBe(true)
    expect(body.sessions).toEqual([
      {
        name: 'adk_term-1-ab',
        deckOwned: true,
        attachedCount: 1,
        createdEpoch: 1765000000,
        lastActivityEpoch: 1765000050,
        persistent: true,
      },
      {
        name: 'my_session',
        deckOwned: false,
        attachedCount: 0,
        createdEpoch: 1764000000,
        lastActivityEpoch: 1764999999,
        persistent: true,
      },
    ])
  })

  it('reports tmuxAvailable:false with an empty list when tmux is missing/disabled', async () => {
    const a = await build(
      async () => stub,
      true,
      async () => true,
      undefined,
      {
        tmuxAvailable: async () => false,
        // Must never be consulted without tmux.
        listTmuxSessions: async () => {
          throw new Error('should not list without tmux')
        },
      },
    )
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/terminal/sessions' })
    expect(res.statusCode).toBe(200)
    expect(TerminalSessionsResponse.parse(res.json())).toEqual({
      tmuxAvailable: false,
      sessions: [],
    })
  })
})

describe('terminalRoutes GET /pane-state', () => {
  async function buildWithReader(
    reader: NonNullable<TerminalRoutesOptions['readPaneState']>,
  ): Promise<FastifyInstance> {
    app = Fastify({ logger: false })
    await app.register(terminalRoutes, {
      prefix: '/api/agent-deck/terminal',
      loadNodePty: async () => ({ spawn: () => ({}) as never }),
      readPaneState: reader,
    })
    await app.ready()
    return app
  }

  it('returns the reader snapshot for a valid cli + cwd', async () => {
    const a = await buildWithReader((cli, cwd) => ({
      cli,
      runState: 'working',
      activeFile: cwd ? `${cwd}/x.ts` : null,
      lastTool: 'Edit',
      sessionId: 's1',
      updatedAt: '2026-06-17T10:00:00Z',
    }))
    const res = await a.inject({
      method: 'GET',
      url: '/api/agent-deck/terminal/pane-state?cli=claude&cwd=/home/u/app',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      cli: 'claude',
      runState: 'working',
      activeFile: '/home/u/app/x.ts',
      lastTool: 'Edit',
      sessionId: 's1',
      updatedAt: '2026-06-17T10:00:00Z',
    })
  })

  it('400s an unknown cli (never reaches the reader)', async () => {
    let called = false
    const a = await buildWithReader((cli) => {
      called = true
      return {
        cli,
        runState: 'unknown',
        activeFile: null,
        lastTool: null,
        sessionId: null,
        updatedAt: null,
      }
    })
    const res = await a.inject({
      method: 'GET',
      url: '/api/agent-deck/terminal/pane-state?cli=bogus',
    })
    expect(res.statusCode).toBe(400)
    expect(called).toBe(false)
  })

  it('passes undefined cwd through (the reader returns unknown)', async () => {
    const seen: Array<string | undefined> = []
    const a = await buildWithReader((cli, cwd) => {
      seen.push(cwd)
      return {
        cli,
        runState: 'unknown',
        activeFile: null,
        lastTool: null,
        sessionId: null,
        updatedAt: null,
      }
    })
    const res = await a.inject({
      method: 'GET',
      url: '/api/agent-deck/terminal/pane-state?cli=shell',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().runState).toBe('unknown')
    expect(seen).toEqual([undefined])
  })
})

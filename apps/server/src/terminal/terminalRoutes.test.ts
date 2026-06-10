import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { terminalRoutes } from './terminalRoutes'
import type { NodePtyLike } from './ptyBridge'
import type { DetectedCli } from './cliDetector'

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
): Promise<FastifyInstance> {
  app = Fastify({ logger: false })
  await app.register(terminalRoutes, {
    prefix: '/api/agent-deck/terminal',
    loadNodePty,
    enabled,
    cwdAvailable,
    detectClis,
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

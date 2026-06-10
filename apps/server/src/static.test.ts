import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from './app'
import type { ServerConfig } from './config'

// A throwaway built-client directory standing in for apps/web/dist.
let webDist: string
beforeAll(() => {
  webDist = mkdtempSync(join(tmpdir(), 'agent-deck-web-dist-'))
  writeFileSync(
    join(webDist, 'index.html'),
    '<!doctype html><title>Agent Deck</title><div id="root"></div>',
  )
  mkdirSync(join(webDist, 'assets'))
  writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log("hi")')
})
afterAll(() => {
  rmSync(webDist, { recursive: true, force: true })
})

function makeConfig(staticRoot: string | null): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 7878,
    remote: false,
    trustedHosts: [],
    terminalEnabled: true,
    terminalAllowHome: false,
    hermesHome: '/tmp/hermes-test-home',
    hermesGatewayUrl: 'http://127.0.0.1:8643',
    hermesBin: '/tmp/hermes',
    hermesApiKey: null,
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    webClientRoot: staticRoot,
    mcpCatalogDir: '/tmp/optional-mcps',
  }
}

let app: Awaited<ReturnType<typeof buildApp>> | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

describe('static web client serving', () => {
  it('serves index.html at the root when a webClientRoot is configured', async () => {
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('id="root"')
  })

  it('serves built static assets', async () => {
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('falls back to index.html for unknown client-side routes (SPA history mode)', async () => {
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/sessions/deep/link' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('id="root"')
  })

  it('does NOT mask unknown API routes with the SPA fallback', async () => {
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('still serves the real API alongside the client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ status: 'ok', platform: 'hermes-agent' }),
      ) satisfies typeof fetch,
    )
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('leaves the 404 handler untouched when no webClientRoot is set (dev mode)', async () => {
    app = await buildApp(makeConfig(null))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(404)
  })

  it('re-reads the shell per request so a rebuild self-heals (never serves a stale, cached shell)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'agent-deck-rebuild-'))
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><script src="/assets/old-AAAA.js"></script>',
    )
    app = await buildApp(makeConfig(dist))
    const before = await app.inject({ method: 'GET', url: '/' })
    expect(before.body).toContain('old-AAAA.js')
    // Simulate `pnpm build` replacing the shell + bundle hash while the server keeps
    // running. The old cache-at-boot behavior would still serve `old-AAAA.js` (a
    // now-deleted bundle) → blank screen. The fix re-reads index.html live.
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><script src="/assets/new-BBBB.js"></script>',
    )
    const after = await app.inject({ method: 'GET', url: '/' })
    expect(after.body).toContain('new-BBBB.js')
    expect(after.body).not.toContain('old-AAAA.js')
    rmSync(dist, { recursive: true, force: true })
  })

  it('serves an asset added AFTER startup (a rebuild) without a restart (wildcard:true)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'agent-deck-asset-'))
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>')
    mkdirSync(join(dist, 'assets'))
    app = await buildApp(makeConfig(dist))
    // Simulate `pnpm build` emitting a freshly-hashed bundle after the server booted.
    // The old wildcard:false config registered asset routes at boot, so this new
    // hash had no route → SPA fallback → blank screen. wildcard:true serves it live.
    writeFileSync(join(dist, 'assets', 'index-NEWHASH.js'), 'export const x = 1')
    const res = await app.inject({ method: 'GET', url: '/assets/index-NEWHASH.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.body).toContain('export const x')
    rmSync(dist, { recursive: true, force: true })
  })

  it('404s a missing /assets/* path instead of returning the HTML shell', async () => {
    app = await buildApp(makeConfig(webDist))
    const res = await app.inject({ method: 'GET', url: '/assets/does-not-exist.js' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })
})

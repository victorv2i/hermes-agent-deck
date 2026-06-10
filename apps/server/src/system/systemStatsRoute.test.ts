import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { SystemStats } from '@agent-deck/protocol'
import { registerSystemStatsRoute } from './systemStatsRoute'

function makeDashboard(json: unknown, fail?: boolean) {
  return {
    getJson: fail
      ? () => Promise.reject(new Error('connection refused'))
      : () => Promise.resolve(json),
  } as never
}

async function mount(json: unknown, fail?: boolean) {
  const app = Fastify({ logger: false })
  await registerSystemStatsRoute(app, { dashboard: makeDashboard(json, fail) })
  await app.ready()
  return app
}

const FULL_STATS = {
  psutil: true,
  os: 'Linux',
  os_release: '6.1.0',
  os_version: '#1 SMP Sat Jan 1 00:00:00 UTC 2026',
  platform: 'Linux-6.1-x86_64',
  arch: 'x86_64',
  hostname: 'test-host', // must NOT cross the wire
  python_version: '3.12.1', // must NOT cross the wire
  python_impl: 'CPython', // must NOT cross the wire
  hermes_version: '0.15.2',
  cpu_count: 8,
  cpu_percent: 14.2,
  load_avg: [0.3, 0.6, 0.9],
  uptime_seconds: 172800,
  memory: { total: 16_000_000_000, available: 8_000_000_000, used: 8_000_000_000, percent: 50 },
  disk: { total: 500_000_000_000, used: 200_000_000_000, free: 300_000_000_000, percent: 40 },
  process: {
    pid: 99999, // must NOT cross the wire (PID)
    rss: 524288000,
    create_time: 1748700000,
    num_threads: 12,
  },
}

describe('GET /api/agent-deck/system/stats', () => {
  it('returns 200 with a whitelisted SystemStats shape', async () => {
    const app = await mount(FULL_STATS)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system/stats' })
    expect(res.statusCode).toBe(200)
    const body = SystemStats.parse(res.json())
    expect(body.psutil).toBe(true)
    expect(body.os).toBe('Linux')
    expect(body.hermes_version).toBe('0.15.2')
    expect(body.memory?.percent).toBe(50)
    expect(body.disk?.percent).toBe(40)
    await app.close()
  })

  it('NEVER leaks hostname, pid, python_version, os_version, or process internals', async () => {
    const app = await mount(FULL_STATS)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system/stats' })
    const payload = res.payload
    expect(payload).not.toContain('test-host') // hostname
    expect(payload).not.toContain('99999') // pid
    expect(payload).not.toContain('CPython') // python_impl
    expect(payload).not.toContain('python_version')
    expect(payload).not.toContain('os_version')
    expect(payload).not.toContain('process')
    await app.close()
  })

  it('degrades gracefully when psutil is absent (stdlib-only snapshot)', async () => {
    const app = await mount({
      psutil: false,
      os: 'Linux',
      arch: 'x86_64',
      hermes_version: '0.15.2',
      cpu_count: 4,
      load_avg: [0.1, 0.2, 0.3],
    })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system/stats' })
    expect(res.statusCode).toBe(200)
    const body = SystemStats.parse(res.json())
    expect(body.psutil).toBe(false)
    expect(body.memory).toBeUndefined()
    expect(body.disk).toBeUndefined()
    await app.close()
  })

  it('returns 502 when Hermes is unreachable', async () => {
    const app = await mount({}, true)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system/stats' })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})

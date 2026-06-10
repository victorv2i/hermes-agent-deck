import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { ProviderValidateResult } from '@agent-deck/protocol'
import { registerProviderValidateRoute } from './providerValidateRoute'

function makeOkDashboard(hermeResult: unknown) {
  return {
    authedFetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(hermeResult) }),
  } as never
}

function makeNetworkFailDashboard() {
  return {
    authedFetch: () => Promise.reject(new Error('network error')),
  } as never
}

async function mount(dashboard: ReturnType<typeof makeOkDashboard>) {
  const app = Fastify({ logger: false })
  await registerProviderValidateRoute(app, { dashboard })
  await app.ready()
  return app
}

describe('POST /api/agent-deck/providers/validate', () => {
  it('returns ok=true when the key is accepted', async () => {
    const app = await mount(makeOkDashboard({ ok: true, reachable: true, message: '' }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { key: 'OPENAI_API_KEY', value: 'sk-test-valid' },
    })
    expect(res.statusCode).toBe(200)
    const body = ProviderValidateResult.parse(res.json())
    expect(body.ok).toBe(true)
    expect(body.reachable).toBe(true)
    await app.close()
  })

  it('returns ok=false reachable=true when the key is rejected', async () => {
    const app = await mount(
      makeOkDashboard({
        ok: false,
        reachable: true,
        message: 'That API key was rejected. Double-check it and try again.',
      }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { key: 'OPENAI_API_KEY', value: 'sk-bad-key' },
    })
    expect(res.statusCode).toBe(200)
    const body = ProviderValidateResult.parse(res.json())
    expect(body.ok).toBe(false)
    expect(body.reachable).toBe(true)
    expect(body.message).toMatch(/rejected/)
    await app.close()
  })

  it('returns ok=false reachable=false (allow-save) when network probe fails in Hermes', async () => {
    const app = await mount(
      makeOkDashboard({ ok: false, reachable: false, message: 'Could not reach the provider.' }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-test' },
    })
    expect(res.statusCode).toBe(200)
    const body = ProviderValidateResult.parse(res.json())
    expect(body.ok).toBe(false)
    expect(body.reachable).toBe(false)
    await app.close()
  })

  it('fails open (allow-save, reachable=false) when the BFF cannot reach Hermes', async () => {
    const app = await mount(makeNetworkFailDashboard())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { key: 'OPENAI_API_KEY', value: 'sk-test' },
    })
    expect(res.statusCode).toBe(200)
    const body = ProviderValidateResult.parse(res.json())
    expect(body.ok).toBe(false)
    expect(body.reachable).toBe(false)
    await app.close()
  })

  it('returns 400 when key or value is missing', async () => {
    const app = await mount(makeOkDashboard({ ok: true, reachable: true, message: '' }))
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { value: 'sk-test' },
    })
    expect(r1.statusCode).toBe(400)
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/providers/validate',
      payload: { key: 'OPENAI_API_KEY' },
    })
    expect(r2.statusCode).toBe(400)
    await app.close()
  })
})

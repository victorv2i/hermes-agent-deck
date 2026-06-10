import { describe, it, expect } from 'vitest'
import { SetupStatus, AgentDeckProviderKeyRequest, AgentDeckProviderKeyResponse } from './setup'

describe('SetupStatus DTO', () => {
  it('parses the three real readiness flags', () => {
    const parsed = SetupStatus.parse({
      hermesInstalled: true,
      providerConnected: false,
      agentNamed: false,
    })
    expect(parsed).toEqual({
      hermesInstalled: true,
      providerConnected: false,
      agentNamed: false,
    })
  })

  it('rejects a non-boolean flag (no truthy coercion)', () => {
    expect(() =>
      SetupStatus.parse({ hermesInstalled: 'yes', providerConnected: false, agentNamed: false }),
    ).toThrow()
  })
})

describe('AgentDeckProviderKeyRequest DTO', () => {
  it('requires a non-empty provider and key', () => {
    expect(AgentDeckProviderKeyRequest.parse({ provider: 'openrouter', apiKey: 'sk-xxx' })).toEqual(
      { provider: 'openrouter', apiKey: 'sk-xxx' },
    )
    expect(() => AgentDeckProviderKeyRequest.parse({ provider: '', apiKey: 'x' })).toThrow()
    expect(() =>
      AgentDeckProviderKeyRequest.parse({ provider: 'openrouter', apiKey: '' }),
    ).toThrow()
  })
})

describe('AgentDeckProviderKeyResponse DTO', () => {
  it('carries the result but NEVER the key (whitelist strips it)', () => {
    const parsed = AgentDeckProviderKeyResponse.parse({
      provider: 'openrouter',
      connected: true,
      apiKey: 'sk-leaked',
    })
    expect(Object.keys(parsed).sort()).toEqual(['connected', 'provider'])
    expect(parsed).not.toHaveProperty('apiKey')
  })
})

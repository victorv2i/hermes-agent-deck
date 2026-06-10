import { describe, it, expect } from 'vitest'
import { CliOpRequest, CliOpResponse, CliOpId, CliOpParams } from './cli-op'

describe('CliOpId', () => {
  it('accepts all whitelisted op ids', () => {
    const ids = ['doctor-fix', 'auth-list', 'auth-status', 'auth-logout', 'tools-list'] as const
    for (const id of ids) {
      expect(CliOpId.safeParse(id).success).toBe(true)
    }
  })

  it('rejects unknown op ids', () => {
    expect(CliOpId.safeParse('exec-shell').success).toBe(false)
    expect(CliOpId.safeParse('').success).toBe(false)
    expect(CliOpId.safeParse('../../etc/passwd').success).toBe(false)
  })
})

describe('CliOpParams', () => {
  it('accepts a valid provider slug', () => {
    expect(CliOpParams.safeParse({ provider: 'nous' }).success).toBe(true)
    expect(CliOpParams.safeParse({ provider: 'openai-api' }).success).toBe(true)
    expect(CliOpParams.safeParse({ provider: 'google-gemini-cli' }).success).toBe(true)
  })

  it('accepts an empty object (no provider needed for some ops)', () => {
    expect(CliOpParams.safeParse({}).success).toBe(true)
  })

  it('rejects provider slugs with shell metacharacters', () => {
    expect(CliOpParams.safeParse({ provider: 'nous; rm -rf ~' }).success).toBe(false)
    expect(CliOpParams.safeParse({ provider: '../../etc' }).success).toBe(false)
    expect(CliOpParams.safeParse({ provider: 'Nous Provider' }).success).toBe(false)
  })

  it('is strict — no extra keys allowed', () => {
    expect(CliOpParams.safeParse({ provider: 'nous', extra: 'val' }).success).toBe(false)
  })
})

describe('CliOpRequest', () => {
  it('parses a valid no-param op', () => {
    const result = CliOpRequest.safeParse({ opId: 'doctor-fix', params: {} })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.opId).toBe('doctor-fix')
    }
  })

  it('parses a valid provider op', () => {
    const result = CliOpRequest.safeParse({ opId: 'auth-status', params: { provider: 'nous' } })
    expect(result.success).toBe(true)
  })

  it('params defaults to empty object when omitted', () => {
    const result = CliOpRequest.safeParse({ opId: 'auth-list' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.params).toEqual({})
    }
  })

  it('rejects an unknown opId', () => {
    expect(CliOpRequest.safeParse({ opId: 'rm-rf', params: {} }).success).toBe(false)
  })

  it('rejects extra keys (strict)', () => {
    expect(CliOpRequest.safeParse({ opId: 'auth-list', params: {}, extraKey: 'x' }).success).toBe(
      false,
    )
  })
})

describe('CliOpResponse', () => {
  it('parses a successful response', () => {
    const result = CliOpResponse.safeParse({
      ok: true,
      stdout: 'nous (1 credentials):',
      summary: 'auth-list completed successfully',
      exitCode: 0,
    })
    expect(result.success).toBe(true)
  })

  it('parses a failure response with exitCode non-zero', () => {
    const result = CliOpResponse.safeParse({
      ok: false,
      stdout: '',
      summary: 'auth-status exited with errors',
      exitCode: 1,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ok).toBe(false)
      expect(result.data.exitCode).toBe(1)
    }
  })

  it('accepts an optional parsed field', () => {
    const result = CliOpResponse.safeParse({
      ok: true,
      stdout: '',
      summary: 'ok',
      exitCode: 0,
      parsed: { providers: [], total: 0 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a response missing required fields', () => {
    expect(CliOpResponse.safeParse({ ok: true, stdout: '' }).success).toBe(false)
  })
})

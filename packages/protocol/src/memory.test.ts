import { describe, it, expect } from 'vitest'
import {
  MemoryProvider,
  MemoryStatus,
  MemoryProviderSelectRequest,
  MemoryResetTarget,
  MemoryResetRequest,
  MemoryResetResult,
  CuratorStatus,
  SystemStats,
  ProviderValidateResult,
} from './memory'

describe('MemoryProvider', () => {
  it('parses a provider entry', () => {
    const parsed = MemoryProvider.parse({
      name: 'mem0',
      description: 'Mem0 cloud memory',
      configured: true,
    })
    expect(parsed.name).toBe('mem0')
    expect(parsed.configured).toBe(true)
  })
})

describe('MemoryStatus', () => {
  it('parses the GET /api/memory shape with providers + file sizes', () => {
    const parsed = MemoryStatus.parse({
      active: 'mem0',
      providers: [{ name: 'mem0', description: 'Mem0 cloud memory', configured: true }],
      builtin_files: { memory: 1024, user: 0 },
    })
    expect(parsed.active).toBe('mem0')
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.builtin_files.memory).toBe(1024)
    expect(parsed.builtin_files.user).toBe(0)
  })

  it('parses the built-in (no external provider) state', () => {
    const parsed = MemoryStatus.parse({
      active: '',
      providers: [],
      builtin_files: { memory: 512, user: 256 },
    })
    expect(parsed.active).toBe('')
    expect(parsed.providers).toHaveLength(0)
  })
})

describe('MemoryProviderSelectRequest', () => {
  it('accepts a provider name or empty string (built-in)', () => {
    expect(MemoryProviderSelectRequest.parse({ provider: 'mem0' }).provider).toBe('mem0')
    expect(MemoryProviderSelectRequest.parse({ provider: '' }).provider).toBe('')
  })
})

describe('MemoryResetTarget', () => {
  it('accepts all | memory | user and rejects others', () => {
    expect(MemoryResetTarget.parse('all')).toBe('all')
    expect(MemoryResetTarget.parse('memory')).toBe('memory')
    expect(MemoryResetTarget.parse('user')).toBe('user')
    expect(() => MemoryResetTarget.parse('everything')).toThrow()
  })
})

describe('MemoryResetRequest', () => {
  it('wraps the target', () => {
    expect(MemoryResetRequest.parse({ target: 'all' }).target).toBe('all')
  })
})

describe('MemoryResetResult', () => {
  it('carries ok + deleted file names', () => {
    const parsed = MemoryResetResult.parse({ ok: true, deleted: ['MEMORY.md'] })
    expect(parsed.ok).toBe(true)
    expect(parsed.deleted).toEqual(['MEMORY.md'])
  })
})

describe('CuratorStatus', () => {
  it('parses a full curator status response', () => {
    const parsed = CuratorStatus.parse({
      available: true,
      enabled: true,
      paused: false,
      interval_hours: 24,
      last_run_at: '2026-06-01T12:00:00Z',
      min_idle_hours: 1,
      stale_after_days: 7,
      archive_after_days: 30,
    })
    expect(parsed.available).toBe(true)
    expect(parsed.enabled).toBe(true)
    expect(parsed.paused).toBe(false)
    expect(parsed.interval_hours).toBe(24)
    expect(parsed.last_run_at).toBe('2026-06-01T12:00:00Z')
  })

  it('parses the unavailable state (module could not load)', () => {
    const parsed = CuratorStatus.parse({
      available: false,
      enabled: false,
      paused: false,
      interval_hours: null,
      last_run_at: null,
      min_idle_hours: null,
      stale_after_days: null,
      archive_after_days: null,
    })
    expect(parsed.available).toBe(false)
    expect(parsed.interval_hours).toBeNull()
  })
})

describe('SystemStats', () => {
  it('parses a full psutil-enriched snapshot', () => {
    const parsed = SystemStats.parse({
      psutil: true,
      os: 'Linux',
      arch: 'x86_64',
      hermes_version: '0.15.2',
      cpu_count: 8,
      cpu_percent: 12.3,
      load_avg: [0.5, 0.8, 1.2],
      uptime_seconds: 86400,
      memory: { total: 16_000_000_000, available: 8_000_000_000, used: 8_000_000_000, percent: 50 },
      disk: { total: 500_000_000_000, used: 200_000_000_000, free: 300_000_000_000, percent: 40 },
    })
    expect(parsed.psutil).toBe(true)
    expect(parsed.os).toBe('Linux')
    expect(parsed.memory?.percent).toBe(50)
    expect(parsed.disk?.percent).toBe(40)
    expect(parsed.load_avg).toEqual([0.5, 0.8, 1.2])
  })

  it('parses the psutil-absent (stdlib-only) snapshot gracefully', () => {
    const parsed = SystemStats.parse({
      psutil: false,
      os: 'Linux',
      arch: 'x86_64',
      hermes_version: '0.15.2',
      cpu_count: 4,
    })
    expect(parsed.psutil).toBe(false)
    expect(parsed.memory).toBeUndefined()
    expect(parsed.disk).toBeUndefined()
  })
})

describe('ProviderValidateResult', () => {
  it('parses the three honest outcomes', () => {
    // key accepted
    const accepted = ProviderValidateResult.parse({ ok: true, reachable: true, message: '' })
    expect(accepted.ok).toBe(true)
    expect(accepted.reachable).toBe(true)

    // key rejected
    const rejected = ProviderValidateResult.parse({
      ok: false,
      reachable: true,
      message: 'That API key was rejected. Double-check it and try again.',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.reachable).toBe(true)

    // network unreachable
    const unreachable = ProviderValidateResult.parse({
      ok: false,
      reachable: false,
      message: 'Could not reach the provider to verify the key.',
    })
    expect(unreachable.ok).toBe(false)
    expect(unreachable.reachable).toBe(false)
  })
})

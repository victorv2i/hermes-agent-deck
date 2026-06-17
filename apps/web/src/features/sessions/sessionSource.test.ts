import { describe, it, expect } from 'vitest'
import { sourceMeta, isWebOriginated, splitBySource } from './sessionSource'
import type { SessionSummary } from './types'

describe('sourceMeta', () => {
  it('maps known sources to a human label + governed tone', () => {
    expect(sourceMeta('cli')).toEqual({ label: 'CLI', tone: 'info' })
    expect(sourceMeta('web')).toEqual({ label: 'Web', tone: 'success' })
    expect(sourceMeta('api')).toEqual({ label: 'API', tone: 'warning' })
    expect(sourceMeta('cron')).toEqual({ label: 'Scheduled', tone: 'warning' })
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(sourceMeta('  CLI ')).toEqual({ label: 'CLI', tone: 'info' })
  })

  it('keeps an unknown but non-empty source as a readable neutral label', () => {
    expect(sourceMeta('weird')).toEqual({ label: 'Weird', tone: 'muted' })
  })

  it('falls back to a neutral "Unknown source" dot for null/empty', () => {
    expect(sourceMeta(null)).toEqual({ label: 'Unknown source', tone: 'muted' })
    expect(sourceMeta('')).toEqual({ label: 'Unknown source', tone: 'muted' })
    expect(sourceMeta(undefined)).toEqual({ label: 'Unknown source', tone: 'muted' })
  })

  it('never assigns the amber action accent to a source (governance)', () => {
    // tone is constrained to the governed semantic palette only.
    const tones = ['cli', 'web', 'api', 'cron', 'handoff', 'mystery', null].map(
      (s) => sourceMeta(s).tone,
    )
    expect(tones.every((t) => ['info', 'success', 'warning', 'muted'].includes(t))).toBe(true)
  })
})

function s(over: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    source: 'cli',
    model: null,
    title: null,
    preview: '',
    started_at: 0,
    last_active: 0,
    message_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
    ...over,
  }
}

describe('isWebOriginated', () => {
  it('treats web + ui + dashboard sources as web-originated (agent-deck home)', () => {
    expect(isWebOriginated(s({ id: 'a', source: 'web' }))).toBe(true)
    expect(isWebOriginated(s({ id: 'b', source: 'ui' }))).toBe(true)
    // A real Hermes install tags a chat opened through this deck as `dashboard`
    // (the deck drives the gateway's dashboard), so that's agent-deck-originated.
    expect(isWebOriginated(s({ id: 'd', source: 'dashboard' }))).toBe(true)
    // Case-insensitive + whitespace-tolerant (mirrors sourceMeta).
    expect(isWebOriginated(s({ id: 'c', source: ' WEB ' }))).toBe(true)
    expect(isWebOriginated(s({ id: 'e', source: 'Dashboard' }))).toBe(true)
  })

  it('treats every other channel as external (cli/telegram/discord/cron/api/…)', () => {
    for (const src of ['cli', 'telegram', 'discord', 'cron', 'api', 'job', 'handoff', 'terminal']) {
      expect(isWebOriginated(s({ id: src, source: src }))).toBe(false)
    }
  })

  it('treats an unknown/empty source as external (never a default web dump)', () => {
    expect(isWebOriginated(s({ id: 'x', source: 'mystery' }))).toBe(false)
    expect(isWebOriginated(s({ id: 'y', source: '' }))).toBe(false)
  })
})

describe('splitBySource', () => {
  it('partitions a list into web-originated vs external, order-preserving', () => {
    const list = [
      s({ id: 'a', source: 'web' }),
      s({ id: 'b', source: 'cli' }),
      s({ id: 'c', source: 'ui' }),
      s({ id: 'd', source: 'telegram' }),
    ]
    const { web, external } = splitBySource(list)
    expect(web.map((x) => x.id)).toEqual(['a', 'c'])
    expect(external.map((x) => x.id)).toEqual(['b', 'd'])
  })

  it('returns empty partitions for an empty list', () => {
    expect(splitBySource([])).toEqual({ web: [], external: [] })
  })
})

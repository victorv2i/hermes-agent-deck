import { describe, it, expect } from 'vitest'
import type { AgentDeckStatus, CronJob, KanbanBoard } from '@agent-deck/protocol'
import { summarizeTending, type TendingInputs } from './tendingSummary'

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
const NOW_SEC = Math.floor(NOW / 1000)
const HOUR = 3600

function status(overrides: Partial<AgentDeckStatus> = {}): AgentDeckStatus {
  return {
    gatewayRunning: true,
    gatewayState: 'running',
    platforms: [
      { name: 'telegram', state: 'connected', error: null },
      { name: 'cron', state: 'connected', error: null },
    ],
    activeSessions: 0,
    version: '0.15.2',
    configUpdateAvailable: false,
    ...overrides,
  }
}

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'j1',
    name: 'Morning brief',
    prompt: 'Summarize the news',
    schedule: { kind: 'cron', display: '0 9 * * *', expr: '0 9 * * *', minutes: null, runAt: null },
    enabled: true,
    paused: false,
    profile: 'default',
    deliver: 'local',
    noAgent: false,
    createdAt: null,
    nextRunAt: new Date((NOW_SEC + HOUR) * 1000).toISOString(),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    repeatTimes: null,
    ...overrides,
  }
}

function board(running = 0): KanbanBoard {
  return {
    board: 'default',
    columns: [
      {
        name: 'running',
        cards: Array.from({ length: running }).map((_, i) => ({
          id: `t${i}`,
          title: `Task ${i}`,
          column: 'running' as const,
          assignee: null,
          priority: 0,
          latestSummary: null,
          createdAt: NOW_SEC - HOUR,
          startedAt: NOW_SEC - 60,
          completedAt: null,
          age: null,
          worker: null,
          commentCount: 0,
          linkCounts: { parents: 0, children: 0 },
          progress: null,
          warnings: null,
        })),
      },
    ],
    assignees: [],
    cursor: 1,
    now: NOW_SEC,
  }
}

function inputs(overrides: Partial<TendingInputs> = {}): TendingInputs {
  return {
    status: status(),
    jobs: [],
    board: undefined,
    now: NOW,
    ...overrides,
  }
}

describe('summarizeTending — connection', () => {
  it('reports Connected when the gateway is running', () => {
    const t = summarizeTending(inputs())
    expect(t.connection.label).toBe('Connected')
    expect(t.connection.tone).toBe('ok')
  })

  it('reports a calm offline state when status is unreachable', () => {
    const t = summarizeTending(inputs({ status: undefined }))
    expect(t.connection.label).toMatch(/offline/i)
    expect(t.connection.tone).toBe('idle')
    // Honest: nothing is fabricated when Hermes is down.
    expect(t.facts).toEqual([])
  })

  it('reports Connected without facts when /status is unavailable but health says Hermes is reachable', () => {
    const t = summarizeTending(inputs({ status: undefined, hermesReachable: true }))
    expect(t.connection.label).toBe('Connected')
    expect(t.connection.tone).toBe('ok')
    // Health only proves reachability; it must not invent platform/session/job facts
    // or an "all quiet" state.
    expect(t.facts).toEqual([])
    expect(t.idle).toBe(false)
  })

  it('reports Disconnected (warn) when the gateway is reachable but not running', () => {
    const t = summarizeTending(inputs({ status: status({ gatewayRunning: false }) }))
    expect(t.connection.label).toMatch(/not running/i)
    expect(t.connection.tone).toBe('warn')
  })

  it('flags a troubled platform with a warn tone', () => {
    const t = summarizeTending(
      inputs({
        status: status({
          platforms: [
            { name: 'telegram', state: 'connected', error: null },
            { name: 'cron', state: 'down', error: 'not started' },
          ],
        }),
      }),
    )
    expect(t.connection.tone).toBe('warn')
    expect(t.connection.label).toMatch(/need(s)? attention/i)
  })
})

describe('summarizeTending — watching facts', () => {
  it('counts scheduled (enabled, non-paused) jobs as "watching N things"', () => {
    const t = summarizeTending(
      inputs({ jobs: [job(), job({ id: 'j2' }), job({ id: 'j3', paused: true, enabled: false })] }),
    )
    // 2 scheduled (j1, j2); the paused one is not "watching".
    expect(t.facts).toContain('watching 2 schedules')
  })

  it('singularizes a single schedule', () => {
    const t = summarizeTending(inputs({ jobs: [job()] }))
    expect(t.facts).toContain('watching 1 schedule')
  })

  it('counts jobs that ran today', () => {
    const t = summarizeTending(
      inputs({
        jobs: [
          job({ id: 'a', lastRunAt: new Date((NOW_SEC - HOUR) * 1000).toISOString() }),
          job({ id: 'b', lastRunAt: new Date((NOW_SEC - 2 * HOUR) * 1000).toISOString() }),
          // ran yesterday — excluded.
          job({ id: 'c', lastRunAt: new Date((NOW_SEC - 30 * HOUR) * 1000).toISOString() }),
        ],
      }),
    )
    expect(t.facts).toContain('2 jobs ran today')
  })

  it('singularizes a single job run today', () => {
    const t = summarizeTending(
      inputs({ jobs: [job({ lastRunAt: new Date((NOW_SEC - HOUR) * 1000).toISOString() })] }),
    )
    expect(t.facts).toContain('1 job ran today')
  })

  it('reports active sessions from status', () => {
    const t = summarizeTending(inputs({ status: status({ activeSessions: 3 }) }))
    expect(t.facts).toContain('3 active sessions')
  })

  it('singularizes a single active session', () => {
    const t = summarizeTending(inputs({ status: status({ activeSessions: 1 }) }))
    expect(t.facts).toContain('1 active session')
  })

  it('reports kanban work-in-progress from running cards', () => {
    const t = summarizeTending(inputs({ board: { available: true, data: board(2) } }))
    expect(t.facts).toContain('2 tasks in progress')
  })

  it('omits kanban WIP when the plugin is unavailable', () => {
    const t = summarizeTending(inputs({ board: { available: false } }))
    expect(t.facts.some((f) => /in progress/.test(f))).toBe(false)
  })

  it('omits every zero fact (only shows what is real)', () => {
    const t = summarizeTending(inputs())
    expect(t.facts).toEqual([])
  })

  it('composes a full warm line when there is real activity', () => {
    const t = summarizeTending(
      inputs({
        status: status({ activeSessions: 1 }),
        jobs: [
          job(),
          job({ id: 'j2', lastRunAt: new Date((NOW_SEC - HOUR) * 1000).toISOString() }),
        ],
        board: { available: true, data: board(1) },
      }),
    )
    expect(t.facts).toEqual([
      'watching 2 schedules',
      '1 job ran today',
      '1 active session',
      '1 task in progress',
    ])
  })
})

describe('summarizeTending — calm empty state', () => {
  it('reports nothing-to-tend honestly when connected but idle', () => {
    const t = summarizeTending(inputs())
    expect(t.connection.tone).toBe('ok')
    expect(t.facts).toEqual([])
    expect(t.idle).toBe(true)
  })

  it('is not idle when there is at least one real fact', () => {
    const t = summarizeTending(inputs({ jobs: [job()] }))
    expect(t.idle).toBe(false)
  })
})

describe('summarizeTending — needs your OK (deck-carried approvals)', () => {
  it('carries the pending-approval count through the connected branch', () => {
    expect(summarizeTending(inputs({ pendingApprovals: 1 })).needsOk).toBe(1)
    expect(summarizeTending(inputs()).needsOk).toBe(0)
  })

  it('still surfaces a waiting approval when the dashboard status is unavailable', () => {
    // The approval comes from the deck's own live chat socket, not the
    // dashboard — a status outage must not hide a gate waiting on the user.
    const down = summarizeTending(inputs({ status: undefined, pendingApprovals: 1 }))
    expect(down.needsOk).toBe(1)
    const reachable = summarizeTending(
      inputs({ status: undefined, hermesReachable: true, pendingApprovals: 1 }),
    )
    expect(reachable.needsOk).toBe(1)
  })

  it('never converts a zero into a claim (no facts, no fake all-clear)', () => {
    const t = summarizeTending(inputs({ pendingApprovals: 0 }))
    expect(t.needsOk).toBe(0)
    expect(t.facts).toEqual([])
  })
})

/**
 * kanbanApi — orchestration cut. Verifies the run-control client functions build
 * the right BFF URL (incl. the optional ?board=), send the right body, and
 * zod-parse the response. The reads/comment/move are covered by the hooks + server
 * tests; these focus on the NEW dispatch / terminate / reassign surface.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { dispatch, terminateRun, reassignTask } from './kanbanApi'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Capture the URL + parsed JSON body of the single fetch the call makes. */
function stubFetch(responseBody: unknown): {
  calls: { url: string; method?: string; body: unknown }[]
} {
  const calls: { url: string; method?: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Response.json(responseBody)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

describe('dispatch', () => {
  it('POSTs the dispatch nudge and parses the slim tally', async () => {
    const { calls } = stubFetch({
      spawned: 2,
      spawnedIds: ['t_a', 't_b'],
      promoted: 1,
      reclaimed: 0,
      skippedUnassigned: [],
    })
    const result = await dispatch('proj')
    expect(calls[0]!.url).toBe('/api/agent-deck/kanban/dispatch?board=proj')
    expect(calls[0]!.method).toBe('POST')
    expect(result.spawned).toBe(2)
    expect(result.spawnedIds).toEqual(['t_a', 't_b'])
  })

  it('omits ?board= for the active board', async () => {
    const { calls } = stubFetch({
      spawned: 0,
      spawnedIds: [],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    })
    await dispatch()
    expect(calls[0]!.url).toBe('/api/agent-deck/kanban/dispatch')
  })
})

describe('terminateRun', () => {
  it('POSTs to the task terminate route with the runId + reason', async () => {
    const { calls } = stubFetch({ ok: true, taskId: 't_1', error: null })
    const result = await terminateRun('t 1', { runId: 42, reason: 'stuck' }, 'proj')
    expect(calls[0]!.url).toBe('/api/agent-deck/kanban/tasks/t%201/terminate?board=proj')
    expect(calls[0]!.body).toEqual({ runId: 42, reason: 'stuck' })
    expect(result).toEqual({ ok: true, taskId: 't_1', error: null })
  })

  it('parses an HONEST ok:false (run already ended)', async () => {
    stubFetch({ ok: false, taskId: null, error: 'The run already ended.' })
    const result = await terminateRun('t_1', { runId: 7 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already ended/i)
  })
})

describe('reassignTask', () => {
  it('POSTs to the reassign route with profile + reclaimFirst', async () => {
    const { calls } = stubFetch({ ok: true, assignee: 'smart', error: null })
    const result = await reassignTask('t_1', { profile: 'smart', reclaimFirst: true }, 'proj')
    expect(calls[0]!.url).toBe('/api/agent-deck/kanban/tasks/t_1/reassign?board=proj')
    expect(calls[0]!.body).toEqual({ profile: 'smart', reclaimFirst: true })
    expect(result.assignee).toBe('smart')
  })
})

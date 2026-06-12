import { describe, it, expect, vi } from 'vitest'
import { fetchTerminalTmuxSessions } from './useTerminalTmuxSessions'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('fetchTerminalTmuxSessions', () => {
  it('fetches and validates the session list against the protocol schema', async () => {
    const payload = {
      tmuxAvailable: true,
      sessions: [
        {
          name: 'adk_term-1-ab',
          deckOwned: true,
          attachedCount: 1,
          createdEpoch: 1765000000,
          lastActivityEpoch: 1765000100,
          persistent: true,
        },
      ],
    }
    const fetchImpl = vi.fn(async () => jsonResponse(payload)) as unknown as typeof fetch
    const data = await fetchTerminalTmuxSessions(fetchImpl)
    expect(data.tmuxAvailable).toBe(true)
    expect(data.sessions[0]!.name).toBe('adk_term-1-ab')
    expect(fetchImpl).toHaveBeenCalledWith('/api/agent-deck/terminal/sessions', { headers: {} })
  })

  it('throws on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
    await expect(fetchTerminalTmuxSessions(fetchImpl)).rejects.toThrow(/500/)
  })

  it('throws on a malformed payload (zod is the gate)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ tmuxAvailable: true, sessions: [{ name: 'x' }] }),
    ) as unknown as typeof fetch
    await expect(fetchTerminalTmuxSessions(fetchImpl)).rejects.toThrow()
  })
})

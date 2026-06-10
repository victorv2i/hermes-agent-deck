import { describe, it, expect } from 'vitest'
import {
  deriveRunState,
  lastSignalAt,
  WORKING_RECENT_MS,
  STALL_SILENCE_MS,
  type RunStateInputs,
} from './runState'

/** A convenient "now" base — any fixed epoch works, the math is relative. */
const NOW = 1_780_000_000_000

function inputs(overrides: Partial<RunStateInputs> = {}): RunStateInputs {
  return {
    runStatus: 'running',
    hasPendingApproval: false,
    lastEventAt: NOW,
    lastHeartbeatAt: null,
    connection: 'connected',
    now: NOW,
    ...overrides,
  }
}

describe('deriveRunState — no active run', () => {
  it('returns null when idle (the chip must disappear, not show idle theater)', () => {
    expect(deriveRunState(inputs({ runStatus: 'idle' }))).toBeNull()
  })

  it('returns null when idle even with stale timestamps or a pending-looking past', () => {
    expect(
      deriveRunState(
        inputs({
          runStatus: 'idle',
          lastEventAt: NOW - 500_000,
          lastHeartbeatAt: NOW - 500_000,
        }),
      ),
    ).toBeNull()
  })
})

describe('deriveRunState — working (recent real event)', () => {
  it('is working immediately after an event', () => {
    expect(deriveRunState(inputs({ lastEventAt: NOW }))).toBe('working')
  })

  it('is working just inside the 10s boundary', () => {
    expect(deriveRunState(inputs({ lastEventAt: NOW - (WORKING_RECENT_MS - 1) }))).toBe('working')
  })

  it('stops claiming working AT exactly 10s of event silence', () => {
    expect(deriveRunState(inputs({ lastEventAt: NOW - WORKING_RECENT_MS }))).toBe('thinking')
  })

  it('covers the stopping status too (a stop in flight is still an active run)', () => {
    expect(deriveRunState(inputs({ runStatus: 'stopping', lastEventAt: NOW }))).toBe('working')
  })
})

describe('deriveRunState — thinking vs maybe_stalled (the 120s liveness window)', () => {
  it('is thinking when events are stale but a heartbeat keeps the stream provably alive', () => {
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - 90_000,
          lastHeartbeatAt: NOW - 15_000, // fresh keepalive
        }),
      ),
    ).toBe('thinking')
  })

  it('a heartbeat alone (no event for far longer than 120s) still reads thinking', () => {
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - 600_000,
          lastHeartbeatAt: NOW - 30_000,
        }),
      ),
    ).toBe('thinking')
  })

  it('is thinking just inside the 120s boundary', () => {
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - (STALL_SILENCE_MS - 1),
          lastHeartbeatAt: null,
        }),
      ),
    ).toBe('thinking')
  })

  it('becomes maybe_stalled AT exactly 120s with no event and no heartbeat', () => {
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - STALL_SILENCE_MS,
          lastHeartbeatAt: null,
        }),
      ),
    ).toBe('maybe_stalled')
  })

  it('a stale heartbeat does not rescue a stalled run (both signals past 120s)', () => {
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - 300_000,
          lastHeartbeatAt: NOW - STALL_SILENCE_MS,
        }),
      ),
    ).toBe('maybe_stalled')
  })

  it('uses the freshest of event/heartbeat for the stall decision', () => {
    // Heartbeat is older than the event; the event is the freshest signal and
    // is just inside the window.
    expect(
      deriveRunState(
        inputs({
          lastEventAt: NOW - (STALL_SILENCE_MS - 1000),
          lastHeartbeatAt: NOW - 400_000,
        }),
      ),
    ).toBe('thinking')
  })

  it('falls back to soft thinking when running with no recorded signal at all (hydration edge)', () => {
    expect(deriveRunState(inputs({ lastEventAt: null, lastHeartbeatAt: null }))).toBe('thinking')
  })
})

describe('deriveRunState — approval supersedes liveness math', () => {
  it('waiting_approval beats working (a fresh event does not hide the gate)', () => {
    expect(deriveRunState(inputs({ hasPendingApproval: true, lastEventAt: NOW }))).toBe(
      'waiting_approval',
    )
  })

  it('waiting_approval beats thinking and maybe_stalled (the run is paused on YOU)', () => {
    expect(
      deriveRunState(
        inputs({
          hasPendingApproval: true,
          lastEventAt: NOW - 60_000,
        }),
      ),
    ).toBe('waiting_approval')
    expect(
      deriveRunState(
        inputs({
          hasPendingApproval: true,
          lastEventAt: NOW - 600_000,
          lastHeartbeatAt: null,
        }),
      ),
    ).toBe('waiting_approval')
  })
})

describe('deriveRunState — offline', () => {
  it('a terminally disconnected socket reads offline regardless of timestamps', () => {
    expect(deriveRunState(inputs({ connection: 'disconnected', lastEventAt: NOW }))).toBe('offline')
  })

  it('offline beats waiting_approval (we cannot even carry the answer)', () => {
    expect(deriveRunState(inputs({ connection: 'disconnected', hasPendingApproval: true }))).toBe(
      'offline',
    )
  })

  it('a calm transient reconnect does NOT read offline (it stays in liveness math)', () => {
    expect(deriveRunState(inputs({ connection: 'reconnecting', lastEventAt: NOW }))).toBe('working')
  })

  it('returns null while disconnected with no run (the existing offline surfaces own that)', () => {
    expect(deriveRunState(inputs({ runStatus: 'idle', connection: 'disconnected' }))).toBeNull()
  })
})

describe('lastSignalAt', () => {
  it('returns the freshest of the two signals', () => {
    expect(lastSignalAt({ lastEventAt: NOW - 50, lastHeartbeatAt: NOW - 10 })).toBe(NOW - 10)
    expect(lastSignalAt({ lastEventAt: NOW - 10, lastHeartbeatAt: NOW - 50 })).toBe(NOW - 10)
  })

  it('returns null when neither signal has been observed (never fabricate a time)', () => {
    expect(lastSignalAt({ lastEventAt: null, lastHeartbeatAt: null })).toBeNull()
  })
})

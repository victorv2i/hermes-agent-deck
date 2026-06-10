import { describe, it, expect } from 'vitest'
import { isFailedSession, isHandedOffSession, sessionStateIndicator } from './sessionStatus'

describe('sessionStatus classifier', () => {
  it('treats running/completed/normal as nothing to surface', () => {
    expect(
      sessionStateIndicator({
        status: 'completed',
        end_reason: 'completed',
        handoff_state: 'none',
      }),
    ).toBeNull()
    expect(
      sessionStateIndicator({ status: 'running', end_reason: null, handoff_state: null }),
    ).toBeNull()
    expect(
      sessionStateIndicator({ status: null, end_reason: null, handoff_state: null }),
    ).toBeNull()
  })

  it('flags an errored/failed session via status OR end_reason', () => {
    expect(isFailedSession({ status: 'failed', end_reason: null })).toBe(true)
    expect(isFailedSession({ status: null, end_reason: 'error' })).toBe(true)
    expect(isFailedSession({ status: 'ERRORED', end_reason: null })).toBe(true)
    expect(isFailedSession({ status: 'completed', end_reason: 'completed' })).toBe(false)
    expect(
      sessionStateIndicator({ status: 'failed', end_reason: null, handoff_state: 'none' }),
    ).toEqual({
      kind: 'failed',
      label: 'Session failed',
    })
  })

  it('flags a handed-off session for any non-normal handoff_state', () => {
    expect(isHandedOffSession({ handoff_state: 'handed_off' })).toBe(true)
    expect(isHandedOffSession({ handoff_state: 'delegated' })).toBe(true)
    expect(isHandedOffSession({ handoff_state: 'none' })).toBe(false)
    expect(isHandedOffSession({ handoff_state: null })).toBe(false)
    expect(isHandedOffSession({ handoff_state: '' })).toBe(false)
    expect(
      sessionStateIndicator({ status: 'completed', end_reason: null, handoff_state: 'handed_off' }),
    ).toEqual({
      kind: 'handoff',
      label: 'Session handed off',
    })
  })

  it('prefers the failure marker when a session both handed off AND failed', () => {
    expect(
      sessionStateIndicator({ status: 'failed', end_reason: 'error', handoff_state: 'handed_off' }),
    ).toEqual({ kind: 'failed', label: 'Session failed' })
  })
})

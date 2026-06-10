import { describe, it, expect } from 'vitest'
import {
  CONNECTIONS_TAB_IDS,
  DEFAULT_CONNECTIONS_TAB,
  isConnectionsTab,
  resolveConnectionsTab,
} from './connectionsTabs'

describe('connectionsTabs', () => {
  it('lists all six tabs, in order (Voice · Messaging · MCP · Pairing · Webhooks · Credentials)', () => {
    expect([...CONNECTIONS_TAB_IDS]).toEqual([
      'voice',
      'messaging',
      'mcp',
      'pairing',
      'webhooks',
      'credentials',
    ])
    expect(DEFAULT_CONNECTIONS_TAB).toBe('voice')
  })

  it('isConnectionsTab gates only the real ids', () => {
    expect(isConnectionsTab('voice')).toBe(true)
    expect(isConnectionsTab('mcp')).toBe(true)
    expect(isConnectionsTab('pairing')).toBe(true)
    expect(isConnectionsTab('webhooks')).toBe(true)
    expect(isConnectionsTab('credentials')).toBe(true)
    expect(isConnectionsTab('bogus')).toBe(false)
    expect(isConnectionsTab(null)).toBe(false)
  })

  it('resolveConnectionsTab returns the id when valid, else the default', () => {
    expect(resolveConnectionsTab('messaging')).toBe('messaging')
    expect(resolveConnectionsTab('pairing')).toBe('pairing')
    expect(resolveConnectionsTab('webhooks')).toBe('webhooks')
    expect(resolveConnectionsTab('credentials')).toBe('credentials')
    // Garbage + missing both fall back to the first tab (so /connections alone,
    // or a stale ?tab=, never lands on a broken/empty panel).
    expect(resolveConnectionsTab('nope')).toBe('voice')
    expect(resolveConnectionsTab(null)).toBe('voice')
  })
})

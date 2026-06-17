import { describe, it, expect } from 'vitest'
import { buildRunReceipt, receiptBillingSegment, receiptLine, receiptTitle } from './runReceipt'

const USAGE = { input_tokens: 64321, output_tokens: 1234, total_tokens: 65555 }

describe('buildRunReceipt', () => {
  it('returns null when the run carried no usage – honest absence, never zeros', () => {
    expect(buildRunReceipt(undefined, 'subscription')).toBeNull()
  })

  it('builds an exact run_event receipt from the gateway usage payload', () => {
    const receipt = buildRunReceipt(USAGE, 'subscription')
    expect(receipt).toMatchObject({
      inputTokens: 64321,
      outputTokens: 1234,
      billingMode: 'subscription',
      source: 'run_event',
    })
  })

  it('always carries a NULL cost: no per-run dollar exists on the hermes wire', () => {
    expect(buildRunReceipt(USAGE, 'metered')?.estCostUsd).toBeNull()
    expect(buildRunReceipt(USAGE, 'subscription')?.estCostUsd).toBeNull()
  })

  it('degrades a missing or out-of-set billing signal to unknown – never invents free', () => {
    expect(buildRunReceipt(USAGE)?.billingMode).toBe('unknown')
    expect(buildRunReceipt(USAGE, 'included')?.billingMode).toBe('unknown')
  })
})

describe('receiptLine + receiptBillingSegment', () => {
  it('renders the spec line for subscription usage', () => {
    const receipt = buildRunReceipt(USAGE, 'subscription')!
    expect(receiptLine(receipt)).toBe('64.3K in / 1.2K out / included (subscription)')
  })

  it('renders metered usage without fabricated dollars', () => {
    const receipt = buildRunReceipt(USAGE, 'metered')!
    expect(receiptLine(receipt)).toBe('64.3K in / 1.2K out / billed per use')
  })

  it('renders real dollars only when a per-run cost actually exists', () => {
    const receipt = { ...buildRunReceipt(USAGE, 'metered')!, estCostUsd: 0.42 }
    expect(receiptBillingSegment(receipt)).toBe('$0.42')
  })

  it('says no billed cost for a local/unpriced model', () => {
    const receipt = buildRunReceipt(USAGE, 'local')!
    expect(receiptLine(receipt)).toBe('64.3K in / 1.2K out / no billed cost')
  })

  it('omits the billing segment entirely when the mode is unknown', () => {
    const receipt = buildRunReceipt(USAGE)!
    expect(receiptLine(receipt)).toBe('64.3K in / 1.2K out')
  })
})

describe('receiptTitle', () => {
  it('carries the exact numbers and the run_event source note', () => {
    const title = receiptTitle(buildRunReceipt(USAGE, 'subscription')!)
    expect(title).toContain('64,321 input tokens')
    expect(title).toContain('1,234 output tokens')
    expect(title).toContain('Measured for this run')
    expect(title).toContain('flat subscription')
  })

  it('labels a session_delta receipt as session growth, never an exact run cost', () => {
    const receipt = { ...buildRunReceipt(USAGE, 'unknown')!, source: 'session_delta' as const }
    expect(receiptTitle(receipt)).toContain('Session growth during this run')
  })
})

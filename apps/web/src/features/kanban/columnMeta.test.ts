import { describe, it, expect } from 'vitest'
import { KANBAN_COLUMNS } from '@agent-deck/protocol'
import { COLUMN_META, TONE_DOT_CLASS } from './columnMeta'

describe('COLUMN_META', () => {
  it('has a label + tone for every governed column (plus archived)', () => {
    for (const name of [...KANBAN_COLUMNS, 'archived'] as const) {
      const meta = COLUMN_META[name]
      expect(meta).toBeDefined()
      expect(meta.label.length).toBeGreaterThan(0)
      expect(TONE_DOT_CLASS[meta.tone]).toBeDefined()
    }
  })

  it('uses plain-language labels — no technical jargon in the column headings', () => {
    // "Triage" is jargon; the plain label is "Incoming" so a non-technical user
    // understands at a glance that this is where new tasks arrive.
    expect(COLUMN_META['triage'].label).toBe('Incoming')
  })

  it('reserves the action accent for the live (running) lane only', () => {
    // Governance: --primary (the `live` tone) is the running column's marker and
    // NOT used by any resting column.
    const liveColumns = KANBAN_COLUMNS.filter((c) => COLUMN_META[c].tone === 'live')
    expect(liveColumns).toEqual(['running'])
  })

  it('maps every tone to a token-driven class (no raw hex)', () => {
    for (const cls of Object.values(TONE_DOT_CLASS)) {
      expect(cls).toMatch(/^bg-/)
      expect(cls).not.toMatch(/#/)
    }
  })
})

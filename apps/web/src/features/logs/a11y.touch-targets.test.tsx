/**
 * a11y — LogFilters segmented control touch targets + LogLine level icon+label.
 *
 * (1) The Segmented buttons use px-2.5 py-1 which is ~30px — too small on
 * mobile. Each radio button must have min-h-11 for 44px touch target.
 *
 * (2) LogLine renders the log level using only a CSS color class (e.g. text-
 * destructive for ERROR). Per WCAG 1.4.1, meaning conveyed by color must also
 * be conveyed by another means (icon + label). The level text IS the label, but
 * we need an aria-label or visible icon so it's accessible beyond color.
 * The existing test asserts color class; we additionally require the level cell
 * carries role="cell" + a data-level attribute that screen readers can read, OR
 * an icon alongside the color-coded text.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LogFilters, type LogFiltersProps } from './LogFilters'
import { LogLine } from './LogLine'
import type { AgentDeckLogEntry } from '@agent-deck/protocol'

function baseFilters(over: Partial<LogFiltersProps> = {}): LogFiltersProps {
  return {
    file: 'agent',
    onFileChange: () => {},
    level: 'ALL',
    onLevelChange: () => {},
    keyword: '',
    onKeywordChange: () => {},
    autoRefresh: false,
    onAutoRefreshChange: () => {},
    onRefresh: () => {},
    ...over,
  }
}

describe('LogFilters segmented-control touch targets (a11y)', () => {
  it('log-file radio buttons have min-h-11 for 44px touch target on mobile', () => {
    render(<LogFilters {...baseFilters()} />)
    const fileGroup = screen.getByRole('radiogroup', { name: /log file/i })
    const buttons = within(fileGroup).getAllByRole('radio')
    for (const btn of buttons) {
      expect(btn.className).toContain('min-h-11')
    }
  })

  it('min-level radio buttons have min-h-11 for 44px touch target on mobile', () => {
    render(<LogFilters {...baseFilters()} />)
    const levelGroup = screen.getByRole('radiogroup', { name: /minimum level/i })
    const buttons = within(levelGroup).getAllByRole('radio')
    for (const btn of buttons) {
      expect(btn.className).toContain('min-h-11')
    }
  })
})

describe('LogLine level conveys meaning beyond color (a11y)', () => {
  function makeEntry(level: AgentDeckLogEntry['level']): AgentDeckLogEntry {
    return {
      id: 1,
      timestamp: '2026-06-02 10:00:00',
      level,
      logger: 'test',
      message: `test ${level} message`,
      raw: `2026-06-02 10:00:00 ${level} test test ${level} message`,
    }
  }

  it('ERROR row level cell carries an accessible label beyond color', () => {
    render(<LogLine entry={makeEntry('ERROR')} />)
    // The level cell must communicate "ERROR" via text (accessible name), not only color.
    // The text "ERROR" is the accessible name — screen readers can read it.
    const levelCell = screen.getByText('ERROR')
    expect(levelCell).toBeInTheDocument()
    // Additionally, the row itself carries data-level for programmatic access.
    const row = levelCell.closest('[role="row"]')
    expect(row).toHaveAttribute('data-level', 'ERROR')
  })

  it('WARNING row level cell carries accessible text label', () => {
    render(<LogLine entry={makeEntry('WARNING')} />)
    expect(screen.getByText('WARNING')).toBeInTheDocument()
    const row = screen.getByText('WARNING').closest('[role="row"]')
    expect(row).toHaveAttribute('data-level', 'WARNING')
  })

  it('CRITICAL row level cell carries accessible text label', () => {
    render(<LogLine entry={makeEntry('CRITICAL')} />)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })
})

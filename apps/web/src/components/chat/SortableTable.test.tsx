/**
 * SortableTable unit tests — type-aware, tri-state column sorting driven from the
 * parsed GFM-table hast node. Covers numeric vs lexical ordering, the
 * none -> ascending -> descending -> none cycle, and the aria-sort / a11y
 * contract for the header buttons.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { SortableTable } from './SortableTable'
import type { TableHastNode } from './SortableTable'

/**
 * Build a minimal GFM-table hast node (the shape react-markdown hands the
 * `table` component override) from a header row + body rows of plain strings.
 */
function tableNode(headers: string[], rows: string[][]): TableHastNode {
  const cell = (tagName: 'th' | 'td', text: string): TableHastNode =>
    ({ type: 'element', tagName, children: [{ type: 'text', value: text }] }) as TableHastNode
  const row = (tagName: 'th' | 'td', cells: string[]): TableHastNode =>
    ({
      type: 'element',
      tagName: 'tr',
      children: cells.map((c) => cell(tagName, c)),
    }) as TableHastNode
  return {
    type: 'element',
    tagName: 'table',
    children: [
      { type: 'element', tagName: 'thead', children: [row('th', headers)] } as TableHastNode,
      {
        type: 'element',
        tagName: 'tbody',
        children: rows.map((r) => row('td', r)),
      } as TableHastNode,
    ],
  } as TableHastNode
}

/** Read the visible body-row order, first column, top to bottom. */
function firstColumn(): string[] {
  const table = screen.getByRole('table')
  const bodyRows = within(table)
    .getAllByRole('row')
    // Drop the header row (it contains a columnheader, body rows contain cells).
    .filter((r) => within(r).queryAllByRole('cell').length > 0)
  return bodyRows.map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '')
}

describe('SortableTable', () => {
  it('renders the parsed table with header buttons and document-order rows', () => {
    render(
      <SortableTable
        node={tableNode(
          ['Name', 'Score'],
          [
            ['Bravo', '2'],
            ['Alpha', '10'],
            ['Charlie', '1'],
          ],
        )}
      />,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Each header is a real button so it is keyboard operable.
    expect(screen.getByRole('button', { name: /Name/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Score/ })).toBeInTheDocument()
    // Original document order, untouched.
    expect(firstColumn()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('starts every header with aria-sort="none"', () => {
    render(<SortableTable node={tableNode(['Name'], [['b'], ['a']])} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts a lexical column none -> ascending -> descending -> none on repeated clicks', () => {
    render(<SortableTable node={tableNode(['Name'], [['Bravo'], ['Alpha'], ['Charlie']])} />)
    const header = screen.getByRole('columnheader')
    const btn = within(header).getByRole('button')

    fireEvent.click(btn) // ascending
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(firstColumn()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    fireEvent.click(btn) // descending
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(firstColumn()).toEqual(['Charlie', 'Bravo', 'Alpha'])

    fireEvent.click(btn) // back to document order
    expect(header).toHaveAttribute('aria-sort', 'none')
    expect(firstColumn()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('sorts an all-numeric column NUMERICALLY, not lexically', () => {
    render(<SortableTable node={tableNode(['N'], [['2'], ['10'], ['1']])} />)
    const btn = within(screen.getByRole('columnheader')).getByRole('button')

    fireEvent.click(btn) // ascending — numeric: 1, 2, 10 (lexical would give 1, 10, 2)
    expect(firstColumn()).toEqual(['1', '2', '10'])

    fireEvent.click(btn) // descending — 10, 2, 1
    expect(firstColumn()).toEqual(['10', '2', '1'])
  })

  it('keeps WHOLE rows together when sorting by a column', () => {
    render(
      <SortableTable
        node={tableNode(
          ['Name', 'Score'],
          [
            ['Bravo', '2'],
            ['Alpha', '10'],
            ['Charlie', '1'],
          ],
        )}
      />,
    )
    // Sort by the numeric Score column ascending: 1, 2, 10 -> Charlie, Bravo, Alpha.
    fireEvent.click(screen.getByRole('button', { name: /Score/ }))
    expect(firstColumn()).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('only one column carries a non-none aria-sort at a time', () => {
    render(
      <SortableTable
        node={tableNode(
          ['A', 'B'],
          [
            ['2', 'x'],
            ['1', 'y'],
          ],
        )}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A/ }))
    fireEvent.click(screen.getByRole('button', { name: /B/ }))
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveAttribute('aria-sort', 'none')
    expect(headers[1]).toHaveAttribute('aria-sort', 'ascending')
  })

  it('names a blank header button positionally so it is never nameless', () => {
    render(<SortableTable node={tableNode(['Name', ''], [['a', '1']])} />)
    // The empty second header still exposes a usable accessible name.
    const blank = screen.getByRole('button', { name: 'Sort column 2' })
    expect(blank).toBeInTheDocument()
    // Non-empty headers keep their text name — no positional override leaks in.
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sort column 1' })).not.toBeInTheDocument()
    // The positional name still drives sorting like any other header.
    fireEvent.click(blank)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[1]).toHaveAttribute('aria-sort', 'ascending')
  })

  it('gives each header button a focus-visible ring (focusable, keyboard operable)', () => {
    render(<SortableTable node={tableNode(['Name'], [['a']])} />)
    const btn = within(screen.getByRole('columnheader')).getByRole('button')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toMatch(/focus-visible:ad-focus/)
    // Keyboard activation goes through the native button click (Enter/Space).
    fireEvent.click(btn)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })
})

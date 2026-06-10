import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Sortable rendering for GFM markdown tables in chat prose.
 *
 * react-markdown's `table` component override hands us the parsed hast `node`
 * (the full <table> subtree with text). We reconstruct the table from that node
 * — header labels + body cells as React children — and make each column header a
 * real <button> that cycles the column through three states on click/keyboard:
 *
 *   none -> ascending -> descending -> none (original document order)
 *
 * Sort is TYPE-AWARE: a column whose every body cell parses as a finite number
 * sorts numerically; otherwise it sorts lexically (locale-aware, case-folded).
 * Whole rows move together — we sort row indices, never individual cells.
 *
 * We render from the hast node (not the already-rendered React `children`) so we
 * own the <thead>/<th>/<button> markup for the a11y contract (aria-sort,
 * focus-visible ring, comfortable touch target) while preserving each cell's
 * inline markdown (links/code/`<strong>`) via {@link hastChildren}.
 *
 * Scope is deliberately SORT-only — no filtering — to stay lean and low-risk.
 */

/** The minimal slice of hast we read. Structural, so no `@types/hast` import. */
export interface TableHastNode {
  type: string
  tagName?: string
  value?: string
  children?: TableHastNode[]
}

type SortDir = 'none' | 'ascending' | 'descending'

/** Flatten a hast subtree to its plain text — used for the sort comparison. */
function hastText(node: TableHastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/** Find the first descendant element with the given tag name (depth-first). */
function findTag(node: TableHastNode | undefined, tag: string): TableHastNode | undefined {
  if (!node?.children) return undefined
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName === tag) return child
    const nested = findTag(child, tag)
    if (nested) return nested
  }
  return undefined
}

/** Direct element children with the given tag name. */
function childTags(node: TableHastNode | undefined, tag: string): TableHastNode[] {
  return (node?.children ?? []).filter((c) => c.type === 'element' && c.tagName === tag)
}

/**
 * Render a hast cell's inline children as React nodes, preserving the inline
 * markdown a GFM cell can carry (emphasis, inline code, links). We keep this
 * intentionally small — tables hold short cell content, not block constructs.
 */
function hastChildren(node: TableHastNode, keyPrefix: string): ReactNode {
  return (node.children ?? []).map((child, i) => {
    const key = `${keyPrefix}-${i}`
    if (child.type === 'text') return child.value
    const tag = child.tagName
    if (tag === 'br') return <br key={key} />
    const inner = hastChildren(child, key)
    if (tag === 'strong') return <strong key={key}>{inner}</strong>
    if (tag === 'em') return <em key={key}>{inner}</em>
    if (tag === 'del') return <del key={key}>{inner}</del>
    if (tag === 'code') return <code key={key}>{inner}</code>
    // Unknown inline tag (or a stripped one): render its text/children inline so
    // no content is dropped, without re-creating arbitrary elements.
    return <span key={key}>{inner}</span>
  })
}

const NUMERIC_RE = /^\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?\s*$/

/** Parse a cell's text as a number for numeric sort, or NaN if it isn't one. */
function asNumber(text: string): number {
  if (!NUMERIC_RE.test(text)) return Number.NaN
  return Number.parseFloat(text.replace(/,/g, '').replace(/%\s*$/, ''))
}

export function SortableTable({ node }: { node: TableHastNode }) {
  const { headers, rows } = useMemo(() => {
    const thead = findTag(node, 'thead')
    const headRow = findTag(thead, 'tr')
    const headerCells = childTags(headRow, 'th')
    const headers = headerCells.map((c) => ({ node: c, text: hastText(c) }))

    const tbody = findTag(node, 'tbody')
    const bodyRows = childTags(tbody, 'tr')
    const rows = bodyRows.map((tr) => childTags(tr, 'td'))
    return { headers, rows }
  }, [node])

  // Active column index + its direction. `none` means original document order.
  const [sort, setSort] = useState<{ col: number; dir: SortDir }>({ col: -1, dir: 'none' })

  // Whole-row indices in the order to render. Sorting moves rows, not cells.
  const order = useMemo(() => {
    const base = rows.map((_, i) => i)
    if (sort.col < 0 || sort.dir === 'none') return base
    const cellText = (rowIdx: number) => hastText(rows[rowIdx]?.[sort.col])
    const numeric =
      rows.length > 0 && rows.every((r) => !Number.isNaN(asNumber(hastText(r[sort.col]))))
    const sorted = [...base].sort((a, b) => {
      if (numeric) return asNumber(cellText(a)) - asNumber(cellText(b))
      return cellText(a).localeCompare(cellText(b), undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    })
    if (sort.dir === 'descending') sorted.reverse()
    return sorted
  }, [rows, sort])

  const onHeaderClick = (col: number) => {
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: 'ascending' }
      const next: SortDir =
        prev.dir === 'none' ? 'ascending' : prev.dir === 'ascending' ? 'descending' : 'none'
      return { col, dir: next }
    })
  }

  return (
    <table>
      <thead>
        <tr>
          {headers.map((h, col) => {
            const dir: SortDir = sort.col === col ? sort.dir : 'none'
            const Icon =
              dir === 'ascending' ? ArrowUp : dir === 'descending' ? ArrowDown : ChevronsUpDown
            return (
              <th key={col} aria-sort={dir} className="!p-0">
                <button
                  type="button"
                  onClick={() => onHeaderClick(col)}
                  // A blank GFM header cell renders no text, so the button would be
                  // nameless (aria-sort labels the state, not the control). Fall back
                  // to a positional name; non-empty headers keep their text name.
                  aria-label={h.text.trim() ? undefined : `Sort column ${col + 1}`}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-1.5 px-3 py-2 text-left font-semibold',
                    'rounded-[6px] transition-colors hover:bg-foreground/5 focus-visible:ad-focus sm:min-h-9',
                    dir !== 'none' && 'text-primary',
                  )}
                >
                  <span>{hastChildren(h.node, `h${col}`)}</span>
                  <Icon
                    className={cn('size-3.5 shrink-0', dir === 'none' && 'opacity-40')}
                    aria-hidden="true"
                  />
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {order.map((rowIdx) => {
          const row = rows[rowIdx]
          if (!row) return null
          return (
            <tr key={rowIdx}>
              {row.map((cell, col) => (
                <td key={col}>{hastChildren(cell, `r${rowIdx}c${col}`)}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

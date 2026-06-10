import { describe, it, expect } from 'vitest'
import { applyFindHighlight } from './markdownHighlight'

/**
 * Minimal HAST node builders for the unit tests. We test the transform directly
 * against trees (no react-markdown), so it stays fast and deterministic.
 */
type TestNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: TestNode[]
}

function text(value: string): TestNode {
  return { type: 'text', value }
}
function el(
  tagName: string,
  children: TestNode[],
  properties: Record<string, unknown> = {},
): TestNode {
  return { type: 'element', tagName, properties, children }
}
function root(children: TestNode[]): TestNode {
  return { type: 'root', children }
}

/** Collect every <mark> element's text content, in document order. */
function marks(node: TestNode): string[] {
  const out: string[] = []
  const walk = (n: TestNode) => {
    if (n.type === 'element' && n.tagName === 'mark') {
      out.push(textOf(n))
    }
    n.children?.forEach(walk)
  }
  walk(node)
  return out
}
function textOf(node: TestNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

describe('applyFindHighlight', () => {
  it('wraps each case-insensitive match in a <mark> and preserves surrounding text', () => {
    const tree = root([el('p', [text('The Agent ran a tool, then the agent rested')])])
    applyFindHighlight(tree as never, { query: 'agent' })
    expect(marks(tree)).toEqual(['Agent', 'agent'])
    // The full text content is preserved verbatim around the marks.
    expect(textOf(tree)).toBe('The Agent ran a tool, then the agent rested')
  })

  it('marks the active turn with bg-primary/30 and others with a neutral tint', () => {
    const activeTree = root([el('p', [text('find me')])])
    applyFindHighlight(activeTree as never, { query: 'find', active: true })
    const collectMark = (n: TestNode): TestNode | null => {
      if (n.type === 'element' && n.tagName === 'mark') return n
      for (const c of n.children ?? []) {
        const found = collectMark(c)
        if (found) return found
      }
      return null
    }
    const activeMark = collectMark(activeTree)
    expect(String(activeMark?.properties?.className)).toContain('bg-primary/30')

    const idleTree = root([el('p', [text('find me')])])
    applyFindHighlight(idleTree as never, { query: 'find', active: false })
    const idleMark = collectMark(idleTree)
    expect(String(idleMark?.properties?.className)).toContain('bg-foreground/15')
  })

  it('does NOT descend into code or pre (code fences stay intact)', () => {
    const tree = root([
      el('p', [text('call the run function')]),
      el('pre', [el('code', [text('run()')], { className: ['language-ts'] })]),
      el('p', [el('code', [text('run')])]),
    ])
    applyFindHighlight(tree as never, { query: 'run' })
    // Only the prose 'run' is marked; the two code 'run's are untouched.
    expect(marks(tree)).toEqual(['run'])
  })

  it('does NOT descend into KaTeX (math) subtrees', () => {
    const tree = root([
      el('p', [
        text('the sum '),
        el('span', [el('span', [text('sum')], { className: ['mord'] })], {
          className: ['katex'],
        }),
        text(' of sum'),
      ]),
    ])
    applyFindHighlight(tree as never, { query: 'sum' })
    // The two prose 'sum's are marked; the one inside .katex is left alone.
    expect(marks(tree)).toEqual(['sum', 'sum'])
  })

  it('does NOT descend into links (anchor text is left intact)', () => {
    const tree = root([
      el('p', [text('open the docs'), el('a', [text('docs')], { href: 'https://x' })]),
    ])
    applyFindHighlight(tree as never, { query: 'docs' })
    // Only the prose 'docs' is marked; the anchor text is untouched.
    expect(marks(tree)).toEqual(['docs'])
  })

  it('does NOT nest marks inside an existing <mark>', () => {
    const tree = root([el('mark', [text('agent')])])
    applyFindHighlight(tree as never, { query: 'agent' })
    expect(marks(tree)).toEqual(['agent'])
  })

  it('is a no-op for an empty / whitespace query (tree unchanged, no marks)', () => {
    const tree = root([el('p', [text('nothing to mark here')])])
    applyFindHighlight(tree as never, { query: '   ' })
    expect(marks(tree)).toEqual([])
    expect(textOf(tree)).toBe('nothing to mark here')
  })

  it('handles a match at the very start and very end of a text node', () => {
    const tree = root([el('p', [text('runrun and run')])])
    applyFindHighlight(tree as never, { query: 'run' })
    expect(marks(tree)).toEqual(['run', 'run', 'run'])
    expect(textOf(tree)).toBe('runrun and run')
  })
})

/**
 * Find-in-conversation highlighter for assistant PROSE (rehype-style HAST
 * transform). The user-turn highlighter wraps matches in <mark> at the React
 * level (Message.tsx `HighlightText`); assistant turns render through
 * react-markdown, so we wrap matches in the HAST tree instead — after the
 * markdown/KaTeX passes have produced their final element tree.
 *
 * Hard constraints (why this is a tree walk and not a string replace):
 *  - NEVER touch fenced/inline code — descending into `code`/`pre` would corrupt
 *    a code block by splicing <mark> elements into it.
 *  - NEVER touch KaTeX output — rehype-katex emits `<span class="katex">…</span>`
 *    whose inner structure is load-bearing; a stray <mark> breaks the render.
 *  - NEVER touch link (`<a>`) text — leave anchors intact so PreviewLink's
 *    click/keyboard wiring is undisturbed.
 *  - NEVER nest a <mark> inside an existing <mark>.
 * Matches are case-insensitive and literal (the needle is matched verbatim, so a
 * query like `a.b` matches the substring `a.b`, never a regex).
 *
 * Mirrors the user-turn mark styling: the ACTIVE turn's marks read with the
 * accent (`bg-primary/30` — an active marker is an allowed accent use); other
 * matched turns use a neutral tint (`bg-foreground/15`) so the column stays calm.
 */

/** The slice of HAST we touch. Structural so we need no `@types/hast` import. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** Tags whose subtrees we must not descend into (their text is off-limits). */
const SKIP_TAGS = new Set(['code', 'pre', 'a', 'mark', 'script', 'style'])

/** className tokens marking a KaTeX subtree we must leave untouched. */
const KATEX_CLASSES = new Set(['katex', 'katex-display', 'math', 'math-inline', 'math-display'])

function classList(node: HastNode): string[] {
  const cn = node.properties?.className
  if (Array.isArray(cn)) return cn.map(String)
  if (typeof cn === 'string') return cn.split(/\s+/)
  return []
}

function isKatex(node: HastNode): boolean {
  return classList(node).some((c) => KATEX_CLASSES.has(c))
}

/** Build a <mark> element wrapping `value`, styled to match the user-turn marks. */
function makeMark(value: string, active: boolean): HastNode {
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      className: `rounded-[3px] text-foreground ${active ? 'bg-primary/30' : 'bg-foreground/15'}`,
    },
    children: [{ type: 'text', value }],
  }
}

/**
 * Split a text node's value on every case-insensitive occurrence of `needle`,
 * returning the replacement nodes (plain text + <mark> spans). Returns null when
 * there is no match, so the caller can leave the node untouched.
 */
function splitTextNode(value: string, needle: string, active: boolean): HastNode[] | null {
  const hay = value.toLowerCase()
  let from = 0
  let at = hay.indexOf(needle)
  if (at === -1) return null
  const out: HastNode[] = []
  while (at !== -1) {
    if (at > from) out.push({ type: 'text', value: value.slice(from, at) })
    out.push(makeMark(value.slice(at, at + needle.length), active))
    from = at + needle.length
    at = hay.indexOf(needle, from)
  }
  if (from < value.length) out.push({ type: 'text', value: value.slice(from) })
  return out
}

export interface FindHighlightOptions {
  /** The find query. Empty / whitespace-only → the transform is a no-op. */
  query?: string
  /** Whether THIS turn carries the active match (its marks read as accent). */
  active?: boolean
}

/**
 * Wrap query matches in the assistant prose HAST tree in <mark>, honoring every
 * skip rule above. Pure and mutates `tree` in place. With no (or a blank) query
 * it returns immediately so a non-find render is byte-identical to the bare
 * markdown output. Directly unit-testable against a HAST tree.
 */
export function applyFindHighlight(tree: HastNode, options: FindHighlightOptions): void {
  const needle = options.query?.trim().toLowerCase() ?? ''
  const active = options.active ?? false
  if (needle.length === 0) return
  visit(tree)

  function visit(node: HastNode): void {
    const children = node.children
    if (!children || children.length === 0) return
    const next: HastNode[] = []
    for (const child of children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const replaced = splitTextNode(child.value, needle, active)
        if (replaced) next.push(...replaced)
        else next.push(child)
        continue
      }
      if (child.type === 'element') {
        const tag = child.tagName ?? ''
        // Don't descend into code/pre/anchors/existing-marks or KaTeX subtrees —
        // their text is off-limits. Keep the node verbatim.
        if (!SKIP_TAGS.has(tag) && !isKatex(child)) visit(child)
        next.push(child)
        continue
      }
      next.push(child)
    }
    node.children = next
  }
}

/**
 * Rehype plugin (a unified attacher): bind the find options and return a
 * transformer that runs {@link applyFindHighlight} over the prose tree. Pass to
 * react-markdown's `rehypePlugins` AFTER rehype-katex so the math/code element
 * tree exists and its subtrees can be skipped. A blank query yields a no-op
 * transformer.
 */
export function rehypeFindHighlight(options: FindHighlightOptions) {
  return () => (tree: HastNode) => applyFindHighlight(tree, options)
}

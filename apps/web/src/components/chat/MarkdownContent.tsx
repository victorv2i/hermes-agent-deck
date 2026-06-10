import { type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
// KaTeX's stylesheet ships HERE (the lazy markdown chunk), not in index.css, so
// the ~7.5kB-gz of math CSS stays off the critical path — it only downloads with
// this lazy chunk the first time an assistant message renders. The `.ad-prose
// .katex` color/margin overrides in index.css compose on top once it loads.
import 'katex/dist/katex.min.css'
import { CodeBlock } from './CodeBlock'
import { Mermaid } from './Mermaid'
import { rehypeFindHighlight } from './markdownHighlight'
import { SortableTable, type TableHastNode } from './SortableTable'
import { ChatImage } from './ChatImage'
import { MediaEmbed } from './MediaEmbed'

/**
 * The chat's prose renderer — react-markdown + remark-gfm (tables, task lists,
 * strikethrough) + remark-math + rehype-katex (math). Fenced code routes to
 * <CodeBlock> (lazy Shiki + copy) and ```mermaid to <Mermaid> (lazy,
 * error-boundaried).
 *
 * This whole module — the markdown parser AND KaTeX — is itself lazy-loaded by
 * the `Markdown.tsx` wrapper (React.lazy), so none of it ships in the main
 * bundle; Shiki and Mermaid are then a second lazy hop inside the leaf
 * components. Prose styling (1.7 line-height, ~68ch measure, styled
 * tables/lists/blockquotes/links) is applied by the wrapping `.ad-prose` class
 * (see index.css), not Tailwind Typography, so we control every token against
 * the warm-void palette.
 */

/**
 * Pull the raw text, language, and optional filename out of a fenced-code
 * `pre > code` subtree.
 *
 * react-markdown passes the raw info string (the text after the opening ```)
 * via the `data-meta` attribute when the `code` element has a `className` of
 * `language-<lang>`. A fence like:
 *
 *   ```typescript src/index.ts
 *   const x = 1
 *   ```
 *
 * becomes `<code class="language-typescript" data-meta="src/index.ts">…</code>`.
 * We split on the first whitespace: everything before is the lang, everything
 * after is the filename. When there is no space the lang is the full class part
 * and filename is undefined.
 */
function extractCode(
  children: ReactNode,
): { code: string; lang?: string; filename?: string } | null {
  // react-markdown renders a fenced block as <pre><code class="language-x">…</code></pre>.
  const child = Array.isArray(children) ? children[0] : children
  if (
    child == null ||
    typeof child !== 'object' ||
    !('props' in child) ||
    typeof (child as { props?: unknown }).props !== 'object'
  ) {
    return null
  }
  const props = (
    child as { props: { className?: string; 'data-meta'?: string; children?: ReactNode } }
  ).props
  const classMatch = /language-([\w-]+)/.exec(props.className ?? '')
  const lang = classMatch?.[1]
  // The info string remainder after the language identifier lives in data-meta.
  const meta = props['data-meta']?.trim() ?? ''
  const filename = meta.length > 0 ? meta : undefined
  const code = toText(props.children).replace(/\n$/, '')
  return { code, lang, filename }
}

function toText(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return toText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

/**
 * Lift `$$…$$` display-math fences onto their own block so remark-math renders
 * them as CENTERED `.katex-display` blocks instead of left-aligned inline math.
 *
 * Streamed assistant deltas almost never place the `$$` delimiters on their own
 * lines (they arrive as `…relation $$E = mc^2$$ is famous.`), and remark-math only
 * treats `$$` as display math when each fence sits on its own line. We rewrite
 * each balanced `$$…$$` span so its delimiters get surrounded by newlines —
 * promoting it to a display block — while leaving fenced code untouched (so a
 * `$$` inside a ``` block is never rewritten) and leaving inline `$…$` alone.
 * Already-block `$$` (delimiters already on their own lines) is unchanged.
 */
function normalizeDisplayMath(src: string): string {
  if (!src.includes('$$')) return src
  // Split out fenced code spans so their contents are never rewritten, then
  // normalize only the prose segments between them.
  const segments = src.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
  return segments
    .map((seg, i) => {
      // Odd indices are the captured fenced-code blocks — leave them verbatim.
      if (i % 2 === 1) return seg
      // Surround each balanced `$$…$$` span with newlines so each delimiter ends
      // up alone on its line (the trailing collapse below squashes any doubles),
      // which is what remark-math needs to emit a display block.
      return seg.replace(
        /\$\$([\s\S]+?)\$\$/g,
        (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`,
      )
    })
    .join('')
}

const components: Components = {
  // Block code is delivered via <pre>; intercept here so we own the whole card.
  pre({ children }) {
    const extracted = extractCode(children)
    if (!extracted) return <pre>{children}</pre>
    if (extracted.lang === 'mermaid') return <Mermaid source={extracted.code} />
    return <CodeBlock code={extracted.code} lang={extracted.lang} filename={extracted.filename} />
  },
  // Inline code only (block code is consumed by `pre` above).
  code({ className, children }) {
    return (
      <code
        className={
          'rounded-[5px] bg-muted/70 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground ' +
          (className ?? '')
        }
      >
        {children}
      </code>
    )
  },
  // Agent-rendered links route through MediaEmbed: a link whose target is an
  // audio/video file is embedded inline with native controls; everything else
  // passes straight through to PreviewLink (Preview-panel open on plain click,
  // native new-tab escape, plain anchor for mailto:/anchors/relative paths) —
  // exactly as before, so non-media link behavior is unchanged.
  a({ href, children }) {
    return <MediaEmbed href={href}>{children}</MediaEmbed>
  },
  // Agent-rendered markdown images (`![alt](src)`): a constrained, rounded,
  // lazily-loaded thumbnail that enlarges in the lightbox, with an honest link
  // fallback when the source can't load (never a broken-image glyph). Additive —
  // it doesn't touch table/code/katex/mermaid/link rendering.
  img({ src, alt }) {
    if (typeof src !== 'string' || src === '') return null
    return <ChatImage src={src} alt={alt ?? ''} />
  },
  // GFM tables become column-SORTABLE: we own the whole <table> from the parsed
  // hast `node` so each header is a real <button> with aria-sort (none ->
  // ascending -> descending -> document order), keyboard-operable, type-aware.
  // Every other markdown construct is untouched (this only intercepts `table`).
  table({ node }) {
    return <SortableTable node={node as unknown as TableHastNode} />
  },
}

// Agent prose can carry an inline RASTER data: image (a generated chart, say).
// react-markdown's default sanitizer strips ALL `data:` URLs, so such an image
// would show only the broken-image link fallback. Allow the same safe raster MIME
// set the gateway accepts (never svg/html — those can carry script) through, and
// only for an <img> `src`; every link `href`, every other scheme, and every other
// `src`-bearing tag still goes through the strict default, so `javascript:` /
// `data:text/html` stay neutralized. Scoping to the `img` tagName (not just any
// `src` attribute, which html-url-attributes also maps to script/iframe/source/…)
// keeps the relaxation image-only even if a raw-HTML plugin is ever added: there
// is no rehype-raw in this render path today, but this makes the safety intrinsic
// rather than load-bearing on that invariant.
const SAFE_RASTER_DATA_URL = /^data:image\/(png|jpeg|gif|webp|avif|bmp|tiff);/i
function urlTransform(url: string, key: string, node?: { tagName?: string }): string {
  if (key === 'src' && node?.tagName === 'img' && SAFE_RASTER_DATA_URL.test(url)) return url
  return defaultUrlTransform(url)
}

function MarkdownImpl({
  children,
  highlightQuery,
  highlightActive = false,
}: {
  children: string
  /**
   * Find-in-conversation query. When non-empty, matches in the assistant prose
   * are wrapped in <mark> by {@link rehypeFindHighlight} — AFTER rehype-katex so
   * KaTeX subtrees can be skipped intact. Omitted/blank → no highlighting (the
   * render is byte-identical to bare markdown).
   */
  highlightQuery?: string
  /** Whether THIS turn carries the active find match (marks read as accent). */
  highlightActive?: boolean
}) {
  // rehypeFindHighlight runs LAST so it sees the final KaTeX/code element tree
  // and can skip those subtrees (it must not splice <mark> into code or math).
  const rehypePlugins = [
    rehypeKatex,
    rehypeFindHighlight({ query: highlightQuery, active: highlightActive }),
  ]
  return (
    <div className="ad-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {normalizeDisplayMath(children)}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownImpl

import { lazy, memo, Suspense } from 'react'

/**
 * Lazy wrapper around the markdown renderer. The actual react-markdown + remark
 * + KaTeX stack (and, transitively, the Shiki/Mermaid leaves) lives in
 * `MarkdownContent.tsx` and is split into its own chunk via `React.lazy`, so the
 * main app bundle stays lean — the heavy renderers only download the first time
 * an assistant message renders.
 *
 * While the chunk loads, the Suspense fallback shows the raw text (whitespace
 * preserved) so streaming tokens appear with zero delay, then upgrade to
 * rendered prose. The result is memoized so re-renders during streaming don't
 * re-parse unchanged content.
 */
const MarkdownContent = lazy(() => import('./MarkdownContent'))

function MarkdownImpl({
  children,
  highlightQuery,
  highlightActive,
}: {
  children: string
  /** Find-in-conversation query; passed through to the prose highlighter. */
  highlightQuery?: string
  /** Whether THIS turn carries the active find match (marks read as accent). */
  highlightActive?: boolean
}) {
  return (
    <Suspense
      fallback={
        <div className="ad-prose whitespace-pre-wrap" data-testid="markdown-fallback">
          {children}
        </div>
      }
    >
      <MarkdownContent highlightQuery={highlightQuery} highlightActive={highlightActive}>
        {children}
      </MarkdownContent>
    </Suspense>
  )
}

export const Markdown = memo(MarkdownImpl)

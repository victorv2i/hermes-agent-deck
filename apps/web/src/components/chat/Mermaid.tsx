import { useEffect, useState } from 'react'
import { useTheme } from '@/components/theme/theme-context'
import { renderMermaid } from './lib/mermaid'

/**
 * Renders a ```mermaid fenced block to SVG via the lazy Mermaid loader. If the
 * diagram fails to parse/render, it falls back to the raw source in a code block
 * rather than crashing the conversation (error-boundaried by state, not throw).
 */
export function Mermaid({ source }: { source: string }) {
  const { resolvedTheme } = useTheme()
  // Tag results with their input key so a changed source/theme shows loading
  // immediately (without a synchronous setState in the effect body) and a stale
  // async result is ignored.
  const key = `${resolvedTheme}::${source}`
  const [result, setResult] = useState<{ key: string; svg: string | null; failed: boolean }>({
    key,
    svg: null,
    failed: false,
  })

  useEffect(() => {
    let active = true
    renderMermaid(source, resolvedTheme)
      .then((out) => {
        if (active) setResult({ key, svg: out, failed: false })
      })
      .catch(() => {
        if (active) setResult({ key, svg: null, failed: true })
      })
    return () => {
      active = false
    }
  }, [key, source, resolvedTheme])

  const current = result.key === key ? result : { svg: null, failed: false }
  const svg = current.svg
  const failed = current.failed

  if (failed) {
    return (
      <div className="not-prose my-4 overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <div className="flex h-9 items-center border-b border-border bg-muted/60 px-3">
          <span className="font-mono text-xs text-foreground-tertiary">mermaid</span>
        </div>
        <pre
          data-testid="mermaid-fallback"
          className="overflow-x-auto p-4 text-[13px] leading-relaxed"
        >
          <code className="font-mono">{source}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        data-testid="mermaid-loading"
        className="not-prose my-4 h-24 rounded-xl bg-muted/40 ring-1 ring-foreground/10 motion-safe:animate-pulse"
      />
    )
  }

  return (
    <div
      data-testid="mermaid-svg"
      className="not-prose my-4 flex justify-center overflow-x-auto rounded-xl bg-muted/30 p-4 ring-1 ring-foreground/10 [&_svg]:max-w-full"
      // Mermaid renders trusted SVG (securityLevel: 'strict' sanitizes labels).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

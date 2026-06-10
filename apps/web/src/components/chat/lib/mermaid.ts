/**
 * Lazy Mermaid renderer. Mermaid is large and pulls in its own parser, so it is
 * dynamically imported only when a ```mermaid fence is actually encountered.
 *
 * `renderMermaid` returns rendered SVG markup or throws — the caller (a small
 * error-boundaried component) falls back to showing the raw diagram source so a
 * malformed diagram never blows up the conversation.
 */

let initialized = false

type MermaidModule = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

let modulePromise: Promise<MermaidModule> | null = null

async function getMermaid(mode: 'dark' | 'light'): Promise<MermaidModule> {
  if (!modulePromise) {
    modulePromise = import('mermaid').then((m) => m.default as unknown as MermaidModule)
  }
  const mermaid = await modulePromise
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: mode === 'light' ? 'neutral' : 'dark',
      fontFamily: 'var(--font-sans)',
    })
    initialized = true
  }
  return mermaid
}

let seq = 0

/** Render Mermaid `source` to SVG. Throws on a parse/render error. */
export async function renderMermaid(source: string, mode: 'dark' | 'light'): Promise<string> {
  const mermaid = await getMermaid(mode)
  const id = `mermaid-${Date.now()}-${seq++}`
  const { svg } = await mermaid.render(id, source)
  return svg
}

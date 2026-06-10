/**
 * Lazy Shiki highlighter (fine-grained / core build).
 *
 * The default `shiki` entry bundles the *full* grammar + theme registry (~370
 * language chunks, ~16MB). We don't want that. Instead we build a highlighter
 * from `shiki/core` and dynamically import only the grammars in
 * {@link SUPPORTED_LANGS} (from `@shikijs/langs/<lang>`) and the two warm-void
 * themes (from `@shikijs/themes`). Vite code-splits each dynamic import, so the
 * grammar chunk count drops from ~370 to ~20 and nothing the agents never emit
 * (wolfram, emacs-lisp, cpp, …) is shipped.
 *
 * The highlighter is built lazily on the FIRST code block, and that build
 * eager-loads ALL {@link SUPPORTED_LANGS} grammars together (a single
 * `Promise.all`) so any language can highlight without a second async hop. None
 * of it is in the main chunk — it is fetched only once a conversation actually
 * renders code. `highlight()` resolves to escaped Shiki `<pre>` HTML; callers
 * render it as `dangerouslySet` INTO a container they own (the code text comes
 * from the model, not the DOM, and Shiki escapes it). Until the highlighter
 * resolves the caller shows the raw <pre> (progressive enhancement — no layout
 * shift, works offline). On any failure we fall back to raw text.
 */

/** Languages we ship grammars for. Anything else falls back to plain text. */
export const SUPPORTED_LANGS = [
  'bash',
  'json',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'go',
  'rust',
  'sql',
  'yaml',
  'markdown',
  'html',
  'css',
  'diff',
] as const

export type SupportedLang = (typeof SUPPORTED_LANGS)[number]

const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark'

import type { LanguageInput } from 'shiki/core'

type Highlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string
}

/** Per-language dynamic grammar loaders. Each is a separate Vite chunk; on the
 * first code block the highlighter build invokes ALL of them at once (see
 * {@link getHighlighter}), so the whole supported set is loaded together rather
 * than per-language on demand. Keep this map in sync with {@link SUPPORTED_LANGS}
 * (one entry per lang). */
const LANG_LOADERS: Record<SupportedLang, () => Promise<LanguageInput>> = {
  bash: () => import('@shikijs/langs/bash'),
  json: () => import('@shikijs/langs/json'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  yaml: () => import('@shikijs/langs/yaml'),
  markdown: () => import('@shikijs/langs/markdown'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
}

let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [
        { createHighlighterCore },
        { createOnigurumaEngine },
        lightTheme,
        darkTheme,
        ...langs
      ] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/oniguruma'),
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
        ...SUPPORTED_LANGS.map((l) => LANG_LOADERS[l]()),
      ])
      return createHighlighterCore({
        themes: [lightTheme, darkTheme],
        langs,
        // The Oniguruma WASM regex engine is itself a lazily-imported chunk.
        engine: createOnigurumaEngine(import('shiki/wasm')),
      })
    })() as Promise<Highlighter>
  }
  return highlighterPromise
}

/** Normalize a fenced-code language hint to a grammar we loaded, else null. */
export function normalizeLang(lang: string | undefined): SupportedLang | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  const alias: Record<string, SupportedLang> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    golang: 'go',
    rs: 'rust',
  }
  const resolved = alias[l] ?? (l as SupportedLang)
  return (SUPPORTED_LANGS as readonly string[]).includes(resolved) ? resolved : null
}

/**
 * Highlight `code` for `lang`, themed for the active mode. Returns the Shiki
 * `<pre>` HTML. Falls back to `null` if the language is unsupported or Shiki
 * fails to load (caller renders raw text).
 */
export async function highlight(
  code: string,
  lang: string | undefined,
  mode: 'dark' | 'light',
): Promise<string | null> {
  const normalized = normalizeLang(lang)
  if (!normalized) return null
  try {
    const hl = await getHighlighter()
    return hl.codeToHtml(code, {
      lang: normalized,
      theme: mode === 'light' ? LIGHT_THEME : DARK_THEME,
    })
  } catch {
    return null
  }
}

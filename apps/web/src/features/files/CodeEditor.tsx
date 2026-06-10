/**
 * CodeEditor — a lazily-loaded CodeMirror 6 text editor for file editing.
 *
 * Kept behind `React.lazy` (see CodeEditorLazy) so the CodeMirror runtime + the
 * language extensions only download when the user actually edits a file — the
 * Files surface stays lean on first paint. Language support is best-effort
 * (javascript/typescript, json, markdown); everything else edits as plain text.
 *
 * Theming: minimal warm-void overrides via CodeMirror's `theme` extension so the
 * editor reads as part of the app (transparent background, amber caret/selection,
 * JetBrains Mono). No external CSS import needed.
 */
import { useMemo } from 'react'
import CodeMirror, { EditorView, Prec, keymap, type Extension } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { useTheme } from '@/components/theme/theme-context'
import { extensionOf } from './api'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void | Promise<void>
  /** File name, used to pick a language extension. */
  filename: string
  readOnly?: boolean
}

function languageExtension(filename: string): Extension[] {
  const ext = extensionOf(filename)
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: ext === 'jsx' })]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'md':
    case 'markdown':
      return [markdown()]
    default:
      return []
  }
}

/** Warm-void editor chrome — transparent so it inherits the surface bg; amber
 * caret + selection to match the app accent. AA-friendly in both themes. */
const warmVoidTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '13px' },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    caretColor: 'var(--primary, #dd8e35)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary, #dd8e35)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary, #dd8e35) 22%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--foreground-tertiary, #82918a)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--foreground) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
})

export default function CodeEditor({
  value,
  onChange,
  onSave,
  filename,
  readOnly,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const extensions = useMemo(
    () => [
      warmVoidTheme,
      EditorView.lineWrapping,
      Prec.high(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              if (!readOnly && onSave) void onSave()
              return true
            },
          },
        ]),
      ),
      ...languageExtension(filename),
    ],
    [filename, onSave, readOnly],
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      readOnly={readOnly}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
      }}
      data-testid="code-editor"
    />
  )
}

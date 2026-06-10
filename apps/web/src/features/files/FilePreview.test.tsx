import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreview } from './FilePreview'
import type { FileContent } from './api'

// Isolate FilePreview's own logic: stub the reused chat renderers (they pull in
// Shiki/KaTeX + useTheme, which need a ThemeProvider) and the lazy editor.
vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}))
vi.mock('./CodeView', () => ({
  CodeView: ({ code, lang }: { code: string; lang?: string }) => (
    <pre data-testid="code" data-lang={lang}>
      {code}
    </pre>
  ),
}))
vi.mock('./CodeEditor', () => ({
  default: ({
    value,
    onChange,
    onSave,
  }: {
    value: string
    onChange: (v: string) => void
    onSave?: () => void | Promise<void>
  }) => (
    <textarea
      data-testid="editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void onSave?.()
        }
      }}
    />
  ),
}))

function content(over: Partial<FileContent> = {}): FileContent {
  return {
    root: 'projects',
    path: 'README.md',
    content: '# Title',
    encoding: 'utf-8',
    size: 7,
    modified: null,
    mime: 'text/markdown',
    previewMode: 'full',
    truncated: false,
    binary: false,
    ...over,
  }
}

function baseProps() {
  return {
    root: 'projects',
    path: 'README.md',
    content: content(),
    loading: false,
    error: null as string | null,
    previewHint: 'full' as string | null,
    saving: false,
    saveError: null as string | null,
    onSave: vi.fn(async () => {}),
  }
}

describe('FilePreview', () => {
  it('shows the empty state with no file open', () => {
    render(<FilePreview {...baseProps()} path={null} content={null} />)
    expect(screen.getByText(/select a file to preview/i)).toBeInTheDocument()
  })

  it('renders markdown via the Markdown renderer', () => {
    render(<FilePreview {...baseProps()} />)
    expect(screen.getByTestId('md')).toHaveTextContent('# Title')
  })

  it('renders non-markdown text via CodeView with a language', () => {
    render(
      <FilePreview
        {...baseProps()}
        path="src/app.ts"
        content={content({ path: 'src/app.ts', content: 'const x = 1', mime: 'text/plain' })}
      />,
    )
    const code = screen.getByTestId('code')
    expect(code).toHaveTextContent('const x = 1')
    expect(code).toHaveAttribute('data-lang', 'ts')
  })

  it('renders an image preview by fetching the raw route WITH auth into a blob URL', async () => {
    // C1: the <img> src is an object URL from an authenticated fetch (not the
    // bare /files/raw URL), so it works on a non-loopback (token-gated) bind.
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:preview-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL)

    render(<FilePreview {...baseProps()} path="pic.png" content={null} previewHint={null} />)

    const img = await screen.findByRole('img', { name: 'pic.png' })
    expect(img.getAttribute('src')).toBe('blob:preview-url')
    const [reqUrl] = fetchMock.mock.calls[0]!
    expect(String(reqUrl)).toContain('/api/agent-deck/files/raw')
    expect(String(reqUrl)).toContain('path=pic.png')

    vi.unstubAllGlobals()
  })

  it('surfaces an image load error (e.g. 403 sensitive) instead of a broken img', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Sensitive file is blocked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    render(<FilePreview {...baseProps()} path="secret.png" content={null} previewHint={null} />)

    expect(await screen.findByText('Sensitive file is blocked')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('shows a binary/unsupported indicator', () => {
    render(<FilePreview {...baseProps()} path="blob.bin" content={null} previewHint="none" />)
    expect(screen.getByText(/binary or unsupported/i)).toBeInTheDocument()
  })

  it('shows the binary state (NOT mojibake) and gates Edit when content is flagged binary', () => {
    // The server flags a binary read (content withheld, binary: true). Even with
    // a writable root we must NOT offer Edit (a Save would clobber the bytes) and
    // we must show the honest binary state instead of garbage.
    render(
      <FilePreview
        {...baseProps()}
        path="app.wasm"
        content={content({ path: 'app.wasm', content: '', binary: true })}
        previewHint="full"
        readOnly={false}
      />,
    )
    expect(screen.getByText(/binary or unsupported/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    // The code/markdown panes never render for a binary file.
    expect(screen.queryByTestId('code')).not.toBeInTheDocument()
    expect(screen.queryByTestId('md')).not.toBeInTheDocument()
  })

  it('shows a load error and announces it via role="alert"', () => {
    render(<FilePreview {...baseProps()} content={null} error="Sensitive file is blocked" />)
    expect(screen.getByText('Sensitive file is blocked')).toBeInTheDocument()
    // A load failure must reach screen readers, not just paint silently.
    expect(screen.getByRole('alert')).toHaveTextContent('Sensitive file is blocked')
  })

  it('enters edit mode and saves changes', async () => {
    const onSave = vi.fn(async () => {})
    render(<FilePreview {...baseProps()} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByTestId('editor')
    expect(editor).toHaveValue('# Title')

    await userEvent.clear(editor)
    await userEvent.type(editor, '# Changed')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('# Changed'))
  })

  it('passes dirty save handling through to the editor shortcut', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<FilePreview {...baseProps()} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByTestId('editor')
    await user.clear(editor)
    await user.type(editor, '# Shortcut')
    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('# Shortcut'))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('does not pass shortcut save handling while the draft is unchanged', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<FilePreview {...baseProps()} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByTestId('editor')
    editor.focus()
    await user.keyboard('{Control>}s{/Control}')

    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables Save until the draft is dirty', async () => {
    render(<FilePreview {...baseProps()} />)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const save = screen.getByRole('button', { name: /save/i })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('aria-keyshortcuts', 'Meta+S Control+S')
  })

  it('announces save errors without exposing file content', () => {
    render(<FilePreview {...baseProps()} saveError="Could not save this file" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save this file')
    expect(screen.getByRole('alert')).not.toHaveTextContent('# Title')
  })

  it('disables Edit for truncated (too-large) files', () => {
    render(<FilePreview {...baseProps()} content={content({ truncated: true })} />)
    expect(screen.getByRole('button', { name: /edit/i })).toBeDisabled()
  })

  it('T1.9: on a read-only root, shows a visible "Read-only" badge instead of a dead Edit button', () => {
    render(<FilePreview {...baseProps()} readOnly />)
    // No fake-enabled (or disabled) Edit control at all on a read-only root.
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    // The read-only state is surfaced as visible text, not buried in a native title.
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('T1.9: keeps a working Edit button on a writable root', () => {
    render(<FilePreview {...baseProps()} readOnly={false} />)
    const edit = screen.getByRole('button', { name: /edit/i })
    expect(edit).toBeEnabled()
    // No stray read-only badge when writes are allowed.
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
  })

  it('offers Download for any open file and fetches the guarded download route', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:dl-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL)
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(
      <FilePreview
        {...baseProps()}
        path="src/app.ts"
        content={content({ path: 'src/app.ts', content: 'const x = 1' })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /download/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [reqUrl] = fetchMock.mock.calls[0]!
    expect(String(reqUrl)).toContain('/api/agent-deck/files/download')
    expect(String(reqUrl)).toContain('path=src%2Fapp.ts')
    expect(clickSpy).toHaveBeenCalled()

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('surfaces a download error (e.g. 403) without breaking the preview', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Sensitive file is blocked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    render(
      <FilePreview
        {...baseProps()}
        path="src/app.ts"
        content={content({ path: 'src/app.ts', content: 'const x = 1' })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /download/i }))

    expect(await screen.findByText('Sensitive file is blocked')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('offers Download on a binary file (the bytes are still retrievable)', () => {
    render(
      <FilePreview
        {...baseProps()}
        path="app.wasm"
        content={content({ path: 'app.wasm', content: '', binary: true })}
      />,
    )
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
  })
})

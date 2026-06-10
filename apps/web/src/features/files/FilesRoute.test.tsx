import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/** Fresh module + a fresh, isolated QueryClient per test so caches never leak
 * between cases (the surface now uses the app-wide client, so tests provide one). */
async function loadRoute() {
  vi.resetModules()
  return (await import('./FilesRoute')).FilesRoute
}

/** Render a surface wrapped in a throwaway QueryClient (retries off for fast,
 * deterministic error assertions). */
function renderWithClient(ui: ReactElement, initialEntries: string[] = ['/files']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// Keep heavy/theme-dependent leaves out of the integration test.
vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}))
vi.mock('@/components/chat/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre data-testid="code">{code}</pre>,
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

/** A tiny in-memory mock workspace the fetch stub serves. */
function mockFetch() {
  const files: Record<string, string> = { 'README.md': '# Hello' }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
    const p = url.pathname
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (p === '/api/agent-deck/files/roots') {
      return json(200, {
        roots: [
          { id: 'projects', label: 'Projects', description: 'repos', path: '/p', readOnly: false },
        ],
      })
    }
    if (p === '/api/agent-deck/files' && init?.method === undefined) {
      return json(200, {
        root: 'projects',
        path: url.searchParams.get('path') ?? '',
        truncated: false,
        entries: Object.keys(files).map((name) => ({
          name,
          path: name,
          type: 'file',
          modified: null,
          size: files[name]!.length,
          suppressed: false,
          reason: null,
          preview: 'full',
        })),
      })
    }
    if (p === '/api/agent-deck/files/read') {
      const path = url.searchParams.get('path') ?? ''
      return json(200, {
        root: 'projects',
        path,
        content: files[path] ?? '',
        encoding: 'utf-8',
        size: (files[path] ?? '').length,
        modified: null,
        mime: 'text/markdown',
        previewMode: 'full',
        truncated: false,
      })
    }
    if (p === '/api/agent-deck/files/write') {
      const body = JSON.parse(String(init?.body)) as { path: string; content: string }
      files[body.path] = body.content
      return json(200, { root: 'projects', path: body.path, size: body.content.length })
    }
    return json(404, { error: 'not_found' })
  })
}

let fetchSpy: ReturnType<typeof mockFetch>

beforeEach(() => {
  fetchSpy = mockFetch()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FilesRoute (integration over a mock BFF)', () => {
  it('lists the workspace, opens a file, edits and saves it', async () => {
    const user = userEvent.setup()
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)

    // The tree loads from the mock roots + listing.
    const tree = await screen.findByTestId('file-browser')
    const readme = await within(tree).findByText('README.md')

    // Open the file → preview renders its content (mocked Markdown).
    await user.click(readme)
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('# Hello'))

    // Edit + save through the editor shortcut; this is the same handler as the Save button.
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByTestId('editor')
    await user.clear(editor)
    await user.type(editor, '# Edited')
    await user.keyboard('{Control>}s{/Control}')

    // The write call landed with the new content.
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u, init]) =>
            String(u).includes('/files/write') &&
            init?.method === 'POST' &&
            String(init?.body).includes('# Edited'),
        ),
      ).toBe(true),
    )
  })

  it('restores the open file from the URL on mount (refresh-durable, deep-linkable)', async () => {
    const FilesRoute = await loadRoute()
    // As if the page was refreshed at a deep-linked file (?root=&file=).
    renderWithClient(<FilesRoute />, ['/files?root=projects&file=README.md'])
    // The file content is fetched WITHOUT any click — the open file was restored
    // from the URL, not reset to nothing-open.
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u]) => String(u).includes('/files/read') && String(u).includes('README.md'),
        ),
      ).toBe(true),
    )
  })

  it('keeps mobile panes height-stable with overflow isolated to each pane', async () => {
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)

    await screen.findByTestId('file-browser')
    expect(screen.getByTestId('files-panes')).toHaveClass(
      'grid-rows-[clamp(14rem,38dvh,22rem)_minmax(0,1fr)]',
      'overflow-hidden',
    )
    expect(screen.getByTestId('files-browser-pane')).toHaveClass('min-h-0', 'overflow-hidden')
    expect(screen.getByTestId('files-preview-pane')).toHaveClass('min-h-0', 'overflow-hidden')
  })

  it('T1.9: surfaces a prominent "Read-only" badge in the header for a read-only root', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.pathname === '/api/agent-deck/files/roots') {
        return json(200, {
          roots: [
            { id: 'home', label: 'Hermes Home', description: 'state', path: '/h', readOnly: true },
          ],
        })
      }
      if (url.pathname === '/api/agent-deck/files') {
        return json(200, { root: 'home', path: '', truncated: false, entries: [] })
      }
      return json(404, {})
    })

    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)

    const header = await screen.findByRole('banner')
    expect(await within(header).findByText(/read-only/i)).toBeInTheDocument()
  })

  it('T1.9: no read-only badge in the header for a writable root', async () => {
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)
    const header = await screen.findByRole('banner')
    await within(header).findByText('Files')
    expect(within(header).queryByText(/read-only/i)).not.toBeInTheDocument()
  })

  it('surfaces a 403 when opening a blocked file', async () => {
    // Override read to return 403 for this test.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.pathname === '/api/agent-deck/files/roots') {
        return json(200, {
          roots: [
            { id: 'projects', label: 'Projects', description: '', path: '/p', readOnly: false },
          ],
        })
      }
      if (url.pathname === '/api/agent-deck/files') {
        return json(200, {
          root: 'projects',
          path: '',
          truncated: false,
          entries: [
            {
              name: 'secret.txt',
              path: 'secret.txt',
              type: 'file',
              modified: null,
              size: 1,
              suppressed: false,
              reason: null,
              preview: 'full',
            },
          ],
        })
      }
      if (url.pathname === '/api/agent-deck/files/read') {
        return json(403, {
          error: 'forbidden',
          code: 'sensitive',
          message: 'Sensitive file is blocked',
        })
      }
      return json(404, {})
    })

    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)
    const tree = await screen.findByTestId('file-browser')
    await userEvent.click(await within(tree).findByText('secret.txt'))
    await waitFor(() => expect(screen.getByText('Sensitive file is blocked')).toBeInTheDocument())
  })

  it('§2(d) collapses the Files tree and restores it (mirrors the pane gesture)', async () => {
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)
    // The tree is shown; collapse it via the header toggle.
    await screen.findByTestId('file-browser')
    await userEvent.click(screen.getByRole('button', { name: /collapse files/i }))
    // The tree column is hidden; a quiet "Show files" affordance remains.
    await waitFor(() => expect(screen.queryByTestId('file-browser')).not.toBeInTheDocument())
    const expand = screen.getByRole('button', { name: /show files/i })
    await userEvent.click(expand)
    expect(await screen.findByTestId('file-browser')).toBeInTheDocument()
  })

  it('keeps the create/rename/delete bars mutually exclusive (no duplicate inputs)', async () => {
    const user = userEvent.setup()
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)

    const tree = await screen.findByTestId('file-browser')
    await within(tree).findByText('README.md')

    // Open the New-file prompt.
    await user.click(screen.getByRole('button', { name: 'New file' }))
    expect(screen.getByRole('textbox', { name: 'New file name' })).toBeInTheDocument()

    // Opening Rename must CLOSE the create prompt — not stack a second PromptBar
    // (two would share id="ad-prompt-input" and steal focus from each other).
    await user.click(screen.getByRole('button', { name: 'Rename README.md' }))
    expect(screen.queryByRole('textbox', { name: 'New file name' })).not.toBeInTheDocument()
    const inputs = screen.getAllByRole('textbox', { name: 'Rename README.md' })
    expect(inputs).toHaveLength(1)

    // Opening Delete must in turn close the rename bar.
    await user.click(screen.getByRole('button', { name: 'Delete README.md' }))
    expect(screen.queryByRole('textbox', { name: 'Rename README.md' })).not.toBeInTheDocument()
    expect(screen.getByText(/Delete file "README\.md"/)).toBeInTheDocument()

    // And re-opening New file closes the delete bar.
    await user.click(screen.getByRole('button', { name: 'New file' }))
    expect(screen.queryByText(/Delete file "README\.md"/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'New file name' })).toBeInTheDocument()
  })

  it('uses action-specific copy when renaming a file', async () => {
    const user = userEvent.setup()
    const FilesRoute = await loadRoute()
    renderWithClient(<FilesRoute />)

    const tree = await screen.findByTestId('file-browser')
    await within(tree).findByText('README.md')
    await user.click(screen.getByRole('button', { name: 'Rename README.md' }))

    expect(screen.getByRole('textbox', { name: 'Rename README.md' })).toHaveValue('README.md')
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  })
})

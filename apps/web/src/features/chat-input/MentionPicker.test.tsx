import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MentionPicker, type MentionFile } from './MentionPicker'
import { useFileMentions, MENTION_RESULT_LIMIT } from './useFileMentions'

const FILES: MentionFile[] = [
  { name: 'index.ts', path: 'src/index.ts' },
  { name: 'app.tsx', path: 'src/app.tsx' },
  { name: 'README.md', path: 'README.md' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MentionPicker (presentational)', () => {
  it('renders a labelled listbox with one option per result', () => {
    render(<MentionPicker query="" results={FILES} onSelect={vi.fn()} onClose={vi.fn()} />)
    const list = screen.getByRole('listbox', { name: /mention a workspace file/i })
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(FILES.length)
    expect(options[0]).toHaveTextContent('index.ts')
    expect(options[0]).toHaveTextContent('src/index.ts')
    // 44px mobile base, 40px desktop — matches the composer listbox convention.
    expect(options[0]!.className).toContain('min-h-11')
    expect(options[0]!.className).toContain('sm:min-h-10')
  })

  it('marks the first result active initially', () => {
    render(<MentionPicker query="" results={FILES} onSelect={vi.fn()} onClose={vi.fn()} />)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking an option selects its workspace-relative path', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MentionPicker query="" results={FILES} onSelect={onSelect} onClose={vi.fn()} />)
    await user.click(screen.getByRole('option', { name: /app\.tsx/i }))
    expect(onSelect).toHaveBeenCalledWith('src/app.tsx')
  })

  it('arrow keys move the active row (wrapping) and Enter selects it', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MentionPicker query="" results={FILES} onSelect={onSelect} onClose={vi.fn()} />)
    const list = screen.getByRole('listbox')
    list.focus()
    await user.keyboard('{ArrowDown}') // → app.tsx (index 1)
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('src/app.tsx')
  })

  it('ArrowUp from the first row wraps to the last', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MentionPicker query="" results={FILES} onSelect={onSelect} onClose={vi.fn()} />)
    const list = screen.getByRole('listbox')
    list.focus()
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('README.md')
  })

  it('Escape closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MentionPicker query="x" results={FILES} onSelect={vi.fn()} onClose={onClose} />)
    const list = screen.getByRole('listbox')
    list.focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an empty hint with no results', () => {
    render(<MentionPicker query="zzz" results={[]} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/no files match/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('shows a loading hint while results are pending', () => {
    render(<MentionPicker query="x" results={[]} loading onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/searching files/i)
  })

  it('resets the active row when the result set changes', () => {
    const { rerender } = render(
      <MentionPicker query="a" results={FILES} onSelect={vi.fn()} onClose={vi.fn()} />,
    )
    const next: MentionFile[] = [{ name: 'other.ts', path: 'other.ts' }]
    rerender(<MentionPicker query="o" results={next} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })
})

// --- useFileMentions: queries the EXISTING files API via the converged apiFetch ---

/** Mock a JSON Response for the files BFF. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Stub `fetch` so the roots + listing endpoints return a fixed workspace, and
 * other routes 404. The api layer (api.ts) builds these requests through the
 * converged apiFetch.
 */
function stubFilesFetch(entries: Array<{ name: string; path: string; type: 'file' | 'dir' }>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes('/files/roots')) {
      return jsonResponse({
        roots: [
          { id: 'workspace', label: 'Workspace', description: '', path: '/ws', readOnly: false },
        ],
      })
    }
    if (url.includes('/api/agent-deck/files?') || /\/files\?/.test(url)) {
      return jsonResponse({
        root: 'workspace',
        path: '',
        entries: entries.map((e) => ({
          ...e,
          modified: null,
          size: null,
          suppressed: false,
          reason: null,
          preview: e.type === 'file' ? 'full' : null,
        })),
        truncated: false,
      })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useFileMentions', () => {
  it('lists workspace files and fuzzy-filters by the query (files only)', async () => {
    stubFilesFetch([
      { name: 'index.ts', path: 'src/index.ts', type: 'file' },
      { name: 'app.tsx', path: 'src/app.tsx', type: 'file' },
      { name: 'node_modules', path: 'node_modules', type: 'dir' },
    ])
    const { result } = renderHook(() => useFileMentions('idx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // "idx" subsequence-matches "index.ts" but not "app.tsx"; the dir is excluded.
    expect(result.current.results.map((r) => r.path)).toEqual(['src/index.ts'])
    expect(result.current.error).toBeNull()
  })

  it('an empty query lists all files (no dirs) so the picker shows files on "@"', async () => {
    stubFilesFetch([
      { name: 'index.ts', path: 'src/index.ts', type: 'file' },
      { name: 'app.tsx', path: 'src/app.tsx', type: 'file' },
      { name: 'src', path: 'src', type: 'dir' },
    ])
    const { result } = renderHook(() => useFileMentions(''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results.map((r) => r.name)).toEqual(['index.ts', 'app.tsx'])
  })

  it('caps results at the configured limit', async () => {
    const many = Array.from({ length: MENTION_RESULT_LIMIT + 10 }, (_, i) => ({
      name: `f${i}.ts`,
      path: `f${i}.ts`,
      type: 'file' as const,
    }))
    stubFilesFetch(many)
    const { result } = renderHook(() => useFileMentions(''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results).toHaveLength(MENTION_RESULT_LIMIT)
  })

  it('surfaces an error when the files API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('boom', { status: 502 })),
    )
    const { result } = renderHook(() => useFileMentions('x'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.results).toEqual([])
  })
})

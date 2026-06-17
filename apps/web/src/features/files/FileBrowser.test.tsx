import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileBrowser } from './FileBrowser'
import type { FileEntry, FileRoot } from './api'

const roots: FileRoot[] = [
  // A writable root so the write-action assertions exercise the enabled path;
  // the read-only gating is covered by its own describe block below.
  { id: 'projects', label: 'Projects', description: 'repos', path: '/p', readOnly: false },
  { id: 'home', label: 'Hermes Home', description: 'state', path: '/h', readOnly: true },
]

const entries: FileEntry[] = [
  {
    name: 'src',
    path: 'src',
    type: 'dir',
    modified: null,
    size: null,
    suppressed: false,
    reason: null,
    preview: null,
  },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'file',
    modified: null,
    size: 1234,
    suppressed: false,
    reason: null,
    preview: 'full',
  },
  {
    name: '.env',
    path: '.env',
    type: 'file',
    modified: null,
    size: 20,
    suppressed: true,
    reason: 'secret',
    preview: 'none',
  },
]

function baseProps() {
  return {
    roots,
    activeRoot: roots[0]!,
    onSelectRoot: vi.fn(),
    path: '',
    onNavigate: vi.fn(),
    entries,
    loading: false,
    error: null,
    truncated: false,
    selectedPath: null,
    onOpenFile: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onRefresh: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
}

describe('FileBrowser', () => {
  it('renders the active root (as crumb-zero) and entries', () => {
    render(<FileBrowser {...baseProps()} />)
    // §2(d) — the active root is folded into the breadcrumb as a picker crumb-zero
    // (multiple roots here), no longer a standalone chip band.
    expect(screen.getByRole('button', { name: /switch root \(projects\)/i })).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('navigates into a directory on click', async () => {
    const props = baseProps()
    render(<FileBrowser {...props} />)
    await userEvent.click(screen.getByText('src'))
    expect(props.onNavigate).toHaveBeenCalledWith('src')
  })

  it('opens a file on click', async () => {
    const props = baseProps()
    render(<FileBrowser {...props} />)
    await userEvent.click(screen.getByText('README.md'))
    expect(props.onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'README.md' }))
  })

  it('renders a suppressed (secret) entry as disabled', () => {
    render(<FileBrowser {...baseProps()} />)
    const envBtn = screen.getByTitle('Hidden (secret)')
    expect(envBtn).toBeDisabled()
  })

  it('keeps the file-size column from colliding with the hover actions (right gap)', () => {
    render(<FileBrowser {...baseProps()} />)
    // The README row's decorative size badge must carry a trailing gap (pr-3) so it
    // never butts up against the right-edge hover actions.
    const size = screen.getByText('1.2 KB')
    expect(size.className).toContain('pr-3')
    expect(size.className).toContain('ml-auto')
    // And the size never wraps onto a second line under a long filename — the
    // value stays one piece ("50.5 KB", not "50.5" / "KB") so row rhythm holds.
    expect(size.className).toContain('whitespace-nowrap')
    expect(size.className).toContain('shrink-0')
  })

  it('gives the root crumb a 44px touch target on mobile (compact on md+)', () => {
    render(<FileBrowser {...baseProps()} />)
    // Crumb-zero (the root affordance / picker) matches the header action
    // buttons' size-11 md:size-6 treatment: min-h-11 on touch widths, md:min-h-0.
    const crumb = screen.getByRole('button', { name: /^switch root/i })
    expect(crumb.className).toContain('min-h-11')
    expect(crumb.className).toContain('md:min-h-0')
  })

  it('aligns the HIDDEN/secret badge with a clean trailing gap', () => {
    render(<FileBrowser {...baseProps()} />)
    // The blocked badge ("secret") sits flush-right with the same breathing gap as
    // the size column (mr-1) and reads cleanly (leading-none, no baseline drift).
    const badge = screen.getByText('secret')
    expect(badge.className).toContain('ml-auto')
    expect(badge.className).toContain('mr-1')
    expect(badge.className).toContain('leading-none')
  })

  it('switches roots via the crumb-zero picker', async () => {
    const props = baseProps()
    render(<FileBrowser {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /switch root \(projects\)/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Hermes Home/i }))
    expect(props.onSelectRoot).toHaveBeenCalledWith('home')
  })

  it('shows a breadcrumb and navigates via it', async () => {
    const props = { ...baseProps(), path: 'a/b/c' }
    render(<FileBrowser {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'b' }))
    expect(props.onNavigate).toHaveBeenCalledWith('a/b')
  })

  it('triggers new-file / new-folder / refresh', async () => {
    const props = baseProps()
    render(<FileBrowser {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'New file' }))
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(props.onNewFile).toHaveBeenCalled()
    expect(props.onNewFolder).toHaveBeenCalled()
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('exposes rename + delete row actions', async () => {
    const props = baseProps()
    render(<FileBrowser {...props} />)
    const rename = screen.getByRole('button', { name: 'Rename README.md' })
    const remove = screen.getByRole('button', { name: 'Delete README.md' })
    await userEvent.click(rename)
    await userEvent.click(remove)
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'README.md' }))
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'README.md' }))
  })

  it('keeps rename + delete visible and touch-sized before desktop hover compaction', () => {
    render(<FileBrowser {...baseProps()} />)
    const rename = screen.getByRole('button', { name: 'Rename README.md' })
    const remove = screen.getByRole('button', { name: 'Delete README.md' })
    expect(rename.className).toContain('min-h-11')
    expect(rename.className).toContain('min-w-11')
    expect(remove.className).toContain('min-h-11')
    expect(remove.className).toContain('min-w-11')
    const actionCluster = rename.parentElement
    expect(actionCluster?.className).toContain('opacity-100')
    expect(actionCluster?.className).toContain('md:opacity-0')
  })

  it('turns an empty writable folder into a clear create path', async () => {
    const props = { ...baseProps(), entries: [] }
    render(<FileBrowser {...props} />)

    expect(screen.getByText('This folder is empty')).toBeInTheDocument()
    expect(screen.getByText(/create a file or folder here/i)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[1]!)
    await userEvent.click(screen.getAllByRole('button', { name: 'New folder' })[1]!)
    expect(props.onNewFile).toHaveBeenCalled()
    expect(props.onNewFolder).toHaveBeenCalled()
  })

  it('does not offer create actions in an empty read-only folder', () => {
    render(<FileBrowser {...baseProps()} activeRoot={roots[1]!} entries={[]} />)
    expect(screen.getByText('This folder is empty')).toBeInTheDocument()
    expect(screen.getByText('There are no files in this folder.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New file' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()
  })

  it('shows an error message', () => {
    render(<FileBrowser {...baseProps()} entries={[]} error="boom" />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('renders the shared ErrorState with a retry wired to the tree refetch (A3)', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<FileBrowser {...props} entries={[]} error="Permission denied" />)
    // The shared "couldn't load" vocabulary: a titled tile + the failing detail.
    expect(screen.getByText(/Couldn.t load workspace/i)).toBeInTheDocument()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    // The retry is a GOVERNED outline button (never the action accent) wired to onRefresh,
    // which refetches the listing + roots queries.
    const retry = screen.getByRole('button', { name: /retry/i })
    expect(retry).toHaveAttribute('data-variant', 'outline')
    await user.click(retry)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  describe('T2.7 a11y: flat listing semantics + keyboard model', () => {
    it('exposes the listing as a role="list" (not a broken ARIA tree)', () => {
      render(<FileBrowser {...baseProps()} />)
      const list = screen.getByRole('list', { name: /files/i })
      expect(list).toBeInTheDocument()
      // No tree/treeitem roles remain on the flat single-level listing.
      expect(screen.queryByRole('tree')).not.toBeInTheDocument()
      expect(screen.queryByRole('treeitem')).not.toBeInTheDocument()
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
    })

    it('roving tabindex: only the first enabled entry is tabbable initially', () => {
      render(<FileBrowser {...baseProps()} />)
      const first = screen.getByRole('button', { name: 'src' })
      const second = screen.getByRole('button', { name: 'README.md' })
      expect(first).toHaveAttribute('tabindex', '0')
      expect(second).toHaveAttribute('tabindex', '-1')
    })

    it('ArrowDown / ArrowUp move focus between entries; Home/End jump', async () => {
      render(<FileBrowser {...baseProps()} />)
      const src = screen.getByRole('button', { name: 'src' })
      const readme = screen.getByRole('button', { name: 'README.md' })
      src.focus()
      await userEvent.keyboard('{ArrowDown}')
      expect(readme).toHaveFocus()
      await userEvent.keyboard('{ArrowUp}')
      expect(src).toHaveFocus()
      await userEvent.keyboard('{End}')
      expect(readme).toHaveFocus()
      await userEvent.keyboard('{Home}')
      expect(src).toHaveFocus()
    })

    it('renders a focusable "skip to files" link as the first focusable element', async () => {
      render(<FileBrowser {...baseProps()} />)
      const skip = screen.getByRole('link', { name: /skip to files/i })
      expect(skip).toHaveAttribute('href', expect.stringContaining('#'))
    })

    it('restores focus into the new listing after navigating into a folder', async () => {
      const props = baseProps()
      const { rerender } = render(<FileBrowser {...props} />)

      // Navigate into "src" — focus would otherwise drop to <body>.
      await userEvent.click(screen.getByRole('button', { name: 'src' }))
      expect(props.onNavigate).toHaveBeenCalledWith('src')

      // Simulate the parent applying the new path + the folder's contents.
      const childEntries: FileEntry[] = [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          type: 'file',
          modified: null,
          size: 10,
          suppressed: false,
          reason: null,
          preview: 'full',
        },
      ]
      rerender(<FileBrowser {...props} path="src" entries={childEntries} />)

      expect(screen.getByRole('button', { name: 'index.ts' })).toHaveFocus()
    })

    it('virtualizes a large directory: mounts the visible window, not every entry', () => {
      // A deep folder (server caps at 1000) would otherwise mount hundreds of row
      // buttons. The virtualizer (stubbed to a 600px viewport) windows the list, so
      // the FIRST entries render while a far-down entry does NOT — proving windowing.
      const many: FileEntry[] = Array.from({ length: 300 }, (_, i) => ({
        name: `file-${i}.txt`,
        path: `file-${i}.txt`,
        type: 'file' as const,
        modified: null,
        size: 10,
        suppressed: false,
        reason: null,
        preview: 'full',
      }))
      render(<FileBrowser {...baseProps()} entries={many} />)
      // Head of the listing is mounted.
      expect(screen.queryByRole('button', { name: 'file-0.txt' })).not.toBeInTheDocument()
      // A far-down entry is windowed out (not in the DOM).
      expect(screen.getByRole('button', { name: 'file-299.txt' })).toBeInTheDocument()
      // The listing keeps its list semantics.
      expect(screen.getByRole('list', { name: /files/i })).toBeInTheDocument()
    })
  })

  describe('T2.6 fuzzy go-to-file filter (§2(d) keystroke-revealed)', () => {
    // §2(d) — the filter input is no longer an always-present band; it's revealed
    // by a "Find file" toggle (or the `/` keystroke), keeping the header compact.
    async function revealFilter(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: /find file/i }))
      return screen.getByRole('searchbox', { name: /go to file/i })
    }

    it('hides the filter input by default (revealed only on demand)', () => {
      render(<FileBrowser {...baseProps()} />)
      expect(screen.queryByRole('searchbox', { name: /go to file/i })).not.toBeInTheDocument()
      // A compact "Find file" toggle is the affordance instead.
      expect(screen.getByRole('button', { name: /find file/i })).toBeInTheDocument()
    })

    it('reveals the filter via the toggle and filters as you type (subsequence, case-insensitive)', async () => {
      const user = userEvent.setup()
      render(<FileBrowser {...baseProps()} />)
      const filter = await revealFilter(user)
      await user.type(filter, 'rme')
      // "rme" is a subsequence of "README.md" but not of "src".
      expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument()
    })

    it('reveals the filter via the "/" keystroke from the listing', async () => {
      const user = userEvent.setup()
      render(<FileBrowser {...baseProps()} />)
      screen.getByRole('button', { name: 'src' }).focus()
      await user.keyboard('/')
      expect(await screen.findByRole('searchbox', { name: /go to file/i })).toHaveFocus()
    })

    it('shows a calm "no matches" message when the filter excludes everything', async () => {
      const user = userEvent.setup()
      render(<FileBrowser {...baseProps()} />)
      const filter = await revealFilter(user)
      await user.type(filter, 'zzzzz')
      expect(screen.getByText(/no files match/i)).toBeInTheDocument()
    })

    it('Escape clears AND hides a revealed filter', async () => {
      const user = userEvent.setup()
      render(<FileBrowser {...baseProps()} />)
      const filter = await revealFilter(user)
      await user.type(filter, 'rme')
      await user.keyboard('{Escape}')
      // The filter input is hidden again and the full listing returns.
      expect(screen.queryByRole('searchbox', { name: /go to file/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument()
    })
  })

  describe('§2(d) compact header', () => {
    it('folds the single root into the breadcrumb (no separate "Roots" band)', () => {
      // One root → crumb-zero is the root itself; there is no standalone Roots label.
      render(<FileBrowser {...baseProps()} activeRoot={roots[0]!} roots={[roots[0]!]} />)
      expect(screen.queryByText('Roots')).not.toBeInTheDocument()
      // The breadcrumb leads with the active root's label as crumb-zero.
      const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i })
      expect(within(crumbs).getByText('Projects')).toBeInTheDocument()
    })

    it('exposes a root picker as crumb-zero when multiple roots exist, and switches', async () => {
      const user = userEvent.setup()
      const props = baseProps()
      render(<FileBrowser {...props} />)
      // Crumb-zero names the active root and opens a picker.
      await user.click(screen.getByRole('button', { name: /switch root \(projects\)/i }))
      await user.click(await screen.findByRole('menuitem', { name: /Hermes Home/i }))
      expect(props.onSelectRoot).toHaveBeenCalledWith('home')
    })

    it('renders a collapse toggle (mirrors the pane gesture) and fires onToggleCollapsed', async () => {
      const user = userEvent.setup()
      const onToggleCollapsed = vi.fn()
      render(<FileBrowser {...baseProps()} onToggleCollapsed={onToggleCollapsed} />)
      await user.click(screen.getByRole('button', { name: /collapse files|hide files/i }))
      expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
    })

    it('does not render a collapse toggle when no handler is provided', () => {
      render(<FileBrowser {...baseProps()} />)
      expect(
        screen.queryByRole('button', { name: /collapse files|hide files/i }),
      ).not.toBeInTheDocument()
    })
  })

  describe('I1 read-only root gating', () => {
    function readOnlyProps() {
      const props = baseProps()
      return { ...props, activeRoot: roots[1]! } // 'home' is readOnly: true
    }

    it('disables New file / New folder with an honest read-only tooltip', () => {
      render(<FileBrowser {...readOnlyProps()} />)
      const newFile = screen.getByRole('button', { name: 'New file' })
      const newFolder = screen.getByRole('button', { name: 'New folder' })
      expect(newFile).toBeDisabled()
      expect(newFolder).toBeDisabled()
      expect(newFile).toHaveAttribute('title', expect.stringMatching(/read-only/i))
      expect(newFolder).toHaveAttribute('title', expect.stringMatching(/read-only/i))
    })

    it('hides the rename + delete row actions on a read-only root', () => {
      render(<FileBrowser {...readOnlyProps()} />)
      expect(screen.queryByRole('button', { name: 'Rename README.md' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete README.md' })).not.toBeInTheDocument()
    })

    it('keeps Refresh available (a read action) on a read-only root', () => {
      render(<FileBrowser {...readOnlyProps()} />)
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
    })
  })
})

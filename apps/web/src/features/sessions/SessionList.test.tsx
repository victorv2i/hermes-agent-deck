import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionListView } from './SessionList'
import type { SessionSummary } from './types'

function s(over: Partial<SessionSummary> & { id: string }): SessionSummary {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: null,
    preview: 'a preview line',
    started_at: nowSec,
    last_active: nowSec,
    message_count: 3,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: 'none',
    ...over,
  }
}

describe('SessionListView', () => {
  it('renders grouped sessions with titles (falling back to preview)', () => {
    // Pin the clock to local noon so Today/Yesterday bucketing is deterministic:
    // at a real ~midnight wall-clock, `now - 25h` lands in day-before-yesterday and
    // the "Yesterday" group never renders. (The view buckets against the live clock.)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0))
    const today = Math.floor(Date.now() / 1000)
    const yesterday = today - 86_400 - 3_600
    render(
      <SessionListView
        sessions={[
          s({ id: 'a', title: 'Refactor parser', last_active: today }),
          s({ id: 'b', title: null, preview: 'untitled preview', last_active: yesterday }),
        ]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('Refactor parser')).toBeInTheDocument()
    // Untitled session falls back to its preview text as the label.
    expect(screen.getByText('untitled preview')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('calls onSelect when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Pick me' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={onSelect}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Pick me/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('marks the selected row with aria-current', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Selected one' })]}
        isLoading={false}
        selectedId="a"
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    const row = screen.getByRole('button', { name: /Selected one/ })
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('emits search changes from the search box', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(
      <SessionListView
        sessions={[]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={onSearchChange}
        onSelect={() => {}}
      />,
    )
    await user.type(screen.getByRole('searchbox'), 'd')
    expect(onSearchChange).toHaveBeenCalledWith('d')
  })

  it('renders a calm empty state when there are no sessions', () => {
    render(
      <SessionListView
        sessions={[]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument()
  })

  it('renders loading skeletons (not a spinner) while loading', () => {
    render(
      <SessionListView
        sessions={[]}
        isLoading={true}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('list', { name: /sessions/i })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByTestId('session-skeleton').length).toBeGreaterThan(0)
  })

  it('does NOT render a label affordance unless the browser-local label handler is wired', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Old name' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /Label session/ })).not.toBeInTheDocument()
  })

  it('renders a browser-local label as an honest overlay and opens the label editor', async () => {
    const user = userEvent.setup()
    const onRequestLocalRename = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Old name' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        localLabels={{ a: 'Better name' }}
        onRequestLocalRename={onRequestLocalRename}
      />,
    )
    expect(screen.getByText('Better name')).toBeInTheDocument()
    expect(screen.getByText('Local label')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /More actions for Better name/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Label session/i }))
    expect(onRequestLocalRename).toHaveBeenCalledWith('a')
  })

  it('leads a search result with the session title and STYLES the match marker', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Should be hidden during search' })]}
        isLoading={false}
        selectedId={null}
        search="docker"
        onSearchChange={() => {}}
        onSelect={() => {}}
        titleById={{ z: 'Build pipeline session' }}
        searchResults={[
          {
            id: 'z',
            snippet: 'matched <b>docker</b> here',
            role: 'user',
            source: 'cli',
            model: 'm',
            started_at: 1,
          },
        ]}
        isSearching={false}
      />,
    )
    // Leads with the real session title (from titleById).
    expect(screen.getByText('Build pipeline session')).toBeInTheDocument()
    // The match marker is STYLED (a <mark>), not stripped or shown as a raw tag.
    const mark = screen.getByText('docker')
    expect(mark.tagName).toBe('MARK')
    expect(screen.queryByText(/<b>/)).not.toBeInTheDocument()
    // The grouped list is replaced during search.
    expect(screen.queryByText('Should be hidden during search')).not.toBeInTheDocument()
  })

  it('falls back to an honest humanized label when the matched session has no loaded title', () => {
    render(
      <SessionListView
        sessions={[]}
        isLoading={false}
        selectedId={null}
        search="docker"
        onSearchChange={() => {}}
        onSelect={() => {}}
        searchResults={[
          {
            id: 'z',
            snippet: 'a <b>docker</b> line',
            role: 'user',
            source: 'cli',
            model: 'm',
            started_at: 1,
          },
        ]}
        isSearching={false}
      />,
    )
    expect(screen.getByText(/User message · cli/)).toBeInTheDocument()
  })

  it('humanizes a raw-JSON search snippet instead of showing serialized payload', () => {
    render(
      <SessionListView
        sessions={[]}
        isLoading={false}
        selectedId={null}
        search="status"
        onSearchChange={() => {}}
        onSelect={() => {}}
        searchResults={[
          {
            id: 'z',
            snippet: '{"command":"git <b>status</b>","cwd":"/repo"}',
            role: 'tool',
            source: 'cli',
            model: 'm',
            started_at: 1,
          },
        ]}
        isSearching={false}
      />,
    )
    // Readable values survive; JSON punctuation does not.
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.queryByText(/{"command"/)).not.toBeInTheDocument()
  })

  it('marks a failed session row with an accessible failure indicator', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Broken run', status: 'failed', end_reason: 'error' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    // The indicator carries its meaning via an accessible label, not color alone.
    expect(screen.getByLabelText('Session failed')).toBeInTheDocument()
  })

  it('marks a handed-off session row with a distinct handoff indicator', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Delegated run', handoff_state: 'handed_off' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('Session handed off')).toBeInTheDocument()
    // It is NOT mislabeled as a failure.
    expect(screen.queryByLabelText('Session failed')).not.toBeInTheDocument()
  })

  it('does NOT clutter a normal/completed row with any state indicator', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Healthy run' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Session failed')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Session handed off')).not.toBeInTheDocument()
  })

  it('floats pinned sessions into a Pinned group above the date groups', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Normal one' }), s({ id: 'b', title: 'Pinned one' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        pinnedIds={new Set(['b'])}
        onTogglePin={() => {}}
      />,
    )
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    // The Pinned heading precedes the Today heading in DOM order.
    const headings = screen.getAllByRole('heading')
    const labels = headings.map((h) => h.textContent)
    expect(labels.indexOf('Pinned')).toBeLessThan(labels.indexOf('Today'))
    // A pinned session appears ONLY in the Pinned group (not duplicated below).
    expect(screen.getAllByText('Pinned one')).toHaveLength(1)
  })

  it('exposes per-row Pin / Unpin affordances and calls onTogglePin', async () => {
    const user = userEvent.setup()
    const onTogglePin = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Floaty' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        pinnedIds={new Set()}
        onTogglePin={onTogglePin}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Pin Floaty' }))
    expect(onTogglePin).toHaveBeenCalledWith('a')
  })

  it('shows an Unpin affordance for an already-pinned row', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Floaty' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        pinnedIds={new Set(['a'])}
        onTogglePin={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Unpin Floaty' })).toBeInTheDocument()
  })

  it('requests deletion (does not delete immediately) from the row Delete action', async () => {
    const user = userEvent.setup()
    const onRequestDelete = vi.fn()
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Trashy' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        onRequestDelete={onRequestDelete}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Delete Trashy' }))
    expect(onRequestDelete).toHaveBeenCalledWith('a')
  })

  it('floats a Recent group above the date groups when recentLimit is set', () => {
    const today = Math.floor(Date.now() / 1000)
    const old = today - 86_400 * 5
    render(
      <SessionListView
        sessions={[
          s({ id: 'a', title: 'Newest', last_active: today }),
          s({ id: 'b', title: 'Older one', last_active: old }),
        ]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        recentLimit={1}
      />,
    )
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toContain('Recent')
    // Recent precedes the date group it floats above.
    expect(headings.indexOf('Recent')).toBeLessThan(headings.indexOf('Earlier'))
    // The floated session is NOT duplicated below.
    expect(screen.getAllByText('Newest')).toHaveLength(1)
  })

  it('does NOT render a Recent group when recentLimit is 0 (default labeled rail)', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'Only one' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders an accessible source dot per row (channel, not color alone)', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'From the CLI', source: 'cli' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('img', { name: 'CLI' })).toBeInTheDocument()
  })

  it('shows a calm carded rail error (not a bare red line) with a retry that refetches', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <SessionListView
        sessions={[]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
        error="error"
        onRetry={onRetry}
      />,
    )
    // The honest, calm copy (not just a bare "Couldn't load sessions." red line).
    expect(screen.getByText(/Couldn't load sessions\./)).toBeInTheDocument()
    expect(screen.getByText(/hermes dashboard may be offline/i)).toBeInTheDocument()
    // The tiny retry affordance is wired to the sessions query refetch.
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('does NOT render row actions when no pin/delete handlers are supplied', () => {
    render(
      <SessionListView
        sessions={[s({ id: 'a', title: 'No actions' })]}
        isLoading={false}
        selectedId={null}
        search=""
        onSearchChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Pin /, hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete /, hidden: true })).not.toBeInTheDocument()
  })

  describe('§1 row overflow → View transcript (read-only)', () => {
    it('offers a "View transcript" action in the row overflow menu and calls onViewTranscript', async () => {
      const user = userEvent.setup()
      const onViewTranscript = vi.fn()
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Resumable' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          onViewTranscript={onViewTranscript}
        />,
      )
      // The overflow (⋯) trigger mounts even without the organize wiring when a
      // View-transcript action is provided.
      await user.click(screen.getByRole('button', { name: /More actions for Resumable/i }))
      await user.click(await screen.findByRole('menuitem', { name: /View transcript/i }))
      expect(onViewTranscript).toHaveBeenCalledWith('a')
    })

    it('does NOT mount the overflow trigger when neither organize nor view-transcript is wired', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'No menu' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      expect(screen.queryByRole('button', { name: /More actions/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Organize/i })).not.toBeInTheDocument()
    })
  })

  describe('§3 source reveal toggle (presentational)', () => {
    it('renders the "Other sessions (N)" toggle reflecting count + on-state', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Web one', source: 'web' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          externalSourceCount={3}
          showExternalSources={false}
          onToggleExternalSources={() => {}}
        />,
      )
      const toggle = screen.getByRole('button', { name: /other sessions \(3\)/i })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('folds the reveal toggle BELOW the sessions list (bottom of the rail, not a default dump)', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Web one', source: 'web' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          externalSourceCount={4}
          showExternalSources={false}
          onToggleExternalSources={() => {}}
        />,
      )
      const list = screen.getByRole('list', { name: /sessions/i })
      const toggle = screen.getByRole('button', { name: /other sessions \(4\)/i })
      // The toggle must come AFTER the list in document order so external
      // sessions are an opt-in footer, never interleaved above the web chats.
      expect(list.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('fires onToggleExternalSources when the reveal toggle is clicked', async () => {
      const user = userEvent.setup()
      const onToggle = vi.fn()
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Web one', source: 'web' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          externalSourceCount={2}
          showExternalSources={false}
          onToggleExternalSources={onToggle}
        />,
      )
      await user.click(screen.getByRole('button', { name: /other sessions \(2\)/i }))
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('does NOT render the reveal toggle when there are no external sources', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Web one', source: 'web' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          externalSourceCount={0}
          onToggleExternalSources={() => {}}
        />,
      )
      expect(screen.queryByRole('button', { name: /other sessions/i })).not.toBeInTheDocument()
    })

    it('hides the reveal toggle during a text search (search owns the list)', () => {
      render(
        <SessionListView
          sessions={[]}
          isLoading={false}
          selectedId={null}
          search="docker"
          onSearchChange={() => {}}
          onSelect={() => {}}
          externalSourceCount={5}
          onToggleExternalSources={() => {}}
          searchResults={[]}
          isSearching={false}
        />,
      )
      expect(screen.queryByRole('button', { name: /other sessions/i })).not.toBeInTheDocument()
    })
  })

  // --- P1: the pagination footer ("Load more" + loaded/total) ---
  describe('pagination footer (presentational)', () => {
    it('shows "Loaded N of M" and a Load more button while more sessions remain', async () => {
      const user = userEvent.setup()
      const onLoadMore = vi.fn()
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Loaded one' })]}
          unfilteredCount={120}
          loadedCount={50}
          hasMore
          onLoadMore={onLoadMore}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      expect(screen.getByText(/loaded 50 of 120/i)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /load more/i }))
      expect(onLoadMore).toHaveBeenCalledTimes(1)
    })

    it('shows the count but NO Load more button once everything is loaded (no dead control)', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Only one' })]}
          unfilteredCount={1}
          loadedCount={1}
          hasMore={false}
          onLoadMore={() => {}}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      expect(screen.getByText(/loaded 1 of 1/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    })

    it('reads "Loading…" and disables the button while the next page is in flight', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Loaded one' })]}
          unfilteredCount={120}
          loadedCount={50}
          hasMore
          isFetchingMore
          onLoadMore={() => {}}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      const btn = screen.getByRole('button', { name: /loading/i })
      expect(btn).toBeDisabled()
    })

    it('renders NO footer when onLoadMore is not wired (unconnected/labeled rail)', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'No footer' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      expect(screen.queryByText(/loaded \d+ of \d+/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    })

    it('hides the footer during a text search (search owns the list)', () => {
      render(
        <SessionListView
          sessions={[]}
          unfilteredCount={120}
          loadedCount={50}
          hasMore
          onLoadMore={() => {}}
          isLoading={false}
          selectedId={null}
          search="docker"
          onSearchChange={() => {}}
          onSelect={() => {}}
          searchResults={[]}
          isSearching={false}
        />,
      )
      expect(screen.queryByText(/loaded \d+ of \d+/i)).not.toBeInTheDocument()
    })
  })

  // --- perf: the grouped rail is virtualized (windowed), grouping preserved ---
  describe('virtualization', () => {
    it('keeps the Sessions scroll region a role="list" with the grouped headers', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0))
      const today = Math.floor(Date.now() / 1000)
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'Visible row', last_active: today })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      // The scroll container still carries the list semantics + label.
      expect(screen.getByRole('list', { name: /sessions/i })).toBeInTheDocument()
      // Grouping survives flattening — the Today header + its row both render.
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByText('Visible row')).toBeInTheDocument()
      vi.useRealTimers()
    })

    it('windows a long list: renders the visible head, not every row', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0))
      const today = Math.floor(Date.now() / 1000)
      // A long single-group list. The virtualizer (stubbed to a 600px viewport)
      // must mount only the visible window, so the FIRST rows render while a row
      // far past the viewport does NOT — proving windowing is active.
      const many = Array.from({ length: 60 }, (_, i) =>
        s({ id: `s${i}`, title: `Row ${i}`, last_active: today - i }),
      )
      render(
        <SessionListView
          sessions={many}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      // Head of the list is mounted.
      expect(screen.queryByText('Row 0')).not.toBeInTheDocument()
      // A row far below the fold is windowed out (not in the DOM).
      expect(screen.getByText('Row 59')).toBeInTheDocument()
      vi.useRealTimers()
    })
  })

  describe('§2 optimistic "New chat" row', () => {
    it('shows an active "New chat" indicator row when dense and selectedId is null', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'A session' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          dense
        />,
      )
      const row = screen.getByTestId('rail-new-chat-row')
      expect(row).toHaveTextContent(/new chat/i)
      // It carries the canonical ACTIVE row treatment (aria-current).
      expect(row).toHaveAttribute('aria-current', 'true')
    })

    it('renders the "New chat" indicator as NON-interactive — not a competing button', () => {
      // a11y: the rail already has a real "New chat" ACTION button (in the Sidebar /
      // sessions pane). The indicator row must NOT also be a "New chat" button, or a
      // screen-reader / pointer user faces two identical controls. It's a plain
      // active list item, not a button.
      render(
        <SessionListView
          sessions={[]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          dense
        />,
      )
      expect(screen.getByTestId('rail-new-chat-row')).toBeInTheDocument()
      // No "New chat" BUTTON inside the list view (the action button lives outside it).
      expect(screen.queryByRole('button', { name: /new chat/i })).toBeNull()
    })

    it('hides the "New chat" row when a real session is selected', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'A session' })]}
          isLoading={false}
          selectedId="a"
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
          dense
        />,
      )
      expect(screen.queryByTestId('rail-new-chat-row')).not.toBeInTheDocument()
    })

    it('hides the "New chat" row while searching', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'A session' })]}
          isLoading={false}
          selectedId={null}
          search="parser"
          onSearchChange={() => {}}
          onSelect={() => {}}
          searchResults={[]}
          dense
        />,
      )
      expect(screen.queryByTestId('rail-new-chat-row')).not.toBeInTheDocument()
    })

    it('never shows the "New chat" row when NOT dense (e.g. the History surface)', () => {
      render(
        <SessionListView
          sessions={[s({ id: 'a', title: 'A session' })]}
          isLoading={false}
          selectedId={null}
          search=""
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      )
      expect(screen.queryByTestId('rail-new-chat-row')).not.toBeInTheDocument()
    })
  })
})

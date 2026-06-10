import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AgentMemoryTabs } from './AgentMemoryTabs'

// Shiki pulls real WASM; stub the read viewer + the lazy CodeMirror editor to
// keep the test light and synchronous (the editor is a plain textarea here).
vi.mock('@/features/files/CodeView', () => ({
  CodeView: ({ code }: { code: string }) => <pre data-testid="code-view">{code}</pre>,
}))
vi.mock('@/features/files/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

/** A fetch router over the profile-file and memory-provider BFF routes, capturing writes. */
function mockApi(
  initial: Record<string, string> = {},
  initialMemoryStatus = {
    active: '',
    providers: [{ name: 'mem0', description: 'Mem0 cloud memory', configured: true }],
    builtin_files: { memory: 2048, user: 1024 },
  },
) {
  const puts: Array<{ url: string; body: unknown }> = []
  const posts: Array<{ url: string; body: unknown }> = []
  const store: Record<string, string> = { ...initial }
  let memoryStatus = initialMemoryStatus
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/agent-deck/memory-provider')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { provider: string }
          puts.push({ url, body })
          memoryStatus = { ...memoryStatus, active: body.provider }
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, active: body.provider, restart_required: true }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => memoryStatus } as Response
      }

      if (url.endsWith('/api/agent-deck/memory-provider/reset')) {
        const body = JSON.parse(String(init?.body)) as { target: 'all' | 'memory' | 'user' }
        posts.push({ url, body })
        memoryStatus = {
          ...memoryStatus,
          builtin_files: {
            memory:
              body.target === 'all' || body.target === 'memory'
                ? 0
                : memoryStatus.builtin_files.memory,
            user:
              body.target === 'all' || body.target === 'user' ? 0 : memoryStatus.builtin_files.user,
          },
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, deleted: ['MEMORY.md', 'USER.md'] }),
        } as Response
      }

      const kind = url.split('/').pop() ?? ''
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string }
        puts.push({ url, body })
        store[kind] = body.content
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      }
      const content = store[kind] ?? ''
      return {
        ok: true,
        status: 200,
        json: async () => ({ content, exists: content !== '' }),
      } as Response
    }),
  )
  return { puts, posts }
}

/** Surfaces the current `?tab=` so tests can assert the URL drives the tab. */
function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc-search">{loc.search}</span>
}

function renderTabs({
  isActive = true,
  initialEntries = ['/profiles/atlas'],
}: { isActive?: boolean; initialEntries?: string[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <AgentMemoryTabs profile="atlas" isActive={isActive} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('AgentMemoryTabs — editable Soul / Memory / User', () => {
  it('exposes all three tabs and NONE is read-only', async () => {
    mockApi({ soul: '# soul', memory: '# memory', user: '# user' })
    renderTabs()
    const tablist = await screen.findByRole('tablist', { name: /agent files & skills/i })
    for (const label of ['Soul', 'Memory', 'User']) {
      expect(within(tablist).getByRole('tab', { name: label })).toBeInTheDocument()
    }
    expect(within(tablist).getByRole('tab', { name: 'Provider' })).toBeInTheDocument()
    // Every file tab offers Edit (no Read-only lock anywhere).
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
  })

  it('is a keyboard-operable tablist: arrow keys rove + activate, panel is wired', async () => {
    mockApi({ soul: '# soul', memory: '# memory', user: '# user' })
    const user = userEvent.setup()
    renderTabs()

    const soulTab = await screen.findByRole('tab', { name: 'Soul' })
    // Roving tabindex: only the selected tab is in the tab order.
    expect(soulTab).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('tabindex', '-1')

    // The active panel is wired back to its tab (aria-controls / aria-labelledby).
    const panelId = soulTab.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = await screen.findByRole('tabpanel')
    expect(panel).toHaveAttribute('id', panelId)
    expect(panel).toHaveAttribute('aria-labelledby', soulTab.id)

    // ArrowRight moves selection to Memory and focuses it.
    soulTab.focus()
    await user.keyboard('{ArrowRight}')
    const memoryTab = screen.getByRole('tab', { name: 'Memory' })
    expect(memoryTab).toHaveAttribute('aria-selected', 'true')
    expect(memoryTab).toHaveFocus()
  })

  it('is mobile-safe: the tab strip is a fitted grid (no overflow) with >=44px touch targets', async () => {
    mockApi({ soul: '# soul', memory: '# memory', user: '# user' })
    renderTabs()
    const tablist = await screen.findByRole('tablist', { name: /agent files & skills/i })
    // At ~375px the strip is a fitted 5-up grid (mirrors Connections), not an
    // inline strip that overflows the page's px-6 gutter.
    expect(tablist.className).toContain('grid-cols-5')
    // Every tab keeps a >=44px tap target on phones (WCAG 2.5.8).
    for (const tab of within(tablist).getAllByRole('tab')) {
      expect(tab.className).toContain('min-h-11')
    }
  })

  it('keeps the honest memory-provider boundary note', async () => {
    mockApi()
    renderTabs()
    expect(await screen.findByTestId('agent-memory-boundary')).toHaveTextContent(
      /does not stop the agent forgetting/i,
    )
  })

  it('edits and saves MEMORY.md via PUT /profiles/atlas/memory', async () => {
    const { puts } = mockApi({ memory: '# old memory' })
    const user = userEvent.setup()
    renderTabs()

    // Switch to the Memory tab.
    await user.click(await screen.findByRole('tab', { name: 'Memory' }))
    await waitFor(() => expect(screen.getByTestId('code-view')).toHaveTextContent('# old memory'))

    // Edit → type → Save.
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('editor')
    await user.clear(editor)
    await user.type(editor, '# new memory')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const memPut = puts.find((p) => p.url.endsWith('/profiles/atlas/memory'))
      expect(memPut?.body).toMatchObject({ content: '# new memory' })
    })
  })

  it('edits and saves USER.md via PUT /profiles/atlas/user', async () => {
    const { puts } = mockApi({ user: 'old user' })
    const user = userEvent.setup()
    renderTabs()

    await user.click(await screen.findByRole('tab', { name: 'User' }))
    await waitFor(() => expect(screen.getByTestId('code-view')).toHaveTextContent('old user'))

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('editor')
    await user.clear(editor)
    await user.type(editor, 'new user facts')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const userPut = puts.find((p) => p.url.endsWith('/profiles/atlas/user'))
      expect(userPut?.body).toMatchObject({ content: 'new user facts' })
    })
  })

  it('mounts the Provider tab and wires fetch, switch, and reset through the memory API', async () => {
    const { puts, posts } = mockApi()
    const user = userEvent.setup()
    renderTabs()

    await user.click(await screen.findByRole('tab', { name: 'Provider' }))
    expect(await screen.findByText(/memory provider/i)).toBeInTheDocument()
    expect(screen.getByText(/configured.*not.*necessarily.*connected/i)).toBeInTheDocument()
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument()
    expect(screen.getByText('2 KiB')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /provider.*available/i }))
    await user.click(screen.getByRole('button', { name: /mem0/i }))
    await waitFor(() => {
      const providerPut = puts.find((p) => p.url.endsWith('/api/agent-deck/memory-provider'))
      expect(providerPut?.body).toMatchObject({ provider: 'mem0' })
    })
    expect(await screen.findByText(/restart to apply/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /reset all memory/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    await user.click(within(dialog).getByRole('button', { name: /reset memory/i }))
    await waitFor(() => {
      const resetPost = posts.find((p) => p.url.endsWith('/api/agent-deck/memory-provider/reset'))
      expect(resetPost?.body).toMatchObject({ target: 'all' })
    })
  })

  it('drives the active tab from ?tab= so a refresh/deep-link restores it (not always Soul)', async () => {
    mockApi({ soul: '# soul', memory: '# memory', user: '# user' })
    // Land directly on the Memory tab via the URL (a refresh on Memory).
    renderTabs({ initialEntries: ['/profiles/atlas?tab=memory'] })
    const memoryTab = await screen.findByRole('tab', { name: 'Memory' })
    expect(memoryTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Soul' })).toHaveAttribute('aria-selected', 'false')
  })

  it('mounts the Skills tab with the local view and the Browse hub entry point', async () => {
    mockApi({ soul: '# soul' })
    renderTabs({ initialEntries: ['/profiles/atlas?tab=skills'] })
    expect(await screen.findByRole('tab', { name: 'Skills' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The local/hub source switch renders, local first (the hub panel mounts on demand).
    const sourceSwitch = await screen.findByRole('group', { name: /skills source/i })
    expect(within(sourceSwitch).getByRole('button', { name: /your skills/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(sourceSwitch).getByRole('button', { name: /browse hub/i })).toBeInTheDocument()
  })

  it('writes ?tab= when a tab is clicked (so a subsequent refresh stays put)', async () => {
    mockApi({ soul: '# soul', user: '# user' })
    const user = userEvent.setup()
    renderTabs()
    await user.click(await screen.findByRole('tab', { name: 'User' }))
    await waitFor(() => expect(screen.getByTestId('loc-search')).toHaveTextContent('?tab=user'))
  })

  it('falls back to Soul for an unknown ?tab= value', async () => {
    mockApi({ soul: '# soul' })
    renderTabs({ initialEntries: ['/profiles/atlas?tab=bogus'] })
    expect(await screen.findByRole('tab', { name: 'Soul' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('guards a tab switch while a draft is dirty: confirms before discarding, keeps draft on cancel', async () => {
    mockApi({ soul: '# old soul', user: '# user' })
    const user = userEvent.setup()
    renderTabs()

    // Edit Soul → dirty.
    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('editor')
    await user.clear(editor)
    await user.type(editor, '# edited soul')

    // Clicking another tab must NOT silently switch — it asks first. (The modal
    // confirm marks the tab strip aria-hidden, so we assert via the URL probe,
    // which is a sibling and still queryable by testid.)
    await user.click(screen.getByRole('tab', { name: 'User' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/unsaved changes/i)
    // The switch is held back: the URL has NOT moved to ?tab=user yet.
    expect(screen.getByTestId('loc-search')).not.toHaveTextContent('tab=user')

    // Cancel ("Stay") → dialog closes, still on Soul, still editing the same draft.
    await user.click(within(dialog).getByRole('button', { name: /stay/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Soul' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('loc-search')).not.toHaveTextContent('tab=user')
    expect(screen.getByLabelText('editor')).toHaveValue('# edited soul')
  })

  it('discards the draft and switches when the guard is confirmed', async () => {
    mockApi({ soul: '# old soul', user: '# user' })
    const user = userEvent.setup()
    renderTabs()

    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('editor')
    await user.clear(editor)
    await user.type(editor, '# edited soul')

    await user.click(screen.getByRole('tab', { name: 'User' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /discard changes/i }))

    // Now on the User tab, the discarded Soul edit gone (no save fired).
    await waitFor(() => expect(screen.getByTestId('loc-search')).toHaveTextContent('?tab=user'))
    expect(screen.getByRole('tab', { name: 'User' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps active-profile-only Provider controls disabled for inactive agents', async () => {
    const { puts, posts } = mockApi()
    const user = userEvent.setup()
    renderTabs({ isActive: false })

    await user.click(await screen.findByRole('tab', { name: 'Provider' }))
    expect(await screen.findByRole('note')).toHaveTextContent(/active agent only/i)

    await user.click(screen.getByRole('button', { name: /provider.*available/i }))
    expect(screen.getByRole('button', { name: /mem0/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reset all memory/i })).toBeDisabled()
    expect(puts.some((p) => p.url.endsWith('/api/agent-deck/memory-provider'))).toBe(false)
    expect(posts.some((p) => p.url.endsWith('/api/agent-deck/memory-provider/reset'))).toBe(false)
  })
})

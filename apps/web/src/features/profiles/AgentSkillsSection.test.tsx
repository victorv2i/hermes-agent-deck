import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentSkillsSection } from './AgentSkillsSection'
import * as hubApi from '@/features/skills/hubApi'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// The hub view mounts the REAL SkillsHubPanel; mock its API module (same recipe
// as SkillsHubPanel.test.tsx) so the wiring tests drive the real panel offline.
vi.mock('@/features/skills/hubApi')

// The skill editor reuses the lazily-loaded CodeMirror editor; mock it to a
// plain textarea so the dialog renders synchronously in jsdom (same recipe the
// memory-tabs test uses). This proves the reuse without loading CodeMirror.
vi.mock('@/features/files/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const skills = [
  {
    name: 'web-search',
    description: 'Search the web for answers.',
    category: 'research',
    enabled: true,
    path: 'research/web-search',
  },
  {
    name: 'shell',
    description: 'Run shell commands in the workspace.',
    category: 'system',
    enabled: false,
    path: 'system/shell',
  },
]

/** A fetch router over the skills BFF, capturing toggles + CRUD calls. */
function mockApi() {
  const toggles: Array<{ name: string; enabled: boolean }> = []
  const creates: Array<{ name: string; category?: string }> = []
  const deletes: string[] = []
  const bodyWrites: Array<{ path: string; content: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.endsWith('/skills/toggle') && method === 'PUT') {
        const body = JSON.parse(String(init!.body)) as { name: string; enabled: boolean }
        toggles.push(body)
        return { ok: true, status: 200, json: async () => body } as Response
      }
      if (url.includes('/skills/body') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: 'research/web-search',
            content: '# body',
            exists: true,
            hasExtraFiles: false,
          }),
        } as Response
      }
      if (url.endsWith('/skills/body') && method === 'PUT') {
        bodyWrites.push(JSON.parse(String(init!.body)) as { path: string; content: string })
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      }
      if (url.endsWith('/skills') && method === 'POST') {
        const body = JSON.parse(String(init!.body)) as { name: string; category?: string }
        creates.push(body)
        const path = body.category ? `${body.category}/${body.name}` : body.name
        return { ok: true, status: 201, json: async () => ({ path }) } as Response
      }
      if (url.endsWith('/skills') && method === 'DELETE') {
        const body = JSON.parse(String(init!.body)) as { path: string }
        deletes.push(body.path)
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      }
      if (url.endsWith('/skills'))
        return { ok: true, status: 200, json: async () => ({ skills }) } as Response
      return { ok: true, status: 200, json: async () => ({}) } as Response
    }),
  )
  return { toggles, creates, deletes, bodyWrites }
}

function renderSection(active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AgentSkillsSection isActive={active} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('AgentSkillsSection — click-to-expand skills, scoped to the active agent', () => {
  it('lists skills as collapsed rows showing name + category', async () => {
    mockApi()
    renderSection()
    await screen.findByText('web-search')
    expect(screen.getByText('shell')).toBeInTheDocument()
    // The description detail is collapsed (not in the document) until expanded.
    expect(screen.queryByText(/search the web for answers/i)).not.toBeInTheDocument()
  })

  it('expands a row on click to reveal the description/detail', async () => {
    mockApi()
    const user = userEvent.setup()
    renderSection()
    const row = await screen.findByRole('button', { name: /web-search/i })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(/search the web for answers/i)).toBeInTheDocument()
  })

  it('toggles a skill via PUT (scoped to the active agent)', async () => {
    const { toggles } = mockApi()
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('shell')
    await user.click(screen.getByRole('switch', { name: /enable shell/i }))
    await waitFor(() => expect(toggles).toContainEqual({ name: 'shell', enabled: true }))
  })

  it('makes the active-profile scope explicit/honest in copy', async () => {
    mockApi()
    renderSection(true)
    await screen.findByText('web-search')
    expect(screen.getByRole('note')).toHaveTextContent(/changes the active agent’s skills/i)
  })

  it('when this agent is NOT active, says so and disables the toggles (honest, no fake state)', async () => {
    mockApi()
    renderSection(false)
    await screen.findByText('web-search')
    // The scope note explains the toggle acts on the active agent, not this one.
    expect(screen.getByText(/switch to this agent/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /enable shell/i })).toBeDisabled()
  })
})

describe('AgentSkillsSection — local/hub view switch', () => {
  it('shows the Browse hub entry point with the local list as the default view', async () => {
    mockApi()
    renderSection()
    await screen.findByText('web-search')
    // Both segments render; local is the pressed default, the hub panel is not mounted.
    expect(screen.getByRole('button', { name: /your skills/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /browse hub/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByRole('searchbox', { name: /search skills hub/i })).not.toBeInTheDocument()
  })

  it('switching to Browse hub mounts the SkillsHubPanel and the install path works', async () => {
    mockApi()
    vi.mocked(hubApi.searchHub).mockResolvedValue({
      results: [
        {
          name: 'axolotl',
          description: 'Fine-tune models at home',
          source: 'nous',
          identifier: 'nous/axolotl',
          trust_level: 'official',
          repo: null,
          tags: [],
        },
      ],
    })
    vi.mocked(hubApi.installSkill).mockResolvedValue({
      ok: true,
      action: 'skills-install',
      restartRequired: true,
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: /browse hub/i }))
    // The real panel: search the hub, get a result, install it.
    await user.type(screen.getByRole('searchbox', { name: /search skills hub/i }), 'axolotl')
    await screen.findByText('axolotl')
    await user.click(screen.getByRole('button', { name: /install axolotl/i }))
    await waitFor(() => expect(vi.mocked(hubApi.installSkill)).toHaveBeenCalledWith('nous/axolotl'))
    // The honest restart-to-apply note after a hub install stays visible.
    expect(await screen.findByText(/restart required to apply/i)).toBeInTheDocument()
  })

  it('switching back to Your skills restores the local list and flow', async () => {
    mockApi()
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('web-search')
    await user.click(screen.getByRole('button', { name: /browse hub/i }))
    expect(screen.queryByText('web-search')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /your skills/i }))
    expect(await screen.findByText('web-search')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new skill/i })).toBeInTheDocument()
  })
})

describe('AgentSkillsSection — create / edit / delete', () => {
  it('opens the editor for a skill and saves its body via PUT', async () => {
    const { bodyWrites } = mockApi()
    const user = userEvent.setup()
    renderSection()
    // Expand the row, then click Edit.
    await user.click(await screen.findByRole('button', { name: /web-search/i }))
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    // The reused editor (mocked textarea) appears, seeded with the loaded body.
    const editor = await screen.findByLabelText('editor')
    await user.clear(editor)
    await user.type(editor, '# edited')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(bodyWrites).toContainEqual({ path: 'research/web-search', content: '# edited' }),
    )
  })

  it('creates a new skill via POST from the New skill dialog', async () => {
    const { creates } = mockApi()
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('web-search')
    await user.click(screen.getByRole('button', { name: /new skill/i }))
    await user.type(await screen.findByLabelText(/^name$/i), 'my-skill')
    await user.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(creates).toContainEqual({ name: 'my-skill' }))
  })

  it('blocks Create until the name is a valid segment (honest validation)', async () => {
    mockApi()
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('web-search')
    await user.click(screen.getByRole('button', { name: /new skill/i }))
    await user.type(await screen.findByLabelText(/^name$/i), 'Bad Name!')
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  it('deletes a skill only after the confirm dialog (confirm-gated)', async () => {
    const { deletes } = mockApi()
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: /web-search/i }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    // The confirm dialog appears; the delete has NOT fired yet.
    expect(await screen.findByRole('heading', { name: /delete skill\?/i })).toBeInTheDocument()
    expect(deletes).toHaveLength(0)
    // Confirm in the dialog.
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deletes).toContainEqual('research/web-search'))
  })

  it('disables edit/delete when a skill has no resolvable on-disk path (honest)', async () => {
    // A skill whose path is null (e.g. managed outside our folder).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/skills'))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              skills: [
                { name: 'external', description: 'd', category: null, enabled: true, path: null },
              ],
            }),
          } as Response
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }),
    )
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: /external/i }))
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkillsSection } from './SkillsSection'
import type { StudioSkill } from '../data/api'
import * as skillsApi from '@/features/skills/api'
import * as hubApi from '@/features/skills/hubApi'

// The local list + toggle arrive as props (the panel runs the profile-scoped
// GET/PUT). The hub + create/edit/delete reuse the `features/skills` data layer,
// which is active-profile scoped, so those endpoints are mocked here.
vi.mock('@/features/skills/api')
vi.mock('@/features/skills/hubApi')
// The editor lazy-loads CodeMirror; stub it so the dialog renders without the
// ThemeProvider (its own tests cover the editor).
vi.mock('@/features/files/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="skill editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const SKILLS: StudioSkill[] = [
  {
    name: 'web-search',
    description: 'Search the web for answers.',
    category: 'research',
    enabled: true,
  },
  {
    name: 'shell',
    description: 'Run shell commands in the workspace.',
    category: 'system',
    enabled: false,
  },
]

function renderSection(props: Partial<React.ComponentProps<typeof SkillsSection>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SkillsSection
        agent="coder"
        isActive
        skills={SKILLS}
        isLoading={false}
        error={null}
        onToggle={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The on-disk skill list (active-profile scoped) backs edit/delete paths.
  vi.mocked(skillsApi.fetchSkills).mockResolvedValue({
    skills: [
      {
        name: 'web-search',
        description: '',
        category: 'research',
        enabled: true,
        path: 'research/web-search',
      },
      { name: 'shell', description: '', category: 'system', enabled: false, path: 'system/shell' },
    ],
  })
  vi.mocked(skillsApi.createSkill).mockResolvedValue({ path: 'new-skill' })
  vi.mocked(skillsApi.deleteSkill).mockResolvedValue({ ok: true })
  vi.mocked(skillsApi.fetchSkillBody).mockResolvedValue({
    path: 'research/web-search',
    content: '# web-search',
    exists: true,
    hasExtraFiles: false,
  })
  vi.mocked(skillsApi.writeSkillBody).mockResolvedValue({ ok: true })
  vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [] })
  vi.mocked(hubApi.installSkill).mockResolvedValue({
    ok: true,
    action: 'skills-install',
    restartRequired: true,
  })
  vi.mocked(hubApi.updateAllSkills).mockResolvedValue({
    ok: true,
    action: 'skills-update',
    restartRequired: false,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SkillsSection', () => {
  it('lists each skill as a collapsed row with name + category', () => {
    renderSection()
    expect(screen.getByText('web-search')).toBeInTheDocument()
    expect(screen.getByText('shell')).toBeInTheDocument()
    // The description is collapsed until the row is expanded.
    expect(screen.queryByText(/search the web for answers/i)).not.toBeInTheDocument()
  })

  it('reflects each skill enabled state on its switch', () => {
    renderSection()
    expect(screen.getByRole('switch', { name: /disable web-search/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: /enable shell/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('expands a row on click to reveal the description', async () => {
    renderSection()
    const row = screen.getByRole('button', { name: /web-search/i })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/search the web for answers/i)).toBeInTheDocument()
  })

  it('toggles a skill by name (the profile-scoped panel handles which agent)', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    renderSection({ onToggle })
    const sw = screen.getByRole('switch', { name: /enable shell/i })
    // The switch is NOT disabled for the active agent.
    expect(sw).not.toBeDisabled()
    await userEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith('shell', true)
  })

  it('locks only the pending skill switch while its toggle is in flight', () => {
    renderSection({ pending: new Set(['shell']) })
    expect(screen.getByRole('switch', { name: /enable shell/i })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /disable web-search/i })).not.toBeDisabled()
  })

  it('surfaces an honest restart-to-apply note + the enabled count', () => {
    renderSection()
    expect(screen.getByText(/restart your agent to apply skill changes/i)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    renderSection({ skills: undefined, isLoading: true })
    expect(screen.getByTestId('studio-skills-skeleton')).toBeInTheDocument()
  })

  it('shows an error state with the message', () => {
    renderSection({
      skills: undefined,
      isLoading: false,
      error: 'The hermes dashboard may be offline.',
    })
    expect(screen.getByText("Couldn't load skills")).toBeInTheDocument()
    expect(screen.getByText(/hermes dashboard may be offline/i)).toBeInTheDocument()
  })

  it('shows an empty state when the active agent has no skills, with a Create action', () => {
    renderSection({ skills: [] })
    expect(screen.getByText('No skills yet')).toBeInTheDocument()
    // The empty-state copy no longer points at a retired surface; managed here.
    expect(screen.queryByText(/skills surface/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new skill/i })).toBeInTheDocument()
  })

  describe('active agent: full management UI', () => {
    it('offers a Browse hub view that searches the hub', async () => {
      vi.mocked(hubApi.searchHub).mockResolvedValue({
        results: [
          {
            name: 'axolotl',
            description: 'Fine-tune models',
            source: 'nous',
            identifier: 'nous/axolotl',
            trust_level: 'official',
            repo: 'https://example.com/axolotl',
            tags: [],
          },
        ],
      })
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /browse hub/i }))
      const searchbox = await screen.findByRole('searchbox')
      await userEvent.type(searchbox, 'axolotl')
      await waitFor(() => {
        expect(vi.mocked(hubApi.searchHub)).toHaveBeenCalledWith('axolotl', expect.anything())
      })
      expect(await screen.findByText('axolotl')).toBeInTheDocument()
    })

    it('installs a hub skill (wires install)', async () => {
      vi.mocked(hubApi.searchHub).mockResolvedValue({
        results: [
          {
            name: 'axolotl',
            description: 'Fine-tune models',
            source: 'nous',
            identifier: 'nous/axolotl',
            trust_level: 'official',
            repo: 'https://example.com/axolotl',
            tags: [],
          },
        ],
      })
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /browse hub/i }))
      await userEvent.type(await screen.findByRole('searchbox'), 'ax')
      await screen.findByText('axolotl')
      await userEvent.click(screen.getByRole('button', { name: /install axolotl/i }))
      await waitFor(() => {
        expect(vi.mocked(hubApi.installSkill)).toHaveBeenCalledWith('nous/axolotl')
      })
    })

    it('creates a new skill via the New skill dialog (wires create)', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /new skill/i }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText(/^name$/i), 'my-skill')
      await userEvent.click(within(dialog).getByRole('button', { name: /create/i }))
      await waitFor(() => {
        expect(vi.mocked(skillsApi.createSkill)).toHaveBeenCalledWith('my-skill', null)
      })
    })

    it('opens the editor for a row and saves (wires edit)', async () => {
      const user = userEvent.setup()
      renderSection()
      // Wait for the on-disk skill list to resolve so the row exposes a path.
      await waitFor(() => expect(vi.mocked(skillsApi.fetchSkills)).toHaveBeenCalled())
      await user.click(screen.getByRole('button', { name: /web-search/i }))
      await user.click(await screen.findByRole('button', { name: /^edit$/i }))
      const dialog = await screen.findByRole('dialog')
      const editor = await within(dialog).findByLabelText('skill editor')
      await user.type(editor, ' edit')
      await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
      await waitFor(() => {
        expect(vi.mocked(skillsApi.writeSkillBody)).toHaveBeenCalledWith(
          'research/web-search',
          expect.stringContaining('edit'),
        )
      })
    })

    it('deletes a row after confirming (wires delete)', async () => {
      const user = userEvent.setup()
      renderSection()
      await waitFor(() => expect(vi.mocked(skillsApi.fetchSkills)).toHaveBeenCalled())
      await user.click(screen.getByRole('button', { name: /web-search/i }))
      await user.click(await screen.findByRole('button', { name: /^delete$/i }))
      // Confirm in the destructive dialog (delete is never one click).
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
      await waitFor(() => {
        expect(vi.mocked(skillsApi.deleteSkill)).toHaveBeenCalledWith('research/web-search')
      })
    })
  })

  describe('non-active agent: toggle + honest note only', () => {
    it('shows the active-only note and hides authoring controls', () => {
      renderSection({ isActive: false })
      // Honest note that authoring is active-profile only.
      expect(screen.getByText(/switch to this agent/i)).toBeInTheDocument()
      // No New skill / hub authoring affordances.
      expect(screen.queryByRole('button', { name: /new skill/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /browse hub/i })).not.toBeInTheDocument()
    })

    it('still lets the toggle work (the toggle is profile-scoped)', async () => {
      const onToggle = vi.fn().mockResolvedValue(undefined)
      renderSection({ isActive: false, onToggle })
      const sw = screen.getByRole('switch', { name: /enable shell/i })
      expect(sw).not.toBeDisabled()
      await userEvent.click(sw)
      expect(onToggle).toHaveBeenCalledWith('shell', true)
    })

    it('does not expose edit/delete on an expanded row', async () => {
      renderSection({ isActive: false })
      await userEvent.click(screen.getByRole('button', { name: /web-search/i }))
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    })

    it('does not fetch the on-disk skill list for a non-active agent', async () => {
      renderSection({ isActive: false })
      // Give a tick for any stray query to fire.
      await new Promise((r) => setTimeout(r, 50))
      expect(vi.mocked(skillsApi.fetchSkills)).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@agent-deck/protocol'
import { ProjectsSection, SESSION_DRAG_TYPE } from './ProjectsSection'

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', color: 'violet' },
  { id: 'p2', name: 'Beta', color: 'teal' },
]

function setup(over: Partial<React.ComponentProps<typeof ProjectsSection>> = {}) {
  const onSelectProject = vi.fn()
  const onCreateProject = vi.fn().mockResolvedValue(undefined)
  render(
    <ProjectsSection
      projects={projects}
      selectedProjectId={null}
      onSelectProject={onSelectProject}
      counts={new Map([['p1', 3]])}
      totalCount={9}
      onCreateProject={onCreateProject}
      {...over}
    />,
  )
  return { onSelectProject, onCreateProject }
}

/** A minimal jsdom dataTransfer carrying a dragged session id (jsdom has no real
 * DataTransfer), matching what the row's onDragStart seeds. */
function sessionDataTransfer(sessionId: string) {
  return {
    types: [SESSION_DRAG_TYPE],
    getData: (type: string) => (type === SESSION_DRAG_TYPE ? sessionId : ''),
    dropEffect: 'none',
    effectAllowed: 'all',
  }
}

describe('ProjectsSection', () => {
  it('labels the section "Folders" (Claude-app copy) for the toggle, region, and new-folder action', () => {
    setup()
    // The user-facing copy is "Folders" everywhere; the internal model stays `project`.
    expect(screen.getByRole('button', { name: /^Folders$/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /folders/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New folder/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Projects$/ })).not.toBeInTheDocument()
  })

  it('renders "All sessions" + every project with its count as a radiogroup', () => {
    setup()
    const group = screen.getByRole('radiogroup', { name: /filter sessions by folder/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3) // All sessions + 2 projects
    expect(within(group).getByText('All sessions')).toBeInTheDocument()
    expect(within(group).getByText('Alpha')).toBeInTheDocument()
    expect(within(group).getByText('9')).toBeInTheDocument() // total
    expect(within(group).getByText('3')).toBeInTheDocument() // p1 count
    expect(within(group).getByText('0')).toBeInTheDocument() // p2 (no count → 0)
  })

  it('marks the selected project radio as checked', () => {
    setup({ selectedProjectId: 'p1' })
    const group = screen.getByRole('radiogroup', { name: /filter sessions by folder/i })
    const alpha = within(group).getByRole('radio', { name: /Alpha/ })
    expect(alpha).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: /All sessions/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('uses the CANONICAL amber active-row treatment for the selected row (matches the rail)', () => {
    // The corrected docstring: selection reuses the sky-blue tint + sky-blue leading
    // accent bar (the same pattern as the Sidebar nav + session rows), NOT a
    // "neutral-tint" treatment. Guards against the docstring drifting back.
    setup({ selectedProjectId: 'p1' })
    const group = screen.getByRole('radiogroup', { name: /filter sessions by folder/i })
    const alpha = within(group).getByRole('radio', { name: /Alpha/ })
    expect(alpha.className).toContain('bg-primary/10')
    expect(alpha.className).toContain('before:bg-primary')
    expect(alpha.className).toContain('before:opacity-100')
  })

  it('selects a project on click', async () => {
    const user = userEvent.setup()
    const { onSelectProject } = setup()
    await user.click(screen.getByRole('radio', { name: /Beta/ }))
    expect(onSelectProject).toHaveBeenCalledWith('p2')
  })

  it('selecting "All sessions" clears the project filter (null)', async () => {
    const user = userEvent.setup()
    const { onSelectProject } = setup({ selectedProjectId: 'p1' })
    await user.click(screen.getByRole('radio', { name: /All sessions/ }))
    expect(onSelectProject).toHaveBeenCalledWith(null)
  })

  it('collapses + expands the section', async () => {
    const user = userEvent.setup()
    setup()
    const toggle = screen.getByRole('button', { name: /^Folders$/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('radiogroup', { name: /filter sessions by folder/i }),
    ).not.toBeInTheDocument()
  })

  it('creates a project from the New project form (name + curated color)', async () => {
    const user = userEvent.setup()
    const { onCreateProject } = setup()
    await user.click(screen.getByRole('button', { name: /New folder/i }))
    const name = await screen.findByLabelText('Folder name')
    await user.type(name, 'Gamma')
    // The color picker is a radiogroup of curated swatches; pick one.
    const colorGroup = screen.getByRole('radiogroup', { name: /folder color/i })
    await user.click(within(colorGroup).getByRole('radio', { name: 'Teal' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreateProject).toHaveBeenCalledWith({ name: 'Gamma', color: 'teal' })
  })

  it('disables Create until a name is entered', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /New folder/i }))
    expect(await screen.findByRole('button', { name: 'Create' })).toBeDisabled()
  })

  describe('Phase 2 — drag-to-organize drop targets', () => {
    it('assigns a dropped session to the folder it lands on', () => {
      const onDropSession = vi.fn()
      setup({ onDropSession })
      const beta = screen.getByRole('radio', { name: /Beta/ })
      fireEvent.drop(beta, { dataTransfer: sessionDataTransfer('s-7') })
      expect(onDropSession).toHaveBeenCalledWith('p2', 's-7')
    })

    it('removes a dropped session from any folder when dropped on "All sessions"', () => {
      const onDropSession = vi.fn()
      setup({ onDropSession })
      const all = screen.getByRole('radio', { name: /All sessions/ })
      fireEvent.drop(all, { dataTransfer: sessionDataTransfer('s-9') })
      expect(onDropSession).toHaveBeenCalledWith(null, 's-9')
    })

    it('is not a drop target when onDropSession is not wired (no-op drop)', () => {
      setup()
      const beta = screen.getByRole('radio', { name: /Beta/ })
      // Without a handler the row simply doesn't accept the drop; nothing throws.
      expect(() => fireEvent.drop(beta, { dataTransfer: sessionDataTransfer('s-1') })).not.toThrow()
    })
  })
})

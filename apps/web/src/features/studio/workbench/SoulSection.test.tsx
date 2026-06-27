import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SoulFile } from '../data/api'
import { SoulSection } from './SoulSection'

// CodeMirror is heavy + lazy; stub the editor with a plain textarea so the
// edit/save flow is testable without the real CodeMirror runtime.
vi.mock('@/features/files/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="soul editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// CodeView (read mode) reaches for the ThemeProvider + Shiki; stub it to a plain
// <pre> so the read view is testable without that chrome (its own tests cover it).
vi.mock('@/features/files/CodeView', () => ({
  CodeView: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

const SOUL: SoulFile = { content: '# Mercury\nA careful agent.', exists: true }

describe('SoulSection', () => {
  it('reads the agent SOUL.md content', () => {
    render(<SoulSection soul={SOUL} isLoading={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText(/A careful agent/)).toBeInTheDocument()
  })

  it('edits and saves the soul through onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SoulSection soul={SOUL} isLoading={false} error={null} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('soul editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, '# New soul')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('# New soul'))
  })

  it('does not enable Save until the draft actually changes', async () => {
    render(<SoulSection soul={SOUL} isLoading={false} error={null} onSave={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    // Untouched draft equals the content → Save is disabled.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('offers to create a soul when none exists yet', () => {
    render(
      <SoulSection
        soul={{ content: '', exists: false }}
        isLoading={false}
        error={null}
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByText(/no soul yet/i)).toBeInTheDocument()
  })

  it('renders an error state without crashing', () => {
    render(<SoulSection soul={undefined} isLoading={false} error="nope" onSave={vi.fn()} />)
    expect(screen.getByText('nope')).toBeInTheDocument()
  })

  it('does not flash Saved or close the editor when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'))
    render(<SoulSection soul={SOUL} isLoading={false} error={null} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByLabelText('soul editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, '# Changed')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    // onSave was called
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    // Editor stays open (the save button is still visible)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
    // The "Saved" flash must NOT appear
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument()
  })
})

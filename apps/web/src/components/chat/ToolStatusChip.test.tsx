/**
 * Tests for ToolStatusChip — the live status chip shown while a tool is running.
 * Derived from REAL tool.started/tool.completed wire events only; no fabricated
 * step counts or plan sizes.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolStatusChip } from './ToolStatusChip'

describe('ToolStatusChip', () => {
  it('renders a live chip for a running tool with human label', () => {
    render(<ToolStatusChip tool="web_search" status="running" />)
    expect(screen.getByTestId('tool-status-chip')).toBeInTheDocument()
    expect(screen.getByText(/Searching the web/i)).toBeInTheDocument()
  })

  it('maps bash/shell to "Running code"', () => {
    render(<ToolStatusChip tool="bash" status="running" />)
    expect(screen.getByText(/Running code/i)).toBeInTheDocument()
  })

  it('maps read_file to "Reading file"', () => {
    render(<ToolStatusChip tool="read_file" status="running" />)
    expect(screen.getByText(/Reading file/i)).toBeInTheDocument()
  })

  it('maps write_file to "Writing file"', () => {
    render(<ToolStatusChip tool="write_file" status="running" />)
    expect(screen.getByText(/Writing file/i)).toBeInTheDocument()
  })

  it('maps edit_file to "Editing file"', () => {
    render(<ToolStatusChip tool="edit_file" status="running" />)
    expect(screen.getByText(/Editing file/i)).toBeInTheDocument()
  })

  it('maps web_fetch to "Fetching page"', () => {
    render(<ToolStatusChip tool="web_fetch" status="running" />)
    expect(screen.getByText(/Fetching page/i)).toBeInTheDocument()
  })

  it('falls back to the raw tool name for an unknown tool (honesty)', () => {
    render(<ToolStatusChip tool="spelunk_db" status="running" />)
    expect(screen.getByText(/spelunk_db/)).toBeInTheDocument()
  })

  it('renders a step counter ONLY from the real running count — never fabricated', () => {
    render(<ToolStatusChip tool="bash" status="running" stepNumber={3} />)
    // Should show "Step 3" (real count from caller)
    expect(screen.getByText(/Step 3/i)).toBeInTheDocument()
    // Should NOT show "of N" since there is no total (no plan enumeration on wire)
    expect(screen.queryByText(/of \d+/i)).not.toBeInTheDocument()
  })

  it('omits the step counter entirely when stepNumber is not provided', () => {
    render(<ToolStatusChip tool="bash" status="running" />)
    expect(screen.queryByText(/Step/i)).not.toBeInTheDocument()
  })

  it('uses the primary accent on the live dot (live state marker)', () => {
    render(<ToolStatusChip tool="web_search" status="running" />)
    const chip = screen.getByTestId('tool-status-chip')
    // The chip should have the live-state class
    expect(chip.className).toMatch(/text-primary/)
  })

  it('has an accessible label for screen readers', () => {
    render(<ToolStatusChip tool="web_search" status="running" />)
    const chip = screen.getByTestId('tool-status-chip')
    expect(chip).toHaveAttribute('aria-label')
    expect(chip.getAttribute('aria-label')).toMatch(/searching the web/i)
  })

  it('renders nothing when status is not running', () => {
    const { container } = render(<ToolStatusChip tool="bash" status="completed" />)
    expect(container).toBeEmptyDOMElement()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StudioConfigSubset } from '@agent-deck/protocol'
import { ToolsSection } from './ToolsSection'

const CONFIG: StudioConfigSubset = {
  toolsets: ['web', 'files', 'vision'],
  agent: { disabled_toolsets: ['vision'] },
}

describe('ToolsSection', () => {
  it('lists each enabled toolset with its effective on/off from disabled_toolsets', () => {
    render(<ToolsSection config={CONFIG} isLoading={false} error={null} onToggle={vi.fn()} />)
    // web is enabled and not blocked → switch on.
    expect(screen.getByRole('switch', { name: /web/i })).toHaveAttribute('aria-checked', 'true')
    // vision is enabled but in disabled_toolsets → switch off.
    expect(screen.getByRole('switch', { name: /vision/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('disabling a toolset ADDS it to disabled_toolsets (the blocklist)', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<ToolsSection config={CONFIG} isLoading={false} error={null} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch', { name: /web/i }))
    // The write sends the full intended disabled_toolsets list (existing + web).
    expect(onToggle).toHaveBeenCalledWith({
      agent: { disabled_toolsets: ['vision', 'web'] },
    })
  })

  it('re-enabling a blocked toolset REMOVES it from disabled_toolsets', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<ToolsSection config={CONFIG} isLoading={false} error={null} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch', { name: /vision/i }))
    expect(onToggle).toHaveBeenCalledWith({ agent: { disabled_toolsets: [] } })
  })

  it('surfaces an honest restart-to-apply note', () => {
    render(<ToolsSection config={CONFIG} isLoading={false} error={null} onToggle={vi.fn()} />)
    expect(screen.getByText(/restart/i)).toBeInTheDocument()
  })

  it('shows an empty state when no toolsets are enabled in config', () => {
    render(
      <ToolsSection config={{ toolsets: [] }} isLoading={false} error={null} onToggle={vi.fn()} />,
    )
    expect(screen.getByText('No toolsets enabled')).toBeInTheDocument()
  })
})

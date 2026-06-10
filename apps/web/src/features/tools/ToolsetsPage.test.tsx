import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AgentDeckToolset } from '@agent-deck/protocol'
import { ToolsetsPage } from './ToolsetsPage'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/features/cli-op/api', () => ({
  runCliOp: vi.fn().mockResolvedValue({ ok: true, stdout: '', summary: 'done', exitCode: 0 }),
}))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    toggleToolset: vi.fn().mockResolvedValue({ ok: true, name: 'web', enabled: true }),
  }
})

function toolset(over: Partial<AgentDeckToolset> = {}): AgentDeckToolset {
  return {
    name: 'web',
    label: 'Web Search & Scraping',
    description: 'web_search, web_extract',
    enabled: true,
    configured: true,
    tools: ['web_search', 'web_extract'],
    ...over,
  }
}

// ToolsetsPage uses react-router Link — wrap in MemoryRouter for tests.
function renderPage(
  toolsets: AgentDeckToolset[],
  onToggle?: (name: string, enabled: boolean) => Promise<void>,
) {
  return render(
    <MemoryRouter>
      <ToolsetsPage toolsets={toolsets} onToggle={onToggle} />
    </MemoryRouter>,
  )
}

describe('ToolsetsPage - toolsets inventory with real toggle', () => {
  it('renders the header + honest affordances', () => {
    renderPage([toolset()])
    expect(screen.getByRole('heading', { name: /tools/i })).toBeInTheDocument()
    // Plain-language framing for non-technical users: one-time setup step.
    expect(screen.getByText(/one-time setup step/i)).toBeInTheDocument()
  })

  it('shows each toolset with its label, key and resolved tools', () => {
    renderPage([toolset()])
    expect(screen.getByText('Web Search & Scraping')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(screen.getByText('web_extract')).toBeInTheDocument()
  })

  it('hides a description that just repeats the tool names (the chips already show them)', () => {
    renderPage([toolset({ description: 'web_search, web_extract' })])
    // The names appear once each — as the mono chips — not again in prose.
    expect(screen.getAllByText('web_search')).toHaveLength(1)
    expect(screen.queryByText('web_search, web_extract')).toBeNull()
  })

  it('still renders a real prose description', () => {
    renderPage([toolset({ description: 'Search the web and extract page content.' })])
    expect(screen.getByText('Search the web and extract page content.')).toBeInTheDocument()
  })

  it('renders a real toggle switch per toolset (stock has a write route)', () => {
    renderPage([toolset()])
    // Stock PUT /api/tools/toolsets/{name} exists → we render a real switch.
    const toggle = screen.getByRole('switch', { name: /web search/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('gives the toggle a comfortable >=44px hit target (min-h-11), not a 20px tap area', () => {
    renderPage([toolset()])
    // a11y: the clickable switch button carries the comfortable hit area even
    // though the switch VISUAL track stays compact (~20px).
    const toggle = screen.getByRole('switch', { name: /web search/i })
    expect(toggle.className).toContain('min-h-11')
  })

  it('toggle switch reflects disabled state', () => {
    renderPage([toolset({ name: 'image_gen', label: 'Image Generation', enabled: false })])
    const toggle = screen.getByRole('switch', { name: /image generation/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onToggle when the switch is clicked', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    renderPage([toolset()], onToggle)
    const toggle = screen.getByRole('switch', { name: /web search/i })
    fireEvent.click(toggle)
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('web', false))
  })

  it('shows ONE page-level "restart your agent to apply" notice (not one per card)', () => {
    renderPage([
      toolset({ name: 'web' }),
      toolset({ name: 'image_gen', label: 'Image Generation' }),
    ])
    // The honest restart notice must be visible (not hidden behind interaction),
    // and appear exactly once at page level rather than repeated on every card.
    expect(screen.getAllByText(/restart your agent to apply/i)).toHaveLength(1)
  })

  it('shows an honest enabled/disabled status (semantic, not amber)', () => {
    renderPage([
      toolset({ name: 'web', enabled: true }),
      toolset({ name: 'image_gen', label: 'Image Generation', enabled: false }),
    ])
    // The enabled count line is plain -- no jargon qualifier.
    expect(screen.getByText(/1 of 2 enabled/i)).toBeInTheDocument()
  })

  it('flags an enabled-but-unconfigured toolset honestly (missing key)', () => {
    renderPage([toolset({ enabled: true, configured: false })])
    expect(screen.getByText(/api key isn't set yet/i)).toBeInTheDocument()
  })

  it('does NOT show the missing-key warning for an enabled+configured toolset', () => {
    renderPage([toolset({ enabled: true, configured: true })])
    expect(screen.queryByText(/api key isn't set yet/i)).toBeNull()
  })

  it('renders an empty state when there are no toolsets', () => {
    renderPage([])
    expect(screen.getByText(/no toolsets found/i)).toBeInTheDocument()
    expect(screen.getByText(/agent runtime/i)).toBeInTheDocument()
  })

  it('names the tools list region for assistive tech', () => {
    renderPage([toolset()])
    expect(screen.getByLabelText('Toolsets your agent can use')).toBeInTheDocument()
    const toolsRegion = screen.getByLabelText('Tools in Web Search & Scraping')
    expect(within(toolsRegion).getByText('web_search')).toBeInTheDocument()
  })
})

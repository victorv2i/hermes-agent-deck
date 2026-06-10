/**
 * SkillsHubPanel — debounced hub search + install/uninstall/update actions.
 * Tests verify: search fires, results render, actions trigger, honest spinner+feedback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkillsHubPanel } from './SkillsHubPanel'
import * as hubApi from './hubApi'

vi.mock('./hubApi')

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const MOCK_RESULT: hubApi.HubResult = {
  name: 'axolotl',
  description: 'Fine-tune models at home',
  source: 'nous',
  identifier: 'nous/axolotl',
  trust_level: 'official',
  repo: 'https://github.com/NousResearch/axolotl',
  tags: ['mlops', 'training'],
}

beforeEach(() => {
  vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [] })
  vi.mocked(hubApi.installSkill).mockResolvedValue({
    ok: true,
    action: 'skills-install',
    restartRequired: true,
  })
  vi.mocked(hubApi.uninstallSkill).mockResolvedValue({
    ok: true,
    action: 'skills-uninstall',
    restartRequired: true,
  })
  vi.mocked(hubApi.updateAllSkills).mockResolvedValue({
    ok: true,
    action: 'skills-update',
    restartRequired: false,
  })
  vi.mocked(hubApi.pollHubActionStatus).mockResolvedValue({
    running: false,
    exit_code: 0,
    lines: ['Done.'],
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SkillsHubPanel', () => {
  it('renders the search input', () => {
    render(<SkillsHubPanel />, { wrapper })
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('shows an empty state when query is blank', () => {
    render(<SkillsHubPanel />, { wrapper })
    // No results shown for empty query
    expect(screen.queryByText('axolotl')).toBeNull()
  })

  it('calls searchHub after typing and shows results', async () => {
    vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [MOCK_RESULT] })

    render(<SkillsHubPanel />, { wrapper })
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'axolotl' } })

    // Debounced — wait for the search to fire
    await waitFor(() => {
      expect(vi.mocked(hubApi.searchHub)).toHaveBeenCalledWith('axolotl', expect.anything())
    })

    // Result renders
    await waitFor(() => {
      expect(screen.getByText('axolotl')).toBeDefined()
    })
  })

  it('does NOT call searchHub for an empty query', async () => {
    render(<SkillsHubPanel />, { wrapper })
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '' } })

    // Give time for a debounce to fire (it should not)
    await new Promise((r) => setTimeout(r, 400))
    expect(vi.mocked(hubApi.searchHub)).not.toHaveBeenCalled()
  })

  it('shows an Install button for a search result', async () => {
    vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [MOCK_RESULT] })

    render(<SkillsHubPanel />, { wrapper })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ax' } })

    await waitFor(() => screen.getByText('axolotl'))
    expect(screen.getByRole('button', { name: /install/i })).toBeDefined()
  })

  it('calls installSkill with the identifier on Install click', async () => {
    vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [MOCK_RESULT] })

    render(<SkillsHubPanel />, { wrapper })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ax' } })

    await waitFor(() => screen.getByText('axolotl'))
    fireEvent.click(screen.getByRole('button', { name: /install/i }))

    await waitFor(() => {
      expect(vi.mocked(hubApi.installSkill)).toHaveBeenCalledWith('nous/axolotl')
    })
  })

  it('shows "restart to apply" note after a successful install', async () => {
    vi.mocked(hubApi.searchHub).mockResolvedValue({ results: [MOCK_RESULT] })

    render(<SkillsHubPanel />, { wrapper })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ax' } })

    await waitFor(() => screen.getByText('axolotl'))
    fireEvent.click(screen.getByRole('button', { name: /install/i }))

    await waitFor(() => {
      expect(screen.getByText(/restart/i)).toBeDefined()
    })
  })

  it('shows an Update all button and calls updateAllSkills', async () => {
    render(<SkillsHubPanel />, { wrapper })
    const updateBtn = screen.getByRole('button', { name: /^update all skills$/i })
    expect(updateBtn).toBeDefined()
    fireEvent.click(updateBtn)

    await waitFor(() => {
      expect(vi.mocked(hubApi.updateAllSkills)).toHaveBeenCalled()
    })
  })

  it('shows an error when search fails', async () => {
    vi.mocked(hubApi.searchHub).mockRejectedValue(new Error('Search failed'))

    render(<SkillsHubPanel />, { wrapper })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fail' } })

    // The ErrorState renders a title with role="alert" or just text; find the
    // first (outermost) match. The error message is in the description paragraph.
    await waitFor(() => {
      const errorEl = screen.getByText(/couldn.t search the hub/i)
      expect(errorEl).toBeDefined()
    })
  })
})

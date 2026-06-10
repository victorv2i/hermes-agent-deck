import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

/**
 * The period must live in `?period=` so a refresh keeps the chosen window (the bug:
 * it reset to 7) and the view is deep-linkable. We stub the data hooks so the test
 * isolates the URL <-> period wiring, and mock the navigation module so importing
 * `CHAT_PATH` doesn't pull the lazy route registry.
 */
vi.mock('./useUsage', () => ({
  useUsage: vi.fn(() => ({ data: undefined, isLoading: false, isFetching: false, error: null })),
}))
vi.mock('@/features/models/useModels', () => ({
  useModels: () => ({ data: undefined }),
}))
vi.mock('@/app/navigation', () => ({ CHAT_PATH: '/chat' }))

import { UsageRoute } from './UsageRoute'
import { useUsage } from './useUsage'

/** Surface the current `?period=` so we can assert the URL the route drives. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="search">{loc.search}</div>
}

function renderAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/usage" element={<UsageRoute />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('UsageRoute — period in the URL', () => {
  it('defaults to the 7-day window when `?period=` is absent', () => {
    renderAt('/usage')
    expect(useUsage).toHaveBeenCalledWith(7)
    const seven = screen.getAllByRole('radio')[0]!
    expect(seven).toHaveAttribute('aria-checked', 'true')
  })

  it('reads the window from `?period=` so a refresh is stable + deep-linkable', () => {
    renderAt('/usage?period=30')
    expect(useUsage).toHaveBeenCalledWith(30)
    const thirty = screen.getAllByRole('radio')[2]!
    expect(thirty).toHaveAttribute('aria-checked', 'true')
  })

  it('falls back to 7 for an out-of-range `?period=`', () => {
    renderAt('/usage?period=999')
    expect(useUsage).toHaveBeenCalledWith(7)
  })

  it('writes the chosen window into `?period=` when the selector changes', async () => {
    renderAt('/usage')
    // Click the 14-day segment.
    await userEvent.click(screen.getByRole('radio', { name: '14d' }))
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('period=14'))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { PairingTab } from './PairingTab'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PairingTab />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('PairingTab — version-skew handling', () => {
  it('renders an honest "not available on this Hermes version" state on a 404, not a generic error', async () => {
    // The BFF preserves an upstream 404 as { error: 'unsupported' } so an ABSENT
    // route (version skew) is distinguishable from a real outage.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unsupported' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    renderTab()

    await waitFor(() =>
      expect(screen.getByText(/isn’t available on this Hermes version/i)).toBeInTheDocument(),
    )
    // The generic outage copy must NOT show for an honest version-skew state.
    expect(screen.queryByText(/Hermes may be offline/i)).not.toBeInTheDocument()
  })

  it('still shows the generic outage error for a real failure (non-404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Could not load pairing state.' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    renderTab()

    // A transient 502 is retried (query-level retry: up to 2), so allow time for
    // the retries to exhaust before the generic outage message settles.
    await waitFor(() => expect(screen.getByText(/Hermes may be offline/i)).toBeInTheDocument(), {
      timeout: 5000,
    })
    expect(screen.queryByText(/isn’t available on this Hermes version/i)).not.toBeInTheDocument()
  })
})

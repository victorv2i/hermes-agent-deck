import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { WebhooksTab } from './WebhooksTab'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <WebhooksTab />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('WebhooksTab loading vs empty', () => {
  it('shows a calm skeleton (not a blank body) while the first read is in flight', () => {
    // A fetch that never resolves keeps the query in its loading state.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    renderTab()

    expect(screen.getByTestId('webhooks-skeleton')).toBeInTheDocument()
    // The empty state must NOT leak while still loading (that would falsely read
    // as "no subscriptions" before the request settles; the honesty wedge).
    expect(screen.queryByText(/No webhook subscriptions/i)).not.toBeInTheDocument()
  })

  it('replaces the skeleton with the crafted empty state once a truly-empty list resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ enabled: true, base_url: 'http://x', subscriptions: [] }),
      ),
    )
    renderTab()

    await waitFor(() =>
      expect(screen.getByText(/No webhook subscriptions/i)).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('webhooks-skeleton')).not.toBeInTheDocument()
  })
})

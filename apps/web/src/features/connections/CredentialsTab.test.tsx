import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { CredentialsTab } from './CredentialsTab'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <CredentialsTab />
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

describe('CredentialsTab loading vs empty', () => {
  it('shows a calm skeleton (not a blank body) while the first read is in flight', () => {
    // A fetch that never resolves keeps the query in its loading state.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    renderTab()

    expect(screen.getByTestId('credentials-skeleton')).toBeInTheDocument()
    // The empty state must NOT leak while still loading (that would falsely read
    // as "no entries" before the request settles; the honesty wedge).
    expect(screen.queryByText(/No credential pool entries/i)).not.toBeInTheDocument()
  })

  it('replaces the skeleton with the crafted empty state once a truly-empty pool resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ providers: [] })),
    )
    renderTab()

    await waitFor(() => expect(screen.getByText(/No credential pool entries/i)).toBeInTheDocument())
    expect(screen.queryByTestId('credentials-skeleton')).not.toBeInTheDocument()
  })
})

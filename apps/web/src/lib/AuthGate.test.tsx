import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGate } from './AuthGate'
import { AUTH_TOKEN_STORAGE_KEY, clearAuthToken, setAuthToken } from './authToken'

function health(authRequired: boolean, remote = authRequired) {
  return {
    status: 'ok',
    hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
    bind: { remote, terminalEnabled: !remote, authRequired },
    version: '0.1.0',
  }
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <div data-testid="shell">app shell</div>
      </AuthGate>
    </QueryClientProvider>,
  )
}

function stubFetch(authRequired: boolean, acceptedToken = 'SECRET') {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes('/health')) {
        return Response.json(health(authRequired))
      }
      if (url.includes('/auth/check')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
        return new Response('{}', { status: auth === `Bearer ${acceptedToken}` ? 200 : 401 })
      }
      return new Response('{}', { status: 404 })
    }),
  )
}

afterEach(() => {
  clearAuthToken()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('renders the app shell when auth is not required', async () => {
    stubFetch(false)
    renderGate()
    expect(await screen.findByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-gate')).not.toBeInTheDocument()
  })

  it('shows the unlock screen when auth is required and no token is saved', async () => {
    stubFetch(true)
    renderGate()
    expect(await screen.findByTestId('auth-gate')).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/access token/i)).toHaveAttribute('type', 'password')
  })

  it('verifies a typed token, saves it, and then renders the shell', async () => {
    stubFetch(true, 'SECRET')
    const user = userEvent.setup()
    renderGate()

    await user.type(await screen.findByLabelText(/access token/i), 'SECRET')
    await user.click(screen.getByRole('button', { name: /unlock agentdeck/i }))

    expect(await screen.findByTestId('shell')).toBeInTheDocument()
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('SECRET')
  })

  it('rejects a saved token before showing the unlock screen', async () => {
    stubFetch(true, 'CURRENT')
    setAuthToken('STALE')
    renderGate()

    expect(await screen.findByText(/saved token was rejected/i)).toBeInTheDocument()
    expect(screen.getByTestId('auth-gate')).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('STALE'))
  })
})

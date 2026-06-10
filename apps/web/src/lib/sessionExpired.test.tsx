/**
 * ERR-01 — global 401-intercept.
 *
 * A 401 from ANY /api call (token missing/expired in FORCE_AUTH/remote deploy)
 * must drive the unified "session expired" screen instead of leaving per-surface
 * blank/error states. These tests verify:
 *
 *  1. apiFetch signals session-expired on a 401 response.
 *  2. The signal is observable (subscribeSessionExpired).
 *  3. The signal is clearable (clearSessionExpired), and doesn't loop.
 *  4. The SessionExpiredScreen component renders the correct copy + re-entry form.
 *  5. Submitting a new token from the SessionExpiredScreen clears the expired state
 *     and saves the token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiFetch } from './apiFetch'
import { clearAuthToken, setAuthToken, getAuthToken } from './authToken'
import {
  isSessionExpired,
  signalSessionExpired,
  clearSessionExpired,
  subscribeSessionExpired,
} from './sessionExpired'
import { SessionExpiredScreen } from './SessionExpiredScreen'

afterEach(() => {
  clearAuthToken()
  clearSessionExpired()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// sessionExpired store
// ---------------------------------------------------------------------------

describe('sessionExpired store', () => {
  it('starts false', () => {
    expect(isSessionExpired()).toBe(false)
  })

  it('signalSessionExpired() flips to true and notifies listeners', () => {
    const listener = vi.fn()
    const unsub = subscribeSessionExpired(listener)
    signalSessionExpired()
    expect(isSessionExpired()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('signalSessionExpired() is idempotent — listeners notified only once', () => {
    const listener = vi.fn()
    const unsub = subscribeSessionExpired(listener)
    signalSessionExpired()
    signalSessionExpired()
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('clearSessionExpired() resets to false and notifies listeners', () => {
    const listener = vi.fn()
    signalSessionExpired()
    const unsub = subscribeSessionExpired(listener)
    clearSessionExpired()
    expect(isSessionExpired()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })
})

// ---------------------------------------------------------------------------
// apiFetch 401 → signalSessionExpired
// ---------------------------------------------------------------------------

describe('apiFetch 401 intercept', () => {
  it('signals session-expired when the BFF returns 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized', message: 'Token expired' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    setAuthToken('EXPIRED_TOKEN')

    await apiFetch('/sessions').catch(() => null)

    expect(isSessionExpired()).toBe(true)
  })

  it('still throws an ApiError (status 401) after signalling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 })),
    )

    const err = await apiFetch('/sessions').catch((e) => e)
    expect(err).toMatchObject({ status: 401 })
  })

  it('does NOT signal session-expired for other 4xx errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 403 })),
    )

    await apiFetch('/files').catch(() => null)

    expect(isSessionExpired()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SessionExpiredScreen component
// ---------------------------------------------------------------------------

function renderExpiredScreen(onCleared?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionExpiredScreen onCleared={onCleared} />
    </QueryClientProvider>,
  )
}

describe('SessionExpiredScreen', () => {
  it('renders the session-expired copy', () => {
    renderExpiredScreen()
    expect(screen.getByTestId('session-expired')).toBeInTheDocument()
    expect(screen.getByText(/session expired/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument()
  })

  it('submitting a valid token clears session-expired, saves the token, calls onCleared', async () => {
    signalSessionExpired()
    const onCleared = vi.fn()
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (url.includes('/auth/check')) {
          const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
          return new Response('{}', { status: auth === 'Bearer NEWTOKEN' ? 200 : 401 })
        }
        return new Response('{}', { status: 404 })
      }),
    )

    renderExpiredScreen(onCleared)
    await user.type(screen.getByLabelText(/access token/i), 'NEWTOKEN')
    await user.click(screen.getByRole('button', { name: /re-enter/i }))

    await waitFor(() => expect(isSessionExpired()).toBe(false))
    expect(getAuthToken()).toBe('NEWTOKEN')
    expect(onCleared).toHaveBeenCalledTimes(1)
  })

  it('shows an error when the submitted token is rejected', async () => {
    signalSessionExpired()
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).includes('/auth/check')) {
          return new Response('{}', { status: 401 })
        }
        return new Response('{}', { status: 404 })
      }),
    )

    renderExpiredScreen()
    await user.type(screen.getByLabelText(/access token/i), 'WRONG')
    await user.click(screen.getByRole('button', { name: /re-enter/i }))

    await waitFor(() => expect(screen.getByText(/token rejected/i)).toBeInTheDocument())
    expect(isSessionExpired()).toBe(true) // still expired
  })
})

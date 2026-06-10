import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { EditAvatarDialog } from './EditAvatarDialog'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderDialog(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => vi.restoreAllMocks())

describe('EditAvatarDialog', () => {
  it('pre-selects the current avatar when opened', () => {
    renderDialog(<EditAvatarDialog open onOpenChange={() => {}} name="atlas" current="v3" />)
    expect(screen.getByRole('radio', { name: /face 3 of 6/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /face 1 of 6/i })).not.toBeChecked()
  })

  it('pre-fills the display name and writes a CHANGED one via the avatar PUT (avatar + displayName)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(
      <EditAvatarDialog
        open
        onOpenChange={() => {}}
        name="atlas"
        current="v3"
        displayName="Atlas"
      />,
    )
    const input = screen.getByLabelText(/display name/i)
    expect(input).toHaveValue('Atlas')

    await user.clear(input)
    await user.type(input, 'Mercury')
    await user.click(screen.getByRole('button', { name: /save identity/i }))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles/atlas/avatar')
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v3', displayName: 'Mercury' })
  })

  it('omits displayName on a pure face change (so the BFF preserves the existing name)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(
      <EditAvatarDialog
        open
        onOpenChange={() => {}}
        name="atlas"
        current="v3"
        displayName="Atlas"
      />,
    )
    // Change only the face; leave the display name untouched.
    await user.click(screen.getByRole('radio', { name: /face 2 of 6/i }))
    await user.click(screen.getByRole('button', { name: /save identity/i }))

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v2' })
  })

  it('clears a display name with an explicit blank (avatar + empty displayName)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(
      <EditAvatarDialog
        open
        onOpenChange={() => {}}
        name="atlas"
        current="v3"
        displayName="Atlas"
      />,
    )
    await user.clear(screen.getByLabelText(/display name/i))
    await user.click(screen.getByRole('button', { name: /save identity/i }))

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v3', displayName: '' })
  })

  it('resets the picked value to `current` when the dialog is reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderDialog(
      <EditAvatarDialog open onOpenChange={() => {}} name="atlas" current="v3" />,
    )
    // Pick a different face (v2) without saving.
    await user.click(screen.getByRole('radio', { name: /face 2 of 6/i }))
    expect(screen.getByRole('radio', { name: /face 2 of 6/i })).toBeChecked()

    // Close the dialog then reopen it — the stale v2 pick must NOT persist.
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditAvatarDialog open={false} onOpenChange={() => {}} name="atlas" current="v3" />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditAvatarDialog open onOpenChange={() => {}} name="atlas" current="v3" />
      </QueryClientProvider>,
    )
    // After reopening, the picker must show v3 (the current avatar), not v2.
    expect(screen.getByRole('radio', { name: /face 3 of 6/i })).toBeChecked()
  })

  it('resets to the NEW current avatar when the dialog is reopened with a changed prop', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = renderDialog(
      <EditAvatarDialog open onOpenChange={onOpenChange} name="atlas" current="v3" />,
    )
    // Pick v2 and save (dialog closes externally).
    await user.click(screen.getByRole('radio', { name: /face 2 of 6/i }))
    await user.click(screen.getByRole('button', { name: /save identity/i }))

    // Parent now reports the new avatar as current="v2" but keeps dialog open=false,
    // then reopens. The picker must show v2 (the updated current), not the old v3.
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditAvatarDialog open={false} onOpenChange={onOpenChange} name="atlas" current="v2" />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditAvatarDialog open onOpenChange={onOpenChange} name="atlas" current="v2" />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('radio', { name: /face 2 of 6/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /face 3 of 6/i })).not.toBeChecked()
  })
})

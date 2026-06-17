import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { NewAgentDialog } from './NewAgentDialog'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderDialog(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => navigate.mockClear())
afterEach(() => vi.restoreAllMocks())

describe('NewAgentDialog ceremony', () => {
  it('disables Create until the name passes the shared PROFILE_ID_RE', async () => {
    const user = userEvent.setup()
    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    const create = screen.getByRole('button', { name: /hatch agent/i })
    expect(create).toBeDisabled()

    const input = screen.getByLabelText('Profile ID')
    // A space keeps Create disabled and shows an error.
    await user.type(input, 'Bad Name')
    expect(create).toBeDisabled()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'researcher')
    expect(create).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts mixed-case names and posts the Hermes-canonical lowercase id', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'researcher' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'Researcher')
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/profiles/researcher', { state: { hatched: true } }),
    )
    const createCall = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles')
    expect(JSON.parse(createCall![1].body)).toEqual({ name: 'researcher' })
  })

  it('blocks the reserved built-in default name before submit', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'Default')

    expect(screen.getByRole('button', { name: /hatch agent/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/built-in agent/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers a deterministic avatar preview that re-derives from the typed name', async () => {
    const user = userEvent.setup()
    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    // A radiogroup of faces is present; the preview Avatar img reflects a built-in.
    expect(screen.getByRole('radiogroup', { name: /choose a face/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    // The preview face is one of the served built-in webps (an <img>, not sky-blue svg).
    const imgs = screen.getAllByRole('img', { hidden: true })
    expect(imgs.some((i) => (i as HTMLImageElement).src.includes('/avatars/'))).toBe(true)
  })

  it('creates the agent (POST), toasts, and navigates to its hub', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'atlas' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/profiles/atlas', { state: { hatched: true } }),
    )
    const createCall = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles')
    expect(createCall).toBeTruthy()
    expect(JSON.parse(createCall![1].body)).toEqual({ name: 'atlas' })
  })

  it('writes the chosen avatar when a face was explicitly picked', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'atlas' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    // "atlas" derives v1 by default, so pick a DIFFERENT face (v2) to prove an
    // explicit choice — clicking the already-selected default radio is a no-op.
    await user.click(screen.getByRole('radio', { name: /face 2 of 6/i }))
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const createCall = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles')!
    expect(JSON.parse(createCall[1].body)).toEqual({ name: 'atlas', avatar: 'v2' })
  })

  it('persists an entered display name at birth via the avatar PUT (avatar + displayName)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'atlas' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    await user.type(screen.getByLabelText(/display name/i), 'Mercury')
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    // Create posts only the id; the friendly name rides the follow-up avatar PUT.
    const createCall = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles')!
    expect(JSON.parse(createCall[1].body)).toEqual({ name: 'atlas' })
    const avatarCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith('/profiles/atlas/avatar'),
    )!
    expect(avatarCall).toBeTruthy()
    expect(JSON.parse(avatarCall[1].body)).toMatchObject({ displayName: 'Mercury' })
    // The avatar field is the resolved preview face (never omitted on this route).
    expect(JSON.parse(avatarCall[1].body).avatar).toMatch(/^v\d+$/)
  })

  it('does NOT fire the avatar PUT when no display name is entered (id-only agent)', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'atlas' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/profiles/atlas/avatar'))).toBe(
      false,
    )
  })

  it('defaults the soul to Hermes default (selected in the picker)', async () => {
    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: /choose a starting soul/i })
    // Hermes Default is the selected preset by default.
    expect(within(group).getByRole('radio', { name: /hermes default/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('the soul radiogroup is keyboard-operable (roving tabindex + arrow keys)', async () => {
    const user = userEvent.setup()
    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: /choose a starting soul/i })
    const selected = within(group).getByRole('radio', { name: /hermes default/i })
    // Roving tabindex: only the checked preset is in the tab order.
    expect(selected).toHaveAttribute('tabindex', '0')
    const others = within(group)
      .getAllByRole('radio')
      .filter((r) => r !== selected)
    expect(others.every((r) => r.getAttribute('tabindex') === '-1')).toBe(true)

    // ArrowRight moves the selection to the next preset.
    selected.focus()
    await user.keyboard('{ArrowRight}')
    expect(
      within(group)
        .getAllByRole('radio')
        .some((r) => r.getAttribute('aria-checked') === 'true'),
    ).toBe(true)
    expect(selected).toHaveAttribute('aria-checked', 'false')
  })

  it('sends the chosen non-default SOUL preset in the create body', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ name: 'atlas' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    const group = screen.getByRole('radiogroup', { name: /choose a starting soul/i })
    await user.click(within(group).getByRole('radio', { name: /coder/i }))
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const createCall = fetchMock.mock.calls.find((c) => c[0] === '/api/agent-deck/profiles')!
    expect(JSON.parse(createCall[1].body)).toEqual({ name: 'atlas', soulPreset: 'coder' })
  })

  it('surfaces an honest failure without navigating', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'create_failed',
        message: 'Hermes could not create the profile.',
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderDialog(<NewAgentDialog open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Profile ID'), 'atlas')
    await user.click(screen.getByRole('button', { name: /hatch agent/i }))

    const { toast } = await import('@/lib/toast')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })
})

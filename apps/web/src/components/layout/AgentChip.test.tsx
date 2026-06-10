import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { AgentChip } from './AgentChip'
import { restartPending } from './restartPending'
import type { ProfilesResponse } from '@/features/profiles/types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// jsdom has no ResizeObserver; radix overlays (Dialog/Popover) need it. No-op stub.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

function renderChip(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const data: ProfilesResponse = {
  active: 'atlas',
  profiles: [
    {
      name: 'default',
      displayPath: 'Hermes home',
      isDefault: true,
      isActive: false,
      model: 'gpt-5.5',
      provider: null,
      hasEnv: true,
      skillCount: 1,
      gatewayRunning: false,
      avatar: null,
      displayName: null,
    },
    {
      name: 'atlas',
      displayPath: 'profiles/atlas',
      isDefault: false,
      isActive: true,
      model: 'sonnet',
      provider: null,
      hasEnv: false,
      skillCount: 2,
      gatewayRunning: true,
      avatar: 'v3',
      displayName: null,
    },
  ],
}

function mockProfiles(body: ProfilesResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('restartPending (honest derivation)', () => {
  it('is false when the named-active agent itself is the one running', () => {
    expect(restartPending(data.profiles, 'atlas')).toBe(false)
  })

  it('is true when active_profile names A but a DIFFERENT profile is the running one', () => {
    const profiles = data.profiles.map((p) =>
      p.name === 'atlas' ? { ...p, gatewayRunning: false } : { ...p, gatewayRunning: true },
    )
    expect(restartPending(profiles, 'atlas')).toBe(true)
  })

  it('is false when nothing is running (no false alarm)', () => {
    const profiles = data.profiles.map((p) => ({ ...p, gatewayRunning: false }))
    expect(restartPending(profiles, 'atlas')).toBe(false)
  })
})

describe('AgentChip', () => {
  it('renders the active agent face + name + model with a switch aria-label', async () => {
    mockProfiles(data)
    renderChip(<AgentChip />)
    const chip = await screen.findByRole('button', {
      name: /active agent: atlas \(sonnet\), switch agent/i,
    })
    expect(chip).toBeInTheDocument()
    expect(screen.getByText('atlas')).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
  })

  it('opens the Profile Switcher on click', async () => {
    const user = userEvent.setup()
    mockProfiles(data)
    renderChip(<AgentChip />)
    const chip = await screen.findByRole('button', { name: /active agent: atlas/i })
    await user.click(chip)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('shows the default agent by its REAL name ("default"), never a fabricated "Your agent"', async () => {
    const defaultActive: ProfilesResponse = {
      active: 'default',
      profiles: [
        {
          name: 'default',
          displayPath: 'Hermes home',
          isDefault: true,
          isActive: true,
          model: 'gpt-5.5',
          provider: null,
          hasEnv: true,
          skillCount: 1,
          gatewayRunning: true,
          avatar: null,
          displayName: null,
        },
      ],
    }
    mockProfiles(defaultActive)
    renderChip(<AgentChip />)
    expect(await screen.findByText('default')).toBeInTheDocument()
    expect(screen.queryByText(/your agent/i)).not.toBeInTheDocument()
  })

  it('uses the friendly display name (not the raw id) in the switch aria-label', async () => {
    const named: ProfilesResponse = {
      active: 'atlas',
      profiles: [
        {
          ...data.profiles[1]!,
          name: 'atlas',
          isActive: true,
          displayName: 'Mercury',
        },
      ],
    }
    mockProfiles(named)
    renderChip(<AgentChip />)
    // The aria-label reads the display name, never the raw profile id.
    expect(
      await screen.findByRole('button', {
        name: /active agent: mercury \(sonnet\), switch agent/i,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /active agent: atlas/i })).not.toBeInTheDocument()
  })

  it('renders nothing until the roster loads (no skeleton flicker)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    const { container } = renderChip(<AgentChip />)
    expect(container.querySelector('button')).toBeNull()
  })
})

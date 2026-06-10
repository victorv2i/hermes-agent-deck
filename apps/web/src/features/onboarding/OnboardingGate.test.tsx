import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { SetupStatus } from '@agent-deck/protocol'
import { OnboardingGate } from './OnboardingGate'
import * as setupHook from './useSetupStatus'
import * as onboarded from '@/lib/useOnboarded'

// The wizard owns a live socket + the heavy rung UI; stub it to a sentinel so
// the GATE's decision (show wizard vs shell) is what we assert here.
vi.mock('./OnboardingWizard', () => ({
  OnboardingWizard: ({ status, onDismiss }: { status: SetupStatus; onDismiss: () => void }) => (
    <div data-testid="wizard">
      wizard:{JSON.stringify(status)}
      <button type="button" onClick={onDismiss}>
        Skip setup for now
      </button>
    </div>
  ),
}))

function status(over: Partial<SetupStatus> = {}): SetupStatus {
  return { hermesInstalled: false, providerConnected: false, agentNamed: false, ...over }
}

function mockSetup(value: setupHook.UseSetupStatus) {
  vi.spyOn(setupHook, 'useSetupStatus').mockReturnValue(value)
}
function base(over: Partial<setupHook.UseSetupStatus> = {}): setupHook.UseSetupStatus {
  return { status: undefined, unreachable: false, isFetching: false, refetch: vi.fn(), ...over }
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <OnboardingGate>
      <div data-testid="shell">app shell</div>
    </OnboardingGate>
  )
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('OnboardingGate — probe-driven, fail-open', () => {
  it('shows the wizard when the probe reports setup incomplete and not onboarded', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(base({ status: status() }))
    renderGate()
    expect(screen.getByTestId('wizard')).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).toBeNull()
  })

  it('renders the SHELL (no wizard) once setup is complete', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(
      base({
        status: status({ hermesInstalled: true, providerConnected: true, agentNamed: true }),
      }),
    )
    renderGate()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
  })

  it('FAILS OPEN: an unreachable probe (status:null) renders the shell, never traps', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(base({ status: null, unreachable: true }))
    renderGate()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
  })

  it('holds the shell (no wizard flash) while the first probe is loading', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(base({ status: undefined }))
    renderGate()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
  })

  it('the onboarded suppressor renders the shell even mid-setup ("don\'t show again")', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([true, vi.fn()])
    mockSetup(base({ status: status() }))
    renderGate()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
  })

  it('skipping only dismisses the takeover for now and leaves a resume setup action', async () => {
    const user = userEvent.setup()
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(base({ status: status() }))
    renderGate()

    await user.click(screen.getByRole('button', { name: /skip setup for now/i }))

    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
    expect(screen.getByRole('button', { name: /resume setup/i })).toBeInTheDocument()
  })

  it('passes the real probe status down to the wizard (drives the resume rung)', () => {
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, vi.fn()])
    mockSetup(base({ status: status({ hermesInstalled: true }) }))
    renderGate()
    expect(screen.getByTestId('wizard').textContent).toContain('"hermesInstalled":true')
  })

  it('marks onboarded when the wizard auto-closes because every probe rung just completed', () => {
    // The bug: setup completes in the wizard but no chat token ever streams, so
    // the persistent bit is never written and Home shows first-run forever.
    const mark = vi.fn()
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, mark])
    // Start incomplete → the wizard is shown.
    mockSetup(base({ status: status({ hermesInstalled: true, providerConnected: true }) }))
    const { rerender } = renderGate()
    expect(screen.getByTestId('wizard')).toBeInTheDocument()
    expect(mark).not.toHaveBeenCalled()

    // The probe now reports the agent named → setup complete → the gate hides the
    // wizard. That show→hide-by-completion transition must persist the bit.
    mockSetup(
      base({
        status: status({ hermesInstalled: true, providerConnected: true, agentNamed: true }),
      }),
    )
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <OnboardingGate>
            <div data-testid="shell">app shell</div>
          </OnboardingGate>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard')).toBeNull()
    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('does NOT auto-mark a returning, fully-set-up user who never saw the wizard', () => {
    // A complete probe on first mount renders the shell directly; the wizard was
    // never shown, so the completion transition must not fire (Home still owns
    // the one-time first-run framing until a real first interaction).
    const mark = vi.fn()
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, mark])
    mockSetup(
      base({
        status: status({ hermesInstalled: true, providerConnected: true, agentNamed: true }),
      }),
    )
    renderGate()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(mark).not.toHaveBeenCalled()
  })

  it('does NOT auto-mark when the wizard closes via fail-open (probe went unreachable)', () => {
    // Show the wizard, then the probe errors (null). The wizard closes to fail
    // open — but setup is NOT complete, so onboarded must stay false (the user
    // still has real setup left; never silently swallow it).
    const mark = vi.fn()
    vi.spyOn(onboarded, 'useOnboarded').mockReturnValue([false, mark])
    mockSetup(base({ status: status({ hermesInstalled: true }) }))
    const { rerender } = renderGate()
    expect(screen.getByTestId('wizard')).toBeInTheDocument()

    mockSetup(base({ status: null, unreachable: true }))
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <OnboardingGate>
            <div data-testid="shell">app shell</div>
          </OnboardingGate>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(mark).not.toHaveBeenCalled()
  })
})

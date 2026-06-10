import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { SystemState } from '@agent-deck/protocol'
import { SystemPage, type SystemPageProps } from './SystemPage'

/**
 * The Maintenance dock is the most HONESTY-critical surface: every button must
 * reflect a real check, every confirm must state the real cost, and no card may
 * ever fake a state. These tests pin:
 *  - GatewayCard: always-available restart behind an honest confirm, the
 *    reconnecting UX while in flight.
 *  - HermesUpdateCard: DISABLED + "Up to date" when current; ACTIVE amber ONLY
 *    when the read reports update-available; the confirm states the real cost.
 *  - AgentDeckUpdateCard: DISABLED with "No update channel configured" on
 *    no-channel (the git flow stays gated off).
 */

const SYSTEM: SystemState = {
  gateway: { status: 'running' },
  hermes: { status: 'up-to-date', currentVersion: '0.15.1' },
  agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
}

function setup(overrides: Partial<SystemPageProps> = {}) {
  const props: SystemPageProps = {
    system: SYSTEM,
    gateway: { status: 'idle', onRestart: vi.fn() },
    hermesUpdate: { status: 'idle', onApply: vi.fn() },
    doctor: { status: 'idle', onRun: vi.fn() },
    ...overrides,
  }
  render(<SystemPage {...props} />)
  return props
}

/** A SYSTEM read carrying both per-channel verdicts. */
function withChannels(
  stable: 'up-to-date' | 'update-available',
  latest: 'up-to-date' | 'update-available',
): SystemState {
  return {
    ...SYSTEM,
    hermes: {
      status: stable,
      currentVersion: '0.15.1',
      channels: [
        { channel: 'stable', status: stable, currentVersion: '0.15.1' },
        { channel: 'latest-commit', status: latest, currentVersion: '0.15.1' },
      ],
    },
  }
}

describe('SystemPage — three stacked cards', () => {
  it('renders a Gateway, a Hermes, and an agent-deck card', () => {
    setup()
    expect(screen.getByRole('region', { name: /your agent/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /hermes/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /agent[- ]deck/i })).toBeInTheDocument()
  })
})

describe('GatewayCard', () => {
  it('offers an always-available Restart action behind an honest confirm', () => {
    const props = setup()
    const region = screen.getByRole('region', { name: /your agent/i })
    fireEvent.click(within(region).getByRole('button', { name: /restart your agent/i }))
    // The confirm states the REAL cost — the agent disconnects briefly.
    expect(screen.getByText(/disconnects for a few seconds/i)).toBeInTheDocument()
    // Confirming calls onRestart.
    fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    expect(props.gateway.onRestart).toHaveBeenCalledTimes(1)
  })

  it('shows the reconnecting UX while a restart is in flight (no fake "done")', () => {
    setup({ gateway: { status: 'restarting', onRestart: vi.fn() } })
    const region = screen.getByRole('region', { name: /your agent/i })
    // The calm reconnecting UX: the ConnectionDot reads "Connecting…".
    expect(within(region).getByRole('status', { name: /connecting/i })).toBeInTheDocument()
    // The restart button is busy/disabled while in flight (no fake "done").
    expect(within(region).getByRole('button', { name: /restarting/i })).toBeDisabled()
  })

  it('reflects a stopped gateway honestly', () => {
    setup({ system: { ...SYSTEM, gateway: { status: 'stopped' } } })
    const region = screen.getByRole('region', { name: /your agent/i })
    expect(within(region).getByText(/stopped/i)).toBeInTheDocument()
  })
})

describe('HermesUpdateCard', () => {
  it('DISABLES the apply with "Up to date" when the read reports current', () => {
    setup()
    const region = screen.getByRole('region', { name: /hermes/i })
    // The disabled apply button reads "Up to date" (per spec) — a real check.
    const button = within(region).getByRole('button', { name: /up to date/i })
    expect(button).toBeDisabled()
    // The installed version is shown (ground truth).
    expect(within(region).getByText(/0\.15\.1/)).toBeInTheDocument()
  })

  it('ENABLES an amber apply ONLY when the read reports update-available, behind a cost-stating confirm', () => {
    const props = setup({
      system: { ...SYSTEM, hermes: { status: 'update-available', currentVersion: '0.15.1' } },
    })
    const region = screen.getByRole('region', { name: /hermes/i })
    const apply = within(region).getByRole('button', { name: /update hermes/i })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    // The confirm states the REAL cost: restarts the gateway, keeps a backup.
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/restart/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/backup/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^update$/i }))
    expect(props.hermesUpdate.onApply).toHaveBeenCalledTimes(1)
  })

  it('shows an "Updating…" busy state while applying (the apply button is busy/disabled)', () => {
    setup({
      system: { ...SYSTEM, hermes: { status: 'update-available', currentVersion: '0.15.1' } },
      hermesUpdate: { status: 'applying', onApply: vi.fn() },
    })
    const region = screen.getByRole('region', { name: /hermes/i })
    expect(within(region).getByRole('button', { name: /updating/i })).toBeDisabled()
  })

  it('renders the secret-scrubbed result log after an apply (verbatim, collapsible)', () => {
    setup({
      system: { ...SYSTEM, hermes: { status: 'up-to-date', currentVersion: '0.16.0' } },
      hermesUpdate: {
        status: 'idle',
        onApply: vi.fn(),
        result: {
          status: 'up-to-date',
          log: ['Backed up.', 'Updated to v0.16.0.'],
          currentVersion: '0.16.0',
        },
      },
    })
    const region = screen.getByRole('region', { name: /hermes/i })
    // The log is behind a disclosure; open it.
    fireEvent.click(within(region).getByRole('button', { name: /log/i }))
    expect(within(region).getByText(/Updated to v0\.16\.0/)).toBeInTheDocument()
  })
})

describe('HermesUpdateCard — update channels', () => {
  it('offers a STABLE (default) and a LATEST COMMIT (advanced) channel choice', () => {
    setup({ system: withChannels('up-to-date', 'update-available') })
    const region = screen.getByRole('region', { name: /hermes/i })
    // Both channels are selectable; stable is the default selection.
    const stable = within(region).getByRole('radio', { name: /stable release/i })
    const latest = within(region).getByRole('radio', { name: /latest commit/i })
    expect(stable).toBeChecked()
    expect(latest).not.toBeChecked()
    // The advanced/bleeding-edge channel is labelled as such (honest warning).
    expect(within(region).getByText(/advanced|bleeding[- ]edge/i)).toBeInTheDocument()
  })

  it('enables the amber apply ONLY for the SELECTED channel that reports an update', () => {
    // Stable is up-to-date; latest-commit has an update. With stable selected the
    // apply is disabled ("Up to date"); selecting latest-commit enables it.
    setup({ system: withChannels('up-to-date', 'update-available') })
    const region = screen.getByRole('region', { name: /hermes/i })
    expect(within(region).getByRole('button', { name: /up to date/i })).toBeDisabled()
    fireEvent.click(within(region).getByRole('radio', { name: /latest commit/i }))
    expect(within(region).getByRole('button', { name: /update hermes/i })).toBeEnabled()
  })

  it('applies the SELECTED channel (latest-commit), warning it is bleeding-edge in the confirm', () => {
    const props = setup({ system: withChannels('up-to-date', 'update-available') })
    const region = screen.getByRole('region', { name: /hermes/i })
    fireEvent.click(within(region).getByRole('radio', { name: /latest commit/i }))
    fireEvent.click(within(region).getByRole('button', { name: /update hermes/i }))
    const dialog = screen.getByRole('dialog')
    // The confirm warns it is the bleeding-edge / not-yet-release-tested branch tip.
    expect(within(dialog).getByText(/bleeding[- ]edge/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/not yet release-tested|may be unstable/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^update$/i }))
    expect(props.hermesUpdate.onApply).toHaveBeenCalledWith('latest-commit')
  })

  it('shows ONE amber badge on the card header; channel rows stay honest but quiet', () => {
    // Both channels report updates: the card must not stack three amber badges.
    // The header carries the single Badge; each row still says "Update available"
    // as plain text with a subtle dot (honesty about WHICH channels preserved).
    setup({ system: withChannels('update-available', 'update-available') })
    const region = screen.getByRole('region', { name: /hermes/i })
    const mentions = within(region).getAllByText(/update available/i)
    expect(mentions).toHaveLength(3) // header + both channel rows
    const badges = mentions.filter((el) => el.closest('[data-slot="badge"]') !== null)
    expect(badges).toHaveLength(1)
  })

  it('notes that channels track git branches, not signed release tags (honest)', () => {
    setup({ system: withChannels('up-to-date', 'up-to-date') })
    const region = screen.getByRole('region', { name: /hermes/i })
    expect(within(region).getByText(/not signed release tags/i)).toBeInTheDocument()
  })
})

describe('DoctorCard', () => {
  it('offers a "Run health check" action and is idle before running', () => {
    setup()
    const region = screen.getByRole('region', { name: /doctor|health/i })
    expect(
      within(region).getByRole('button', { name: /run health check|check health/i }),
    ).toBeEnabled()
  })

  it('shows a busy state while the check is running (no fake result)', () => {
    setup({ doctor: { status: 'running', onRun: vi.fn() } })
    const region = screen.getByRole('region', { name: /doctor|health/i })
    expect(within(region).getByRole('button', { name: /checking|running/i })).toBeDisabled()
  })

  it('renders the health rollup (counts + status) with a collapsible per-section breakdown', () => {
    setup({
      doctor: {
        status: 'idle',
        onRun: vi.fn(),
        result: {
          status: 'warnings',
          counts: { ok: 40, warning: 3, error: 0 },
          sections: [
            { title: 'Python Environment', ok: 2, warning: 1, error: 0 },
            { title: 'Auth Providers', ok: 1, warning: 2, error: 0 },
          ],
          summary: ["Run 'hermes setup' to configure API keys"],
        },
      },
    })
    const region = screen.getByRole('region', { name: /doctor|health/i })
    // The aggregate warning count is surfaced.
    expect(within(region).getByText(/3 warning/i)).toBeInTheDocument()
    // The footer action summary is shown.
    expect(within(region).getByText(/hermes setup/i)).toBeInTheDocument()
    // Per-section breakdown behind a disclosure.
    fireEvent.click(within(region).getByRole('button', { name: /section|breakdown|detail/i }))
    expect(within(region).getByText(/Python Environment/)).toBeInTheDocument()
  })

  it('shows an honest "unavailable" state when doctor could not run (no fake healthy)', () => {
    setup({
      doctor: {
        status: 'idle',
        onRun: vi.fn(),
        result: {
          status: 'unavailable',
          counts: { ok: 0, warning: 0, error: 0 },
          sections: [],
          summary: [],
        },
      },
    })
    const region = screen.getByRole('region', { name: /doctor|health/i })
    // The body states the honest unavailable reason (distinct from the status line).
    expect(within(region).getByText(/couldn't run on this machine/i)).toBeInTheDocument()
  })

  it('surfaces a transport error honestly', () => {
    setup({
      doctor: { status: 'idle', onRun: vi.fn(), error: 'Network error' },
    })
    const region = screen.getByRole('region', { name: /doctor|health/i })
    expect(within(region).getByText(/network error/i)).toBeInTheDocument()
  })
})

describe('AgentDeckUpdateCard', () => {
  it('is DISABLED with an honest "No update channel configured" reason on no-channel', () => {
    setup()
    const region = screen.getByRole('region', { name: /agent[- ]deck/i })
    expect(within(region).getByText(/no update channel configured/i)).toBeInTheDocument()
    // There is no enabled action — the git flow stays gated off.
    const buttons = within(region).queryAllByRole('button')
    for (const b of buttons) expect(b).toBeDisabled()
  })

  it('shows the running agent-deck version', () => {
    setup()
    const region = screen.getByRole('region', { name: /agent[- ]deck/i })
    expect(within(region).getByText(/0\.1\.0/)).toBeInTheDocument()
  })

  it('stays gated off (disabled) even when a channel exists (idle) — v1 ships apply off', () => {
    setup({
      system: { ...SYSTEM, agentDeck: { status: 'idle', currentVersion: '0.1.0' } },
    })
    const region = screen.getByRole('region', { name: /agent[- ]deck/i })
    const buttons = within(region).queryAllByRole('button')
    for (const b of buttons) expect(b).toBeDisabled()
  })
})

describe('GatewayCard — copy honesty (INFO-ACC-2)', () => {
  it('shows "Unknown" text (not "Connecting…") for an unknown gateway status', () => {
    // "unknown" is NOT a connecting state — implying in-progress connection with a
    // pulsing dot is a honesty lie. It should render a neutral non-pulsing state.
    setup({ system: { ...SYSTEM, gateway: { status: 'unknown' } } })
    const region = screen.getByRole('region', { name: /your agent/i })
    // Should show "Unknown" text, NOT "Connecting…" which implies in-progress.
    expect(within(region).getByText(/unknown/i)).toBeInTheDocument()
    expect(within(region).queryByText(/connecting/i)).not.toBeInTheDocument()
    // The dot must NOT be pulsing (pulsing implies live/in-progress).
    // "unknown" maps to a neutral non-pulsing dot, not the pulsing "connecting" state.
    const dot = within(region).getByTestId('connection-dot')
    expect(dot).not.toHaveAttribute('data-status', 'connecting')
  })
})

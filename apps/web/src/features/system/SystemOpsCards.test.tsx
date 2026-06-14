import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SystemStats, CuratorStatus, ProviderValidateResult } from '@agent-deck/protocol'
import {
  SystemStatsCard,
  CuratorCard,
  ProviderValidateCard,
  type CuratorCardActions,
} from './SystemOpsCards'

/* -------------------------------------------------------------------------- */
/* SystemStatsCard                                                            */
/* -------------------------------------------------------------------------- */

const FULL_STATS: SystemStats = {
  psutil: true,
  os: 'Linux',
  arch: 'x86_64',
  hermes_version: '0.15.2',
  cpu_count: 8,
  cpu_percent: 14.2,
  load_avg: [0.3, 0.6, 0.9],
  uptime_seconds: 172800,
  memory: { total: 16_000_000_000, available: 8_000_000_000, used: 8_000_000_000, percent: 50 },
  disk: { total: 500_000_000_000, used: 200_000_000_000, free: 300_000_000_000, percent: 40 },
}

describe('SystemStatsCard', () => {
  it('renders system resource items when stats are available', () => {
    render(<SystemStatsCard stats={FULL_STATS} isLoading={false} error={null} />)
    // The card renders the heading
    expect(screen.getByText(/system resources/i)).toBeInTheDocument()
    expect(screen.getByText('Linux')).toBeInTheDocument()
    expect(screen.getByText('0.15.2')).toBeInTheDocument()
    // Memory usage shows percentage
    expect(screen.getByText('50%')).toBeInTheDocument()
    // Uptime 2 days
    expect(screen.getByText(/2d/)).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    render(<SystemStatsCard stats={null} isLoading error={null} />)
    expect(screen.getByText(/loading system stats/i)).toBeInTheDocument()
  })

  it('shows an error when stats failed to load', () => {
    render(<SystemStatsCard stats={null} isLoading={false} error="Could not reach Hermes." />)
    expect(screen.getByText(/could not reach hermes/i)).toBeInTheDocument()
  })

  it('shows a psutil-absent note when enrichment is unavailable', () => {
    render(
      <SystemStatsCard
        stats={{ ...FULL_STATS, psutil: false, memory: undefined, disk: undefined }}
        isLoading={false}
        error={null}
      />,
    )
    expect(screen.getByText(/psutil not installed/i)).toBeInTheDocument()
  })

  it('NEVER shows host-internal fields (hostname, pid, python details)', () => {
    render(<SystemStatsCard stats={FULL_STATS} isLoading={false} error={null} />)
    // These fields must never appear in the UI — they are stripped at the BFF level
    // but this test pins the contract at the presentation layer too.
    const { container } = render(
      <SystemStatsCard stats={FULL_STATS} isLoading={false} error={null} />,
    )
    expect(container.textContent).not.toContain('hostname')
    expect(container.textContent).not.toContain('python')
    expect(container.textContent).not.toContain('pid')
  })
})

/* -------------------------------------------------------------------------- */
/* CuratorCard                                                                */
/* -------------------------------------------------------------------------- */

const CURATOR_ACTIVE: CuratorStatus = {
  available: true,
  enabled: true,
  paused: false,
  interval_hours: 24,
  last_run_at: '2026-06-01T12:00:00Z',
  min_idle_hours: 1,
  stale_after_days: 7,
  archive_after_days: 30,
}

function makeCuratorActions(overrides: Partial<CuratorCardActions> = {}): CuratorCardActions {
  return {
    onTogglePause: vi.fn(),
    onRunNow: vi.fn(),
    isPauseLoading: false,
    isRunLoading: false,
    ...overrides,
  }
}

describe('CuratorCard', () => {
  it('renders the curator region with active status', () => {
    render(
      <CuratorCard
        curator={CURATOR_ACTIVE}
        isLoading={false}
        error={null}
        actions={makeCuratorActions()}
      />,
    )
    expect(screen.getByRole('region', { name: /curator/i })).toBeInTheDocument()
    // "Active" text is in the status span
    expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/every 24h/i)).toBeInTheDocument()
  })

  it('shows Pause and Run now buttons when curator is active', () => {
    render(
      <CuratorCard
        curator={CURATOR_ACTIVE}
        isLoading={false}
        error={null}
        actions={makeCuratorActions()}
      />,
    )
    expect(screen.getByRole('button', { name: /pause curator/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run now/i })).toBeInTheDocument()
  })

  it('calls onTogglePause when Pause is clicked', () => {
    const onTogglePause = vi.fn()
    render(
      <CuratorCard
        curator={CURATOR_ACTIVE}
        isLoading={false}
        error={null}
        actions={makeCuratorActions({ onTogglePause })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /pause curator/i }))
    expect(onTogglePause).toHaveBeenCalledOnce()
  })

  it('shows Resume instead of Pause when curator is paused', () => {
    render(
      <CuratorCard
        curator={{ ...CURATOR_ACTIVE, paused: true }}
        isLoading={false}
        error={null}
        actions={makeCuratorActions()}
      />,
    )
    expect(screen.getByRole('button', { name: /resume curator/i })).toBeInTheDocument()
    expect(screen.getByText(/paused/i)).toBeInTheDocument()
  })

  it('shows Disabled (not Active) when available but turned off in config', () => {
    render(
      <CuratorCard
        curator={{ ...CURATOR_ACTIVE, enabled: false, paused: false }}
        isLoading={false}
        error={null}
        actions={makeCuratorActions()}
      />,
    )
    // enabled:false means the daemon will NOT run, so "Active" would be a lie.
    expect(screen.getByText(/disabled/i)).toBeInTheDocument()
    expect(screen.queryByText('Active')).toBeNull()
    // No pause/resume toggle for a daemon that's off (you'd enable it in config).
    expect(screen.queryByRole('button', { name: /pause curator|resume curator/i })).toBeNull()
  })

  it('shows the unavailable state when the curator module is absent', () => {
    render(
      <CuratorCard
        curator={{
          available: false,
          enabled: false,
          paused: false,
          interval_hours: null,
          last_run_at: null,
          min_idle_hours: null,
          stale_after_days: null,
          archive_after_days: null,
        }}
        isLoading={false}
        error={null}
        actions={makeCuratorActions()}
      />,
    )
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    // No action buttons when unavailable
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument()
  })

  it('shows a loading state', () => {
    render(<CuratorCard curator={null} isLoading error={null} actions={makeCuratorActions()} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------------------- */
/* ProviderValidateCard                                                       */
/* -------------------------------------------------------------------------- */

describe('ProviderValidateCard', () => {
  it('renders the validation region with an input form', () => {
    render(<ProviderValidateCard isValidating={false} result={null} onValidate={vi.fn()} />)
    expect(screen.getByRole('region', { name: /provider key validation/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/environment variable/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/key value/i)).toBeInTheDocument()
  })

  it('disables the Verify button when inputs are empty', () => {
    render(<ProviderValidateCard isValidating={false} result={null} onValidate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /verify key/i })).toBeDisabled()
  })

  it('enables the Verify button when both inputs have values', () => {
    render(<ProviderValidateCard isValidating={false} result={null} onValidate={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/environment variable/i), {
      target: { value: 'OPENAI_API_KEY' },
    })
    fireEvent.change(screen.getByLabelText(/key value/i), {
      target: { value: 'sk-test' },
    })
    expect(screen.getByRole('button', { name: /verify key/i })).toBeEnabled()
  })

  it('calls onValidate with the key + value when clicked', () => {
    const onValidate = vi.fn()
    render(<ProviderValidateCard isValidating={false} result={null} onValidate={onValidate} />)
    fireEvent.change(screen.getByLabelText(/environment variable/i), {
      target: { value: 'OPENAI_API_KEY' },
    })
    fireEvent.change(screen.getByLabelText(/key value/i), {
      target: { value: 'sk-test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /verify key/i }))
    expect(onValidate).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-test')
  })

  it('shows a green accepted state for ok=true reachable=true', () => {
    const result: ProviderValidateResult = { ok: true, reachable: true, message: '' }
    render(<ProviderValidateCard isValidating={false} result={result} onValidate={vi.fn()} />)
    expect(screen.getByText(/key accepted/i)).toBeInTheDocument()
  })

  it('shows a red rejected state for ok=false reachable=true', () => {
    const result: ProviderValidateResult = {
      ok: false,
      reachable: true,
      message: 'That API key was rejected.',
    }
    render(<ProviderValidateCard isValidating={false} result={result} onValidate={vi.fn()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/rejected/i)).toBeInTheDocument()
  })

  it('shows an amber unreachable state for ok=false reachable=false', () => {
    const result: ProviderValidateResult = {
      ok: false,
      reachable: false,
      message: 'Could not reach the provider.',
    }
    render(<ProviderValidateCard isValidating={false} result={result} onValidate={vi.fn()} />)
    expect(screen.getByText(/could not reach the provider/i)).toBeInTheDocument()
  })

  it('shows the in-progress state when validating', () => {
    render(<ProviderValidateCard isValidating result={null} onValidate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /verifying/i })).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DoItForMe } from './DoItForMe'
import type { CliOpResponse } from '@agent-deck/protocol'
import * as cliOpApi from '@/features/cli-op/api'

/**
 * DoItForMe — the "Do It For Me" one-click action primitive.
 *
 * HONESTY INVARIANTS:
 *  - The button shows a running state while the BFF call is in flight.
 *  - On ok:true the banner shows a success message (no fabricated success on ok:false).
 *  - On ok:false the banner shows the real failure (error state, not success).
 *  - On transport error the banner shows the error message.
 *  - The stdout pane only renders when there is output; it's read-only.
 *
 * ACCESSIBILITY:
 *  - Button has aria-label = the label prop.
 *  - Result banner has role="status".
 *  - Stdout pane has role="log".
 */

function mockRunCliOp(response: Partial<CliOpResponse> | Error) {
  return vi.spyOn(cliOpApi, 'runCliOp').mockImplementation(async () => {
    if (response instanceof Error) throw response
    return {
      ok: true,
      stdout: '',
      summary: 'completed',
      exitCode: 0,
      ...response,
    } as CliOpResponse
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DoItForMe', () => {
  it('renders the label as the button text', () => {
    render(
      <DoItForMe
        label="Fix problems automatically"
        op={{ opId: 'doctor-fix', params: {} }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Fix problems automatically' })).toBeTruthy()
  })

  it('renders the description when provided', () => {
    render(
      <DoItForMe
        label="Run check"
        op={{ opId: 'auth-list', params: {} }}
        description="Lists all stored credentials."
      />,
    )
    expect(screen.getByText('Lists all stored credentials.')).toBeTruthy()
  })

  it('button is enabled when idle', () => {
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    expect(screen.getByRole('button', { name: 'Run' })).not.toBeDisabled()
  })

  it('shows "Running…" and disables button while call is in flight', async () => {
    let resolve!: (v: CliOpResponse) => void
    vi.spyOn(cliOpApi, 'runCliOp').mockReturnValue(
      new Promise<CliOpResponse>((r) => {
        resolve = r
      }),
    )
    render(<DoItForMe label="Fix things" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fix things' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fix things' })).toBeDisabled()
    })
    expect(screen.getByText('Running…')).toBeTruthy()
    // Settle
    resolve({ ok: true, stdout: '', summary: 'done', exitCode: 0 })
  })

  it('shows success banner on ok:true (no fake success on failure)', async () => {
    mockRunCliOp({ ok: true, stdout: '', summary: 'done', exitCode: 0 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
    expect(screen.getByRole('status').textContent).toContain('Done')
  })

  it('shows failure banner on ok:false (HONEST — never fakes success)', async () => {
    mockRunCliOp({ ok: false, stdout: 'Error output', summary: 'Failed', exitCode: 1 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
    const banner = screen.getByRole('status')
    expect(banner.textContent).not.toContain('Done')
    expect(banner.textContent).toMatch(/Failed/)
  })

  it('shows error banner on transport error', async () => {
    mockRunCliOp(new Error('Network error'))
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
    expect(screen.getByRole('status').textContent).toContain('Network error')
  })

  it('shows stdout log toggle when stdout is non-empty', async () => {
    mockRunCliOp({ ok: true, stdout: '✓ Created ~/.hermes/.env\n', summary: 'done', exitCode: 0 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.getByText('Show output')).toBeTruthy()
    })
    // Expand
    fireEvent.click(screen.getByText('Show output'))
    const log = screen.getByRole('log')
    expect(log.textContent).toContain('✓ Created')
  })

  it('does NOT show stdout toggle when stdout is empty', async () => {
    mockRunCliOp({ ok: true, stdout: '', summary: 'done', exitCode: 0 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.queryByText('Show output')).toBeNull()
    })
  })

  it('result banner has role="status" for SR announcement', async () => {
    mockRunCliOp({ ok: true, stdout: '', summary: 'done', exitCode: 0 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
  })

  it('stdout pane has role="log" when visible', async () => {
    mockRunCliOp({ ok: true, stdout: 'some output', summary: 'done', exitCode: 0 })
    render(<DoItForMe label="Run" op={{ opId: 'doctor-fix', params: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => screen.getByText('Show output'))
    fireEvent.click(screen.getByText('Show output'))
    expect(screen.getByRole('log')).toBeTruthy()
  })
})

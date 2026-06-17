import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AwayDigestCard } from './AwayDigestCard'
import type { AwayDigest } from './digest'

/** A digest with overridable runs/crons slices. */
function digest(overrides: Partial<AwayDigest> = {}): AwayDigest {
  return {
    sinceMs: Date.UTC(2026, 5, 16, 10, 0, 0),
    runs: {
      total: 0,
      completed: 0,
      failed: 0,
      completedTitles: [],
      failedTitles: [],
      latestId: null,
    },
    crons: { total: 0, ok: 0, error: 0, failedNames: [] },
    ...overrides,
  }
}

describe('AwayDigestCard', () => {
  it('shows the "While you were away" heading', () => {
    render(
      <AwayDigestCard
        digest={digest({ runs: { ...digest().runs, total: 1, completed: 1 } })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    expect(screen.getByText(/while you were away/i)).toBeInTheDocument()
  })

  it('states the real finished-chat count in plain language', () => {
    render(
      <AwayDigestCard
        digest={digest({
          runs: { total: 2, completed: 2, failed: 0, completedTitles: [], failedTitles: [], latestId: 's9' },
        })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    expect(screen.getByText(/2 chats finished/i)).toBeInTheDocument()
  })

  it('states a singular finished chat correctly', () => {
    render(
      <AwayDigestCard
        digest={digest({
          runs: { total: 1, completed: 1, failed: 0, completedTitles: [], failedTitles: [], latestId: 's1' },
        })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    expect(screen.getByText(/1 chat finished/i)).toBeInTheDocument()
  })

  it('states scheduled-job counts with the failed split', () => {
    render(
      <AwayDigestCard
        digest={digest({
          crons: { total: 3, ok: 2, error: 1, failedNames: ['Zillow watch'] },
        })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    expect(screen.getByText(/3 scheduled jobs ran/i)).toBeInTheDocument()
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument()
  })

  it('links failed crons to the jobs page', async () => {
    const onOpenJobs = vi.fn()
    render(
      <AwayDigestCard
        digest={digest({ crons: { total: 1, ok: 0, error: 1, failedNames: ['Failing job'] } })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={onOpenJobs}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /review jobs/i }))
    expect(onOpenJobs).toHaveBeenCalled()
  })

  it('links the finished runs to the most recent session', async () => {
    const onOpenSession = vi.fn()
    render(
      <AwayDigestCard
        digest={digest({
          runs: { total: 2, completed: 2, failed: 0, completedTitles: [], failedTitles: [], latestId: 'sess-42' },
        })}
        onDismiss={vi.fn()}
        onOpenSession={onOpenSession}
        onOpenJobs={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /view chats/i }))
    expect(onOpenSession).toHaveBeenCalledWith('sess-42')
  })

  it('does not render a runs link when there is no session to open', () => {
    render(
      <AwayDigestCard
        digest={digest({ crons: { total: 1, ok: 1, error: 0, failedNames: [] } })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    // crons-only digest → no "view chats" action.
    expect(screen.queryByRole('button', { name: /view chats/i })).not.toBeInTheDocument()
  })

  it('fires onDismiss from the dismiss control', async () => {
    const onDismiss = vi.fn()
    render(
      <AwayDigestCard
        digest={digest({ runs: { ...digest().runs, total: 1, completed: 1 } })}
        onDismiss={onDismiss}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('renders nothing when the digest reports no real activity', () => {
    const { container } = render(
      <AwayDigestCard digest={digest()} onDismiss={vi.fn()} onOpenSession={vi.fn()} onOpenJobs={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('never renders a fabricated approvals/notifications line', () => {
    render(
      <AwayDigestCard
        digest={digest({
          runs: { total: 1, completed: 1, failed: 0, completedTitles: [], failedTitles: [], latestId: 's1' },
          crons: { total: 2, ok: 2, error: 0, failedNames: [] },
        })}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenJobs={vi.fn()}
      />,
    )
    expect(screen.queryByText(/approval/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/notification/i)).not.toBeInTheDocument()
  })
})

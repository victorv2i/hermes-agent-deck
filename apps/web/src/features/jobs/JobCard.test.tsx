import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JobCard } from './JobCard'
import type { CronJob } from './types'

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job1',
    name: 'Morning digest',
    prompt: 'Summarize overnight emails',
    schedule: {
      kind: 'cron',
      display: '0 9 * * 1-5',
      expr: '0 9 * * 1-5',
      minutes: null,
      runAt: null,
    },
    enabled: true,
    paused: false,
    profile: 'default',
    deliver: 'telegram',
    noAgent: false,
    createdAt: '2026-05-29T12:00:00+00:00',
    nextRunAt: '2099-01-01T09:00:00+00:00',
    lastRunAt: '2026-05-29T09:00:00+00:00',
    lastStatus: 'ok',
    lastError: null,
    runCount: 4,
    repeatTimes: null,
    ...overrides,
  }
}

function renderCard(overrides: Partial<CronJob> = {}) {
  return render(
    <JobCard
      job={makeJob(overrides)}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onTrigger={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
}

describe('JobCard touch targets', () => {
  it('keeps every core action at least 44px on small screens without changing desktop density', () => {
    renderCard()

    const actionNames = [
      'Pause task',
      'Run task now',
      'Edit task',
      'Toggle run history',
      'Delete task',
    ]
    for (const name of actionNames) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toContain('min-h-11')
      expect(button.className).toContain('min-w-11')
      expect(button.className).toContain('sm:min-h-6')
      expect(button.className).toContain('sm:min-w-0')
    }
  })

  it('moves focus to the confirm button when the inline delete prompt opens', async () => {
    const user = userEvent.setup()
    renderCard()

    const card = screen.getByTestId('job-job1')
    await user.click(within(card).getByRole('button', { name: 'Delete task' }))

    const confirm = within(card).getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveFocus()
  })

  it('keeps delete confirmation actions touch-sized on small screens', async () => {
    const user = userEvent.setup()
    renderCard()

    const card = screen.getByTestId('job-job1')
    await user.click(within(card).getByRole('button', { name: 'Delete task' }))

    for (const name of ['Delete', 'Cancel']) {
      const button = within(card).getByRole('button', { name })
      expect(button.className).toContain('min-h-11')
      expect(button.className).toContain('min-w-11')
      expect(button.className).toContain('sm:min-h-6')
    }
  })
})

describe('JobCard layout (plain words first, machine ids demoted)', () => {
  it('leads with the schedule in words and demotes the raw cron to the detail line', () => {
    renderCard()

    // The lead line is plain words, not the cron expression.
    expect(screen.getByText('Every weekday at 9:00am')).toBeInTheDocument()
    // The raw cron is still present (nothing removed) but on the quiet detail line.
    const raw = screen.getByText('0 9 * * 1-5')
    expect(raw.closest('div')?.className).toContain('text-[11px]')
    expect(raw.closest('div')?.className).toContain('font-mono')
  })

  it('demotes the delivery target/thread ids to the detail line, keeping the platform label up top', () => {
    renderCard({ deliver: 'telegram:-1003747177894:18975' })

    // The friendly platform label stays in the readable meta row.
    expect(screen.getByText('Telegram')).toBeInTheDocument()
    // The machine ids live on the small mono detail line, full value in the tooltip.
    const target = screen.getByText('…7894 · thread 18975')
    expect(target).toHaveAttribute('title', 'Delivers to telegram:-1003747177894:18975')
    expect(target.closest('div')?.className).toContain('text-[11px]')
  })

  it('skips the detail line entirely when there is nothing machine-y to show', () => {
    renderCard({
      deliver: 'local',
      schedule: { kind: 'interval', display: 'every 30m', expr: null, minutes: 30, runAt: null },
    })
    expect(screen.getByText('Every 30 minutes')).toBeInTheDocument()
    expect(screen.queryByTestId('job-detail-line')).not.toBeInTheDocument()
  })
})

describe('JobCard delete action', () => {
  it('styles delete like its bordered siblings (outline grammar, destructive tone, visible label)', () => {
    renderCard()
    const del = screen.getByRole('button', { name: 'Delete task' })
    expect(del).toHaveTextContent('Delete')
    expect(del).toHaveAttribute('data-variant', 'outline')
    expect(del.className).toContain('text-destructive')
    expect(del.className).toContain('border-destructive/30')
  })

  it('keeps the inline confirm flow before deleting', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <JobCard
        job={makeJob()}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
        onTrigger={vi.fn()}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('JobCard run history disclosure', () => {
  it('links the history toggle to its panel via aria-controls when open', async () => {
    const user = userEvent.setup()
    renderCard()

    const toggle = screen.getByRole('button', { name: 'Toggle run history' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panelId = toggle.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).toBeInTheDocument()
  })
})

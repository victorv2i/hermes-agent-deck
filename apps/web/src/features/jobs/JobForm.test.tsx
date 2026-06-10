import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { JobForm } from './JobForm'
import type { CronJob } from './types'

function makeJob(over: Partial<CronJob> = {}): CronJob {
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
    deliver: 'local',
    noAgent: false,
    createdAt: '2026-05-29T12:00:00+00:00',
    nextRunAt: '2099-01-01T09:00:00+00:00',
    lastRunAt: '2026-05-29T09:00:00+00:00',
    lastStatus: 'ok',
    lastError: null,
    runCount: 4,
    repeatTimes: null,
    ...over,
  }
}

function renderForm(props: Partial<Parameters<typeof JobForm>[0]> = {}) {
  render(
    <ThemeProvider>
      <JobForm onCancel={props.onCancel ?? vi.fn()} {...props} />
    </ThemeProvider>,
  )
}

describe('JobForm delivery caveat', () => {
  it('warns under "Send result to" that an offline target may fail delivery (create mode)', () => {
    renderForm()
    const caveat = screen.getByTestId('deliver-caveat')
    expect(
      within(caveat).getByText(/already used by hermes|may fail delivery/i),
    ).toBeInTheDocument()
    // The caveat is the dropdown's described-by hint, so a screen reader hears it
    // when focused on the select.
    const select = screen.getByLabelText('Send result to')
    expect(select).toHaveAttribute('aria-describedby', expect.stringContaining(caveat.id))
  })

  it('does NOT show the delivery caveat when editing (no delivery field in edit mode)', () => {
    renderForm({ job: makeJob() })
    expect(screen.queryByTestId('deliver-caveat')).not.toBeInTheDocument()
  })
})

describe('JobForm plain-language scheduler', () => {
  it('fills the Schedule field from a parsed plain-language phrase and submits it', async () => {
    const user = userEvent.setup()
    const onSubmitCreate = vi.fn()
    renderForm({ onSubmitCreate })

    await user.type(screen.getByLabelText(/plain.language/i), 'every weekday at 9am')
    await user.click(screen.getByRole('button', { name: /use this schedule/i }))

    // The real Schedule field now carries the exact cron the phrase became.
    expect(screen.getByLabelText('Schedule')).toHaveValue('0 9 * * 1-5')

    await user.type(screen.getByLabelText('Prompt'), 'Summarize standup notes')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    expect(onSubmitCreate).toHaveBeenCalledTimes(1)
    expect(onSubmitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: '0 9 * * 1-5',
        prompt: 'Summarize standup notes',
      }),
    )
  })
})

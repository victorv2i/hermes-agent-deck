import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { JobsRoute } from './JobsRoute'
import type { CronJob } from './types'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    deliver: 'telegram',
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

/** A stateful in-memory cron backend the fetch stub serves. */
function mockBackend(initial: CronJob[]) {
  const jobs = new Map(initial.map((j) => [j.id, j]))
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
    const p = url.pathname
    const method = init?.method ?? 'GET'
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (p === '/api/agent-deck/cron/jobs' && method === 'GET') {
      return json(200, { jobs: [...jobs.values()] })
    }
    if (p === '/api/agent-deck/profiles' && method === 'GET') {
      return json(200, {
        active: 'default',
        profiles: [
          {
            name: 'default',
            path: '/h/default',
            isDefault: true,
            isActive: true,
            model: null,
            provider: null,
            hasEnv: false,
            skillCount: 0,
            gatewayRunning: true,
            avatar: null,
            displayName: null,
          },
          {
            name: 'atlas',
            path: '/h/atlas',
            isDefault: false,
            isActive: false,
            model: null,
            provider: null,
            hasEnv: false,
            skillCount: 0,
            gatewayRunning: false,
            avatar: null,
            displayName: null,
          },
        ],
      })
    }
    if (p === '/api/agent-deck/cron/jobs' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        prompt: string
        schedule: string
        name?: string
        deliver?: string
        profile?: string
      }
      const created = makeJob({
        id: 'new1',
        name: body.name ?? 'new',
        prompt: body.prompt,
        deliver: body.deliver ?? 'local',
        profile: body.profile ?? 'default',
      })
      jobs.set(created.id, created)
      return json(200, created)
    }
    const m = p.match(/^\/api\/agent-deck\/cron\/jobs\/([^/]+)(?:\/(\w+))?$/)
    if (m) {
      const id = m[1]!
      const verb = m[2]
      const job = jobs.get(id)
      if (!job) return json(404, { error: 'Job not found' })
      if (method === 'DELETE') {
        jobs.delete(id)
        return json(200, { ok: true })
      }
      if (verb === 'pause') {
        const next = { ...job, paused: true, enabled: false }
        jobs.set(id, next)
        return json(200, next)
      }
      if (verb === 'resume') {
        const next = { ...job, paused: false, enabled: true }
        jobs.set(id, next)
        return json(200, next)
      }
      if (verb === 'trigger') return json(200, job)
      if (verb === 'runs') return json(200, { runs: [], limit: 20 })
    }
    return json(404, { error: 'not found' })
  })
  return { fetchMock, jobs }
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider>
          <JobsRoute />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('JobsRoute', () => {
  it('renders the job list with schedule + next/last run', async () => {
    const { fetchMock } = mockBackend([makeJob()])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    expect(screen.getByTestId('jobs-skeleton')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    // The schedule leads in words; the raw cron is demoted to the detail line.
    expect(screen.getByText('Every weekday at 9:00am')).toBeInTheDocument()
    expect(screen.getByText('0 9 * * 1-5')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('renders the empty state when there are no jobs', async () => {
    const { fetchMock } = mockBackend([])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()
    await waitFor(() => expect(screen.getByText('No scheduled tasks')).toBeInTheDocument())
  })

  it('carries a plain-language subtitle (no cron jargon in the lead)', async () => {
    const { fetchMock } = mockBackend([])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()
    await waitFor(() =>
      expect(
        screen.getByText('Scheduled work your agent runs for you (digests, checks, reminders).'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument()
  })

  it('renders an error state when the list call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    renderRoute()
    await waitFor(() =>
      expect(screen.getByText(/couldn’t load tasks|couldn't load tasks/i)).toBeInTheDocument(),
    )
  })

  it('pauses a job and reflects the new state', async () => {
    const user = userEvent.setup()
    const { fetchMock } = mockBackend([makeJob()])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Pause task' }))

    // After a successful pause the toggle flips to "Resume" (an unambiguous signal).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume task' })).toBeInTheDocument(),
    )
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) =>
          String(u).endsWith('/cron/jobs/job1/pause') && (i as RequestInit)?.method === 'POST',
      ),
    ).toBe(true)
  })

  it('deletes a job after confirming', async () => {
    const user = userEvent.setup()
    const { fetchMock } = mockBackend([makeJob()])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    const card = screen.getByTestId('job-job1')
    await user.click(within(card).getByRole('button', { name: 'Delete task' }))
    // Inline confirm appears; confirm it.
    await user.click(within(card).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Morning digest')).not.toBeInTheDocument())
  })

  it('opens the create form and submits a new job', async () => {
    const user = userEvent.setup()
    const { fetchMock } = mockBackend([])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('No scheduled tasks')).toBeInTheDocument())
    // The header "New task" button (first one).
    await user.click(screen.getAllByRole('button', { name: /new task/i })[0]!)

    const form = screen.getByRole('form', { name: 'New task' })
    await user.type(within(form).getByLabelText('Schedule'), 'every 30m')
    await user.type(within(form).getByLabelText('Prompt'), 'do a thing')
    await user.click(within(form).getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).endsWith('/cron/jobs') && (i as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    )
  })

  it('lets the create form choose a delivery target + profile and sends them', async () => {
    const user = userEvent.setup()
    // A job already delivers to a real telegram target — the form offers it as a
    // proven-accepted option (never a control that can only fail).
    const { fetchMock } = mockBackend([makeJob({ deliver: 'telegram:-1003747177894:18975' })])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: /new task/i })[0]!)

    const form = screen.getByRole('form', { name: 'New task' })
    await user.type(within(form).getByLabelText('Schedule'), 'every 30m')
    await user.type(within(form).getByLabelText('Prompt'), 'do a thing')

    // Profile select is sourced from the real /api/agent-deck/profiles list.
    const profileSelect = within(form).getByLabelText('Agent profile')
    await user.selectOptions(profileSelect, 'atlas')

    // Delivery select offers local + the real in-use target.
    const deliverSelect = within(form).getByLabelText('Send result to')
    await user.selectOptions(deliverSelect, 'telegram:-1003747177894:18975')

    await user.click(within(form).getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/cron/jobs') && (i as RequestInit)?.method === 'POST',
      )
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body)) as {
        deliver?: string
        profile?: string
      }
      expect(body.deliver).toBe('telegram:-1003747177894:18975')
      expect(body.profile).toBe('atlas')
    })
  })

  it('humanizes a raw delivery id on the card (never a bare raw token)', async () => {
    const { fetchMock } = mockBackend([makeJob({ deliver: 'telegram:-1003747177894:18975' })])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    // The friendly label + short target render; the bare raw id does NOT.
    expect(screen.getByText('Telegram')).toBeInTheDocument()
    expect(screen.getByText('…7894 · thread 18975')).toBeInTheDocument()
    expect(screen.queryByText('telegram:-1003747177894:18975')).not.toBeInTheDocument()
    // …but the full raw value is recoverable via a title tooltip (on both the
    // platform label in the meta row and the demoted ids on the detail line).
    expect(screen.getAllByTitle('Delivers to telegram:-1003747177894:18975')).not.toHaveLength(0)
  })

  it('shows the run history disclosure with the last-error note', async () => {
    const user = userEvent.setup()
    const { fetchMock } = mockBackend([
      makeJob({ lastStatus: 'error', lastError: 'boom happened' }),
    ])
    vi.stubGlobal('fetch', fetchMock)
    renderRoute()

    await waitFor(() => expect(screen.getByText('Morning digest')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Toggle run history' }))

    expect(screen.getByText('Run history')).toBeInTheDocument()
    expect(screen.getByText(/boom happened/)).toBeInTheDocument()
  })
})

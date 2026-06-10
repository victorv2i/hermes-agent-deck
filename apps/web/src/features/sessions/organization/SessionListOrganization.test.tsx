import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Organization } from '@agent-deck/protocol'
import { SessionList } from '../SessionList'
import { SESSION_DRAG_TYPE } from './ProjectsSection'
import { getPinnedSnapshot, unpinSession } from '../pinStore'
import type { SessionListResponse } from '../types'

/**
 * Hermetic test of the connected SessionList's organization layer (projects +
 * tags): a stateful in-memory BFF (mocked global fetch) backs the real
 * `['organization']` query + its mutations through a real QueryClient. Covers
 * filtering by project + tag, assignment updating the list, create/delete
 * project, and the empty / no-projects states.
 */

const NOW = Math.floor(Date.now() / 1000)

function row(id: string, title: string) {
  return {
    // Web-originated so the rows pass §3's default source filter (the rail now
    // defaults to web/agent-deck sessions; these tests exercise the ORGANIZATION
    // layer, not the source filter, so they use the default-visible channel).
    id,
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title,
    preview: 'preview',
    started_at: NOW,
    last_active: NOW,
    message_count: 1,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    cost_usd: null,
    is_active: false,
  }
}

const SESSIONS: SessionListResponse = {
  total: 3,
  sessions: [row('s1', 'Alpha one'), row('s2', 'Beta two'), row('s3', 'Gamma three')],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// The mutable store the mock BFF reads/writes — mirrors the real server shape.
let org: Organization
let idSeq: number

function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    const t = v.trim().toLowerCase()
    if (t === '' || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

beforeEach(() => {
  for (const id of [...getPinnedSnapshot()]) unpinSession(id)
  org = { projects: [], assignments: {} }
  idSeq = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      // --- organization store --- (check the session-scoped route FIRST, since
      // `/sessions/:id/organization` also ends with `/organization`).
      const sessOrg = url.match(/\/sessions\/([^/]+)\/organization$/)
      if (sessOrg && method === 'PUT') {
        const id = sessOrg[1]!
        const assignment: { projectId?: string; tags?: string[] } = {}
        if (body.projectId !== null) assignment.projectId = body.projectId
        const tags = normalizeTags(body.tags ?? [])
        if (tags.length > 0) assignment.tags = tags
        if (assignment.projectId === undefined && assignment.tags === undefined) {
          delete org.assignments[id]
        } else {
          org.assignments[id] = assignment
        }
        return jsonResponse(assignment)
      }

      if (url.endsWith('/organization')) return jsonResponse(org)

      if (url.endsWith('/projects') && method === 'POST') {
        const project = { id: `p${++idSeq}`, name: body.name, color: body.color }
        org.projects.push(project)
        return jsonResponse(project, 201)
      }

      const projDel = url.match(/\/projects\/([^/]+)$/)
      if (projDel && method === 'DELETE') {
        const id = projDel[1]!
        org.projects = org.projects.filter((p) => p.id !== id)
        for (const [sid, a] of Object.entries(org.assignments)) {
          if (a.projectId === id) {
            if (a.tags?.length) org.assignments[sid] = { tags: a.tags }
            else delete org.assignments[sid]
          }
        }
        return jsonResponse({ ok: true })
      }

      // --- read-only session proxy ---
      if (url.includes('/search/sessions')) return jsonResponse({ results: [] })
      if (url.includes('/sessions')) return jsonResponse(SESSIONS)
      throw new Error(`unexpected fetch: ${method} ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderRail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionList selectedId={null} onSelect={() => {}} />
    </QueryClientProvider>,
  )
}

/** Open a session row's organize (⋯) menu by the row title. */
async function openOrganize(user: ReturnType<typeof userEvent.setup>, title: string) {
  // The row's ⋯ control is labelled "Organize <title>" when ONLY organize is
  // wired, else "More actions for <title>" (it now also hosts rename/archive).
  const trigger = await screen.findByRole('button', {
    name: new RegExp(`(Organize|More actions for) ${title}`),
  })
  await user.click(trigger)
}

describe('SessionList organization (connected)', () => {
  it('shows a no-projects Projects section ("All sessions" only) and all rows', async () => {
    renderRail()
    const group = await screen.findByRole('radiogroup', { name: /filter sessions by folder/i })
    expect(within(group).getAllByRole('radio')).toHaveLength(1)
    expect(within(group).getByText('All sessions')).toBeInTheDocument()
    expect(await screen.findByText('Alpha one')).toBeInTheDocument()
    expect(screen.getByText('Beta two')).toBeInTheDocument()
    expect(screen.getByText('Gamma three')).toBeInTheDocument()
  })

  it('assigns a session to a NEW project, then filters the list to it', async () => {
    const user = userEvent.setup()
    renderRail()
    await screen.findByText('Alpha one')

    // Organize s1 → Move to folder → New folder → name + create.
    await openOrganize(user, 'Alpha one')
    await user.click(await screen.findByRole('menuitem', { name: /Move to folder/i }))
    await user.click(await screen.findByRole('menuitem', { name: /New folder/i }))
    await user.type(await screen.findByLabelText('Folder name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    // The new project appears in the Projects section with a count of 1.
    const work = await screen.findByRole('radio', { name: /Work/ })
    await waitFor(() => expect(within(work).getByText('1')).toBeInTheDocument())

    // Filter to it → only the assigned session remains.
    await user.click(work)
    await waitFor(() => expect(screen.queryByText('Beta two')).not.toBeInTheDocument())
    expect(screen.getByText('Alpha one')).toBeInTheDocument()
    expect(screen.queryByText('Gamma three')).not.toBeInTheDocument()

    // The active-filter row names the project and can clear it.
    const filters = screen.getByLabelText('Active filters')
    expect(within(filters).getByText('Work')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Clear all/i }))
    await waitFor(() => expect(screen.getByText('Beta two')).toBeInTheDocument())
  })

  it('adds a tag, shows the chip, and filters by it', async () => {
    const user = userEvent.setup()
    renderRail()
    await screen.findByText('Beta two')

    await openOrganize(user, 'Beta two')
    await user.click(await screen.findByRole('menuitem', { name: /^Tags/i }))
    const input = await screen.findByLabelText('Add a tag')
    await user.type(input, 'urgent{Enter}')

    // The chip shows on the row (a filter button).
    const chip = await screen.findByRole('button', { name: /Filter by tag #urgent/i })
    expect(chip).toBeInTheDocument()

    // Clicking it filters the rail to tagged sessions only.
    await user.click(chip)
    await waitFor(() => expect(screen.queryByText('Alpha one')).not.toBeInTheDocument())
    expect(screen.getByText('Beta two')).toBeInTheDocument()

    // The chip now reads as the active filter (its label flips to "clear"), and
    // the active-filter row also surfaces a clear control — both are present.
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Clear tag filter #urgent/i }).length,
      ).toBeGreaterThan(0),
    )
    // Clearing it from the active-filter row restores the full list.
    const filters = screen.getByLabelText('Active filters')
    await user.click(within(filters).getByRole('button', { name: /Clear tag filter #urgent/i }))
    await waitFor(() => expect(screen.getByText('Alpha one')).toBeInTheDocument())
  })

  it('deletes a project (clearing its assignments) and removes it from the section', async () => {
    const user = userEvent.setup()
    // Seed a project + assignment so delete has something to clear.
    org = {
      projects: [{ id: 'p1', name: 'Legacy', color: 'rose' }],
      assignments: { s1: { projectId: 'p1' } },
    }
    renderRail()

    // The project shows with count 1.
    const legacy = await screen.findByRole('radio', { name: /Legacy/ })
    expect(within(legacy).getByText('1')).toBeInTheDocument()

    // Remove the only session's membership via the organize menu → No folder.
    await openOrganize(user, 'Alpha one')
    await user.click(await screen.findByRole('menuitem', { name: /Move to folder/i }))
    await user.click(await screen.findByRole('menuitem', { name: /No folder/i }))

    await waitFor(() => {
      const updated = screen.getByRole('radio', { name: /Legacy/ })
      expect(within(updated).getByText('0')).toBeInTheDocument()
    })
    // The server-side assignment is gone.
    expect(org.assignments.s1).toBeUndefined()
  })

  it('shows a filtered-empty state when a project matches no sessions', async () => {
    const user = userEvent.setup()
    org = { projects: [{ id: 'p1', name: 'Empty', color: 'sky' }], assignments: {} }
    renderRail()

    await user.click(await screen.findByRole('radio', { name: /Empty/ }))
    expect(await screen.findByText(/No sessions match this filter/i)).toBeInTheDocument()
    // And a clear affordance returns to the full list.
    await user.click(screen.getByRole('button', { name: /Clear filter/i }))
    await waitFor(() => expect(screen.getByText('Alpha one')).toBeInTheDocument())
  })

  it('Phase 2 — drag-to-organize: dropping a session on a folder assigns it, PRESERVING its tags', async () => {
    // Seed a folder + a tagged (but unfiled) session so the drop must keep tags.
    org = {
      projects: [{ id: 'p1', name: 'Work', color: 'sky' }],
      assignments: { s1: { tags: ['urgent'] } },
    }
    renderRail()

    // The "Work" folder is the drop target; the dragged session is s1.
    const work = await screen.findByRole('radio', { name: /Work/ })
    fireEvent.drop(work, {
      dataTransfer: {
        types: [SESSION_DRAG_TYPE],
        getData: (type: string) => (type === SESSION_DRAG_TYPE ? 's1' : ''),
      },
    })

    // The server-side assignment now files s1 under Work AND keeps its tag.
    await waitFor(() => expect(org.assignments.s1?.projectId).toBe('p1'))
    expect(org.assignments.s1?.tags).toEqual(['urgent'])
    // The folder count reflects the new membership.
    await waitFor(() =>
      expect(
        within(screen.getByRole('radio', { name: /Work/ })).getByText('1'),
      ).toBeInTheDocument(),
    )
  })

  it('marks an organized row with a NEUTRAL indicator on the ⋯ trigger (amber is for action, not metadata)', async () => {
    // Seed one organized session (a tag) and one bare session.
    org = {
      projects: [{ id: 'p1', name: 'Legacy', color: 'rose' }],
      assignments: { s1: { projectId: 'p1', tags: ['urgent'] } },
    }
    renderRail()

    const organizedTrigger = await screen.findByRole('button', {
      name: /(Organize|More actions for) Alpha one/,
    })
    const bareTrigger = await screen.findByRole('button', {
      name: /(Organize|More actions for) Gamma three/,
    })

    // Governance: the metadata state must NOT borrow the amber action accent.
    expect(organizedTrigger).not.toHaveClass('text-primary')
    // Instead a quiet neutral marker signals "this session is organized"…
    expect(organizedTrigger.querySelector('[data-testid="organize-indicator"]')).not.toBeNull()
    // …and the marker uses a neutral/categorical tone, never amber.
    const dot = organizedTrigger.querySelector('[data-testid="organize-indicator"]')!
    expect(dot.className).toContain('bg-foreground-tertiary')
    expect(dot.className).not.toContain('bg-primary')
    // A session with no project/tags shows no indicator at all.
    expect(bareTrigger.querySelector('[data-testid="organize-indicator"]')).toBeNull()
  })
})

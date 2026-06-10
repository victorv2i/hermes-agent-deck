import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { SessionHistoryView } from './SessionHistory'
import { toast } from '@/lib/toast'
import { clearSessionLabel, setSessionLabel } from './sessionLabels'
import type { SessionDetail, SessionMessage } from './types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/**
 * The History header now hosts the per-session organize menu (project + tags),
 * which reads the `['organization']` query — so every render needs a
 * QueryClientProvider and a stubbed org fetch. A local `render` shadow wraps the
 * tree so the existing presentational assertions stay untouched.
 */
beforeEach(() => {
  clearSessionLabel('sess-1')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ projects: [], assignments: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function render(ui: ReactElement, options?: RenderOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return rtlRender(ui, { wrapper: Wrapper, ...options })
}

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'sess-1',
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: 'Parser work',
    preview: 'help me',
    started_at: 1,
    last_active: 2,
    message_count: 4,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.01,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: 'none',
    ended_at: 3,
    tool_call_count: 1,
    ...over,
  }
}

function msg(over: Partial<SessionMessage> & { id: string; role: string }): SessionMessage {
  return {
    content: '',
    timestamp: 1,
    reasoning: null,
    tool_name: null,
    tool_calls: [],
    ...over,
  }
}

describe('SessionHistoryView', () => {
  it('renders the session title + a short model chip in the header', () => {
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Parser work' })).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
  })

  it('uses a browser-local session label without claiming Hermes renamed it', () => {
    setSessionLabel('sess-1', 'Better label')
    render(
      <SessionHistoryView
        detail={detail({ title: 'Parser work' })}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Better label' })).toBeInTheDocument()
    expect(screen.getByText('Local label')).toHaveAttribute(
      'title',
      'Local browser label. Hermes title: Parser work',
    )
  })

  it('shows a "History › <title>" breadcrumb with a Back-to-history affordance', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <SessionHistoryView
        detail={detail({ title: 'Parser work' })}
        messages={[]}
        isLoading={false}
        onBack={onBack}
        onContinue={() => {}}
      />,
    )
    // The breadcrumb names the parent surface (History) and the current session.
    const back = screen.getByRole('button', { name: /back to history/i })
    expect(back).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: /breadcrumb/i })
    expect(nav).toHaveTextContent(/History/)
    expect(nav).toHaveTextContent(/Parser work/)
    await user.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('renders the transcript with reused Message rendering (user + assistant prose)', () => {
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[
          msg({ id: '1', role: 'user', content: 'hello agent' }),
          msg({ id: '2', role: 'assistant', content: 'hi human' }),
        ]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText('hello agent')).toBeInTheDocument()
    // Assistant prose renders via the lazy Markdown fallback (raw text).
    expect(screen.getByText('hi human')).toBeInTheDocument()
  })

  it('fires onContinue with the session id when Resume is clicked', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(
      <SessionHistoryView
        detail={detail({ id: 'sess-xyz' })}
        messages={[msg({ id: '1', role: 'user', content: 'hi' })]}
        isLoading={false}
        onContinue={onContinue}
      />,
    )
    // §1 — the read-only transcript's resume control is named "Resume".
    await user.click(screen.getByRole('button', { name: /^Resume$/i }))
    expect(onContinue).toHaveBeenCalledWith('sess-xyz')
  })

  it('shows loading skeletons while the transcript loads', () => {
    render(
      <SessionHistoryView detail={detail()} messages={[]} isLoading={true} onContinue={() => {}} />,
    )
    expect(screen.getAllByTestId('transcript-skeleton').length).toBeGreaterThan(0)
  })

  it('renders an error state when given an error', () => {
    render(
      <SessionHistoryView
        detail={null}
        messages={[]}
        isLoading={false}
        error="boom"
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText(/Couldn't load this session/i)).toBeInTheDocument()
  })

  it('shows the model as a plain badge, NOT a fake switch control', () => {
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    // The model reads as a quiet muted chip…
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
    // …and there is NO dead "Switch model" affordance (no fake dropdown).
    expect(screen.queryByRole('button', { name: /Switch model/i })).not.toBeInTheDocument()
  })

  it('renders the shared SurfaceHeader (amber Lucide tile), not a bare header — T2.12', () => {
    const { container } = render(
      <SessionHistoryView
        detail={detail()}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    // The SurfaceHeader's title is an <h1>; the amber tile carries the .ad-surface
    // lifted-border treatment shared with Files/Terminal.
    expect(container.querySelector('h1')?.textContent).toBe('Parser work')
    expect(container.querySelector('header .ad-surface')).not.toBeNull()
  })

  it('offers a transcript export menu when there are messages — T2.4', async () => {
    const user = userEvent.setup()
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[msg({ id: '1', role: 'user', content: 'hi' })]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Session actions/i })
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Export as HTML/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Export as Markdown/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Export as JSON/i })).toBeInTheDocument()
  })

  it('disables export when the transcript is empty — T2.4', async () => {
    const user = userEvent.setup()
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    // The session menu stays reachable (so Copy ID works on an empty session),
    // but the export items are individually disabled.
    await user.click(screen.getByRole('button', { name: /Session actions/i }))
    expect(await screen.findByRole('menuitem', { name: /Export as HTML/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /Export as Markdown/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /Export as JSON/i })).toBeDisabled()
  })

  it('copies the raw session id + toasts when "Copy session ID" is clicked', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(
      <SessionHistoryView
        detail={detail({ id: 'sess-xyz' })}
        messages={[msg({ id: '1', role: 'user', content: 'hi' })]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Session actions/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Copy session ID/i }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]![0]).toBe('sess-xyz')
    expect(toast.success).toHaveBeenCalledWith('Session ID copied')
  })

  it('offers Copy session ID even when the transcript is empty', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(
      <SessionHistoryView
        detail={detail({ id: 'sess-empty' })}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Session actions/i }))
    const copy = await screen.findByRole('menuitem', { name: /Copy session ID/i })
    expect(copy).toBeEnabled()
    await user.click(copy)
    expect(writeText).toHaveBeenCalledWith('sess-empty')
  })

  it('reflects a failed session in the header with an accessible indicator', () => {
    render(
      <SessionHistoryView
        detail={detail({ status: 'failed', end_reason: 'error' })}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByLabelText('Session failed')).toBeInTheDocument()
  })

  it('reflects a handed-off session in the header with a distinct indicator', () => {
    render(
      <SessionHistoryView
        detail={detail({ handoff_state: 'handed_off' })}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByLabelText('Session handed off')).toBeInTheDocument()
    expect(screen.queryByLabelText('Session failed')).not.toBeInTheDocument()
  })

  it('shows NO state indicator in the header for a normal/completed session', () => {
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Session failed')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Session handed off')).not.toBeInTheDocument()
  })

  // --- virtualization + client-side backward reveal (Lane A) -----------------
  it('virtualizes a long transcript — only a windowed subset is in the DOM', () => {
    const many: SessionMessage[] = Array.from({ length: 400 }, (_, i) =>
      msg({ id: String(i), role: i % 2 === 0 ? 'user' : 'assistant', content: `line ${i}` }),
    )
    render(
      <SessionHistoryView
        detail={detail()}
        messages={many}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    // The newest message is mounted; an early one is windowed out of the DOM.
    expect(screen.getByText('line 399')).toBeInTheDocument()
    expect(screen.queryByText('line 0')).not.toBeInTheDocument()
  })

  it('exposes the transcript as a labelled, focusable log (a11y preserved)', () => {
    render(
      <SessionHistoryView
        detail={detail()}
        messages={[msg({ id: '1', role: 'user', content: 'hi' })]}
        isLoading={false}
        onContinue={() => {}}
      />,
    )
    const log = screen.getByRole('log', { name: /transcript|conversation/i })
    expect(log).toHaveAttribute('tabindex', '0')
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MessagesSquare, FolderTree, Settings } from 'lucide-react'
import { CommandPalette, CommandPaletteView } from './CommandPalette'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { CATALOGS } from '@/i18n'
import type { SessionSummary } from '@/features/sessions/types'

const NAV_ACTIONS = [
  {
    // Chat is pinned-top in the rail, but in the palette it's still a "Go to" row
    // under its routing group (workspace now that the chat group is gone).
    key: 'chat',
    label: 'Chat',
    labelKey: 'navigation.item.chat.label' as const,
    group: 'workspace' as const,
    icon: MessagesSquare,
    run: vi.fn(),
  },
  {
    key: 'files',
    label: 'Files',
    labelKey: 'navigation.item.files.label' as const,
    group: 'workspace' as const,
    icon: FolderTree,
    run: vi.fn(),
  },
  {
    key: 'settings',
    label: 'Settings',
    labelKey: 'navigation.item.settings.label' as const,
    group: 'activity' as const,
    icon: Settings,
    run: vi.fn(),
  },
]

const SESSIONS: SessionSummary[] = [
  {
    id: 's1',
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: 'Refactor the parser',
    preview: 'help me refactor',
    started_at: 1,
    last_active: 1,
    message_count: 2,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
  },
]

function renderPalette(over?: Partial<React.ComponentProps<typeof CommandPaletteView>>) {
  const props: React.ComponentProps<typeof CommandPaletteView> = {
    open: true,
    onOpenChange: vi.fn(),
    navItems: NAV_ACTIONS,
    sessions: SESSIONS,
    sessionsLoading: false,
    onOpenSession: vi.fn(),
    onNewChat: vi.fn(),
    onToggleTheme: vi.fn(),
    resolvedTheme: 'dark',
    activePalette: 'clay-sky',
    onSetPalette: vi.fn(),
    agents: [],
    activeAgent: '',
    onSwitchAgent: vi.fn(),
    ...over,
  }
  render(<CommandPaletteView {...props} />)
  return props
}

describe('CommandPaletteView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists navigation surfaces, the New chat action, and theme toggle', () => {
    renderPalette()
    expect(
      screen.getByPlaceholderText(/Search commands, sessions, agents, themes/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Chat/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Files/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /New chat/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /light theme/i })).toBeInTheDocument()
  })

  it("renders each surface's own Lucide icon, not one shared glyph", () => {
    renderPalette()
    // The Files row should carry the folder-tree glyph (its real nav icon), and
    // the Settings row the settings glyph — proving the rows are no longer all
    // rendered with the same chat-bubble icon.
    const files = screen.getByRole('option', { name: /Files/ })
    const settings = screen.getByRole('option', { name: /Settings/ })
    expect(files.querySelector('.lucide-folder-tree')).not.toBeNull()
    expect(settings.querySelector('.lucide-settings')).not.toBeNull()
    // ...and the Files row does NOT carry the Settings glyph (no shared icon).
    expect(files.querySelector('.lucide-settings')).toBeNull()
  })

  it('matches translated visible command labels while filtering', async () => {
    const user = userEvent.setup()
    const newChatKey = 'commandPalette.action.newChat' as const
    const englishCatalog = CATALOGS.en as unknown as Record<string, string>
    const original = CATALOGS.en[newChatKey] ?? 'New chat'
    englishCatalog[newChatKey] = 'Nueva charla'
    try {
      const props = renderPalette()
      await user.type(screen.getByRole('combobox'), 'Nueva')
      const row = screen.getByRole('option', { name: /Nueva charla/i })
      await user.click(row)
      expect(props.onNewChat).toHaveBeenCalledTimes(1)
    } finally {
      englishCatalog['commandPalette.action.newChat'] = original
    }
  })

  it('runs a nav action and closes when a surface is picked', async () => {
    const user = userEvent.setup()
    const props = renderPalette()
    await user.click(screen.getByRole('option', { name: /Files/ }))
    expect(NAV_ACTIONS[1]!.run).toHaveBeenCalled()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('runs New chat and closes', async () => {
    const user = userEvent.setup()
    const props = renderPalette()
    await user.click(screen.getByRole('option', { name: /New chat/i }))
    expect(props.onNewChat).toHaveBeenCalled()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('toggles theme and closes', async () => {
    const user = userEvent.setup()
    const props = renderPalette()
    await user.click(screen.getByRole('option', { name: /light theme/i }))
    expect(props.onToggleTheme).toHaveBeenCalled()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens a matching session and closes', async () => {
    const user = userEvent.setup()
    const props = renderPalette()
    await user.type(screen.getByRole('combobox'), 'parser')
    const row = screen.getByRole('option', { name: /Refactor the parser/ })
    await user.click(row)
    expect(props.onOpenSession).toHaveBeenCalledWith('s1')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('spells the New-chat shortcut with ⌘ on Mac (C3 platform key)', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' } as Navigator)
    renderPalette()
    expect(screen.getByRole('option', { name: /New chat/i })).toHaveTextContent('⌘N')
  })

  it('spells the shortcut with Ctrl on Linux/Windows (C3 platform key)', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' } as Navigator)
    renderPalette()
    expect(screen.getByRole('option', { name: /New chat/i })).toHaveTextContent('CtrlN')
  })

  it('reflects the active theme in the toggle label', () => {
    renderPalette({ resolvedTheme: 'light' })
    expect(screen.getByRole('option', { name: /dark theme/i })).toBeInTheDocument()
  })

  it('never offers a Run-panel action (the Activity drawer was removed)', () => {
    renderPalette()
    // Tool calls + approvals render inline in the chat stream, so there is no
    // live-run drawer to toggle from the palette.
    expect(screen.queryByRole('option', { name: /Run panel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Activity panel/i })).not.toBeInTheDocument()
  })

  it('offers a Clear chat action when wired, and runs + closes it', async () => {
    const user = userEvent.setup()
    const onClearChat = vi.fn()
    const props = renderPalette({ onClearChat })
    await user.click(screen.getByRole('option', { name: /Clear chat/i }))
    expect(onClearChat).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers the Maintenance & logs actions when wired (Restart, Check updates, Open System, Open Logs)', async () => {
    const user = userEvent.setup()
    const onRestartGateway = vi.fn()
    const onCheckHermesUpdates = vi.fn()
    const onOpenSystem = vi.fn()
    const onOpenLogs = vi.fn()
    const props = renderPalette({
      onRestartGateway,
      onCheckHermesUpdates,
      onOpenSystem,
      onOpenLogs,
    })

    await user.click(screen.getByRole('option', { name: /restart your agent/i }))
    expect(onRestartGateway).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)

    renderPalette({ onRestartGateway, onCheckHermesUpdates, onOpenSystem, onOpenLogs })
    await user.click(screen.getAllByRole('option', { name: /check for hermes updates/i })[0]!)
    expect(onCheckHermesUpdates).toHaveBeenCalledTimes(1)

    renderPalette({ onRestartGateway, onCheckHermesUpdates, onOpenSystem, onOpenLogs })
    await user.click(screen.getAllByRole('option', { name: /open system/i })[0]!)
    expect(onOpenSystem).toHaveBeenCalledTimes(1)

    // Logs was demoted out of the rail — the palette is now a primary way in.
    renderPalette({ onRestartGateway, onCheckHermesUpdates, onOpenSystem, onOpenLogs })
    await user.click(screen.getAllByRole('option', { name: /open logs/i })[0]!)
    expect(onOpenLogs).toHaveBeenCalledTimes(1)
  })

  it('omits the Maintenance & logs actions when their handlers are not wired', () => {
    renderPalette()
    expect(screen.queryByRole('option', { name: /restart your agent/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /check for hermes updates/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /open system/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /open logs/i })).not.toBeInTheDocument()
  })

  it('offers an "Open Messaging" command when wired, and runs + closes it', async () => {
    const user = userEvent.setup()
    const onOpenMessaging = vi.fn()
    const props = renderPalette({ onOpenMessaging })
    await user.click(screen.getByRole('option', { name: /messaging/i }))
    expect(onOpenMessaging).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('omits the Messaging command when its handler is not wired', () => {
    renderPalette()
    expect(screen.queryByRole('option', { name: /messaging/i })).not.toBeInTheDocument()
  })

  it('names the MCP command with the canonical "MCP" (matching the nav), never "MCP servers"', () => {
    // Coherence: the destination must read the SAME way everywhere. The rail and
    // the "Go to" rows say "MCP"; the Actions shortcut must not drift to a second
    // name ("MCP servers") for the same place — one canonical user-facing form.
    const onOpenMcp = vi.fn()
    renderPalette({ onOpenMcp })
    expect(screen.getByRole('option', { name: /^MCP$/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /MCP servers/i })).not.toBeInTheDocument()
  })

  it('omits the Clear action when its handler is not wired', () => {
    renderPalette()
    expect(screen.queryByRole('option', { name: /Clear chat/i })).not.toBeInTheDocument()
  })

  it('offers an Appearance group with a quick-switch row per family', () => {
    renderPalette()
    // The THREE registered families each get a "Set theme to <name>" row.
    expect(screen.getByRole('option', { name: /Set theme to Clay & Sky/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Set theme to Warm Void/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Set theme to Indigo Atelier/i })).toBeInTheDocument()
    // The former 5th family is gone (folded into Warm Void's light mode).
    expect(
      screen.queryByRole('option', { name: /Set theme to Warm Parchment/i }),
    ).not.toBeInTheDocument()
    // The dropped Ember Study family no longer has a row.
    expect(
      screen.queryByRole('option', { name: /Set theme to Ember Study/i }),
    ).not.toBeInTheDocument()
  })

  it('marks the active palette row (governed amber check)', () => {
    renderPalette({ activePalette: 'warm-void' })
    const row = screen.getByRole('option', { name: /Set theme to Warm Void/i })
    expect(within(row).getByLabelText(/active theme/i)).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-current', 'true')
    // A non-active row carries no active marker.
    const indigo = screen.getByRole('option', { name: /Set theme to Indigo Atelier/i })
    expect(within(indigo).queryByLabelText(/active theme/i)).not.toBeInTheDocument()
  })

  it('switches the palette and closes when a theme row is picked', async () => {
    const user = userEvent.setup()
    const props = renderPalette()
    await user.click(screen.getByRole('option', { name: /Set theme to Indigo Atelier/i }))
    expect(props.onSetPalette).toHaveBeenCalledWith('indigo-atelier')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  const AGENTS = [
    {
      name: 'default',
      displayPath: 'Hermes home',
      isDefault: true,
      isActive: true,
      model: 'gpt-5.5',
      provider: null,
      hasEnv: true,
      skillCount: 1,
      gatewayRunning: true,
      avatar: null,
      displayName: null,
    },
    {
      name: 'atlas',
      displayPath: 'profiles/atlas',
      isDefault: false,
      isActive: false,
      model: 'sonnet',
      provider: null,
      hasEnv: false,
      skillCount: 2,
      gatewayRunning: false,
      avatar: 'v3' as const,
      displayName: null,
    },
  ]

  it('lists the agent roster and switches the active agent by keyboard', async () => {
    const user = userEvent.setup()
    const props = renderPalette({ agents: AGENTS, activeAgent: 'default' })
    // The Agents group renders each agent (the default reads as "Your agent").
    expect(screen.getByRole('option', { name: /your agent/i })).toBeInTheDocument()
    const atlasRow = screen.getByRole('option', { name: /atlas/i })
    await user.click(atlasRow)
    expect(props.onSwitchAgent).toHaveBeenCalledWith('atlas')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('marks the active agent with the amber check and renders the face as an <img> (never amber svg)', () => {
    render(
      <CommandPaletteView
        open
        onOpenChange={vi.fn()}
        navItems={NAV_ACTIONS}
        sessions={[]}
        sessionsLoading={false}
        onOpenSession={vi.fn()}
        onNewChat={vi.fn()}
        onToggleTheme={vi.fn()}
        resolvedTheme="dark"
        activePalette="clay-sky"
        onSetPalette={vi.fn()}
        agents={AGENTS}
        activeAgent="default"
        onSwitchAgent={vi.fn()}
      />,
    )
    const activeRow = screen.getByRole('option', { name: /your agent/i })
    expect(within(activeRow).getByLabelText(/active agent/i)).toBeInTheDocument()
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    // The avatar is an <img> webp (the CommandDialog portals to body), so the
    // active-row [&_svg]:text-primary tint can never paint the face sky-blue.
    expect(document.querySelector('img[src*="/avatars/"]')).not.toBeNull()
  })

  it('shows sessions loading state as a disabled row and empty state as calm text', () => {
    renderPalette({ sessions: [], sessionsLoading: true })
    const loading = screen.getByRole('option', { name: /loading recent sessions/i })
    expect(loading).toHaveAttribute('aria-disabled', 'true')

    renderPalette({ sessions: [], sessionsLoading: false })
    // Empty state is rendered as a plain paragraph, not a selectable option.
    expect(screen.getByText(/no recent sessions/i)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /no recent sessions/i })).not.toBeInTheDocument()
  })
})

describe('CommandPalette (connected)', () => {
  // The connected palette wires the REAL nav registry; queries simply error/stay
  // empty in jsdom (retry off), which the palette renders calmly.
  function renderConnected(open = true) {
    const onOpenChange = vi.fn()
    render(
      <ThemeProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter>
            <CommandPalette open={open} onOpenChange={onOpenChange} onNewChat={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    )
    return { onOpenChange }
  }

  it('derives "Go to" rows from the nav registry, including the pinned Usage and the System rail row', () => {
    renderConnected()
    // Usage is pinned (not grouped) in the rail but NOT hidden, so it gets a
    // Go-to row; System is a visible rail row again and gets one too.
    expect(screen.getByRole('option', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'System' })).toBeInTheDocument()
    // Hidden surfaces never become Go-to rows; Logs keeps only its explicit
    // "Open Logs" action.
    expect(screen.queryByRole('option', { name: 'Logs' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /open logs/i })).toBeInTheDocument()
  })

  // Note: the ⌘K palette open seam is App-owned: the `openPalette`
  // Outlet-context action drives it, so the connected palette has no self-open
  // path. That wiring is pinned in App.test.tsx ("the Outlet context's
  // openPalette action opens the command palette").
})

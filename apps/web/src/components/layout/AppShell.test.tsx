import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { AppShell } from './AppShell'

// The rail's surface NAV renders react-router <NavLink>s, so the shell needs a
// router context. A MemoryRouter keeps the unit test hermetic (no browser URL).
// The rail also mounts the connected SessionList (TanStack Query), so a
// QueryClientProvider is required; with no fetch backend the list simply stays
// in its loading/empty state, which is fine for these chrome-level assertions.
function renderShell(props?: Partial<React.ComponentProps<typeof AppShell>>, route = '/files') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppShell connection="online" {...props}>
            <div data-testid="conversation">conversation content</div>
          </AppShell>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/**
 * Drive the responsive media queries. `isMobile` matches the `max-width` mobile
 * query; `wide` matches the `min-width` sessions-pane width gate (1024px,
 * defaults to true so desktop tests see the pane); `cockpit` matches the WIDE
 * (1280px) dock breakpoint (defaults to false so the Preview panel stays a
 * modal slide-over unless a test opts in). A reduced-motion query never matches.
 */
function setViewport(isMobile: boolean, wide = true, cockpit = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width')
      ? isMobile
      : query.includes('1280')
        ? cockpit
        : query.includes('min-width')
          ? wide
          : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function getSidebarNavElement(): HTMLElement {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Sidebar"]')
  expect(nav).not.toBeNull()
  return nav!
}

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    setViewport(false)
  })

  it('renders the three zones: rail, conversation, header', () => {
    renderShell()
    expect(screen.getByRole('navigation', { name: /sidebar/i })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByTestId('conversation')).toBeInTheDocument()
  })

  it('header shows a theme toggle, and the wordmark lives in the rail', () => {
    renderShell()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('button', { name: /theme/i })).toBeInTheDocument()
    // The rail owns the brand wordmark while expanded.
    const nav = screen.getByRole('navigation', { name: /sidebar/i })
    expect(within(nav).getByText('Agent Deck')).toBeInTheDocument()
    // No redundant header wordmark while the rail is expanded.
    expect(within(banner).queryByText('Agent Deck')).not.toBeInTheDocument()
  })

  it('surfaces the wordmark in the header when the rail is collapsed', async () => {
    const user = userEvent.setup()
    renderShell()
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByText('Agent Deck')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(within(banner).getByText('Agent Deck')).toBeInTheDocument()
  })

  it('header shows a connection-status dot reflecting the connection prop', () => {
    renderShell({ connection: 'offline' })
    const dot = screen.getByTestId('connection-dot')
    expect(dot).toHaveAttribute('data-status', 'offline')
    expect(dot).toHaveAccessibleName(/offline/i)
  })

  it('does NOT show the remote-mode banner on a loopback bind (default)', () => {
    renderShell()
    expect(screen.queryByTestId('remote-mode-banner')).not.toBeInTheDocument()
  })

  it('shows the remote-mode warning banner when bound remotely', () => {
    renderShell({ remote: true })
    const banner = screen.getByTestId('remote-mode-banner')
    expect(banner).toHaveTextContent(/remote mode/i)
    expect(banner).toHaveTextContent(/not a network boundary/i)
  })

  it('rail shows New chat and is NAV-ONLY (no embedded session list)', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: /sidebar/i })
    expect(within(nav).getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    // The desktop single rail is nav-only now — recents live on Home + History + ⌘K,
    // so the embedded session list (search box + Sessions list) is gone.
    expect(
      within(nav).queryByRole('searchbox', { name: /search sessions/i }),
    ).not.toBeInTheDocument()
    expect(within(nav).queryByRole('list', { name: /sessions/i })).not.toBeInTheDocument()
  })

  it('does NOT stack a chrome surface-title on a surface that renders its own header (Files)', () => {
    // Coherence: surfaces that render their own in-content header (PageHeader /
    // SurfaceHeader, e.g. Files) must NOT also get the chrome fallback title — the
    // page title was stacking twice ("Files" over "Files"). The chrome label is
    // suppressed for header-owning surfaces; the page's own header owns the title.
    renderShell({}, '/files')
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByTestId('surface-title')).not.toBeInTheDocument()
  })

  it('does NOT stack a chrome surface-title on the History surface (it renders its own header)', () => {
    renderShell({}, '/history')
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByTestId('surface-title')).not.toBeInTheDocument()
  })

  it('does NOT stack a chrome surface-title on the Tools surface (it renders its own header)', () => {
    // ToolsetsPage brings its own PageHeader, so the chrome fallback title must
    // stay suppressed — the page was showing "Tools" twice.
    renderShell({}, '/tools')
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByTestId('surface-title')).not.toBeInTheDocument()
  })

  it('does NOT show a surface-title label on the Chat surface (it projects its own header)', () => {
    // Chat projects its own header content (title · model · ring) via the header
    // slot; the fallback label must defer to that — never both. Chat owns a header,
    // so the chrome fallback stays suppressed here too.
    renderShell({ children: <div>chat</div> }, '/chat')
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByTestId('surface-title')).not.toBeInTheDocument()
  })

  it('collapses and expands the left rail via the toggle', async () => {
    const user = userEvent.setup()
    renderShell()
    const nav = screen.getByRole('navigation', { name: /sidebar/i })
    expect(nav).toHaveAttribute('data-collapsed', 'false')
    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(nav).toHaveAttribute('data-collapsed', 'true')
  })

  it('fires onNewChat when New chat is clicked', async () => {
    const user = userEvent.setup()
    let clicked = 0
    renderShell({ onNewChat: () => (clicked += 1) })
    await user.click(screen.getByRole('button', { name: /new chat/i }))
    expect(clicked).toBe(1)
  })

  describe('responsive (mobile)', () => {
    it('hides the rail off-canvas and exposes a menu button under the mobile breakpoint', () => {
      setViewport(true)
      renderShell()
      const nav = getSidebarNavElement()
      // Off-canvas (closed) on mobile by default.
      expect(nav).toHaveAttribute('data-mobile-open', 'false')
      expect(nav).toHaveAttribute('aria-hidden', 'true')
      expect(nav).toHaveAttribute('inert')
      // A navigation button replaces the desktop collapse toggle.
      expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
    })

    it('opens the slide-over rail via the navigation button and closes via the backdrop', async () => {
      const user = userEvent.setup()
      setViewport(true)
      renderShell()
      await user.click(screen.getByRole('button', { name: /open navigation/i }))
      let nav = getSidebarNavElement()
      expect(nav).toHaveAttribute('data-mobile-open', 'true')
      expect(nav).not.toHaveAttribute('aria-hidden')
      expect(nav).not.toHaveAttribute('inert')
      // The backdrop dismisses the slide-over.
      await user.click(screen.getByTestId('mobile-rail-backdrop'))
      nav = getSidebarNavElement()
      expect(nav).toHaveAttribute('data-mobile-open', 'false')
      expect(nav).toHaveAttribute('aria-hidden', 'true')
      expect(nav).toHaveAttribute('inert')
    })

    it('does not render the desktop collapse toggle on mobile', () => {
      setViewport(true)
      renderShell()
      expect(screen.queryByRole('button', { name: /collapse sidebar/i })).not.toBeInTheDocument()
    })

    it('uses 44px header hit targets on mobile', () => {
      setViewport(true)
      renderShell({
        preview: <div>Preview panel</div>,
      })
      expect(screen.getByRole('button', { name: /open navigation/i }).className).toContain(
        'size-11',
      )
      expect(screen.getByRole('button', { name: /theme/i }).className).toContain('size-11')
      expect(screen.getByTestId('preview-toggle').className).toContain('size-11')
    })

    it('header is >=44px tall on mobile and has at most sm-gap spacing', () => {
      // The header must be >=44px (h-12 = 48px) on mobile so it is a reachable
      // touch surface regardless of which buttons are rendered.
      setViewport(true)
      renderShell({ preview: <div>Preview panel</div> })
      const header = screen.getByRole('banner')
      expect(header.className).toContain('h-12')
    })

    it('wordmark text collapses to icon-only below 480px to avoid crowding with the icon buttons', () => {
      // At 390px with Menu + PreviewToggle + ThemeToggle the "Agent Deck" text
      // (~147px) leaves almost no room for the header slot. The Wordmark outer
      // span must carry a responsive class that hides the text at narrow widths
      // (<=479px) so the header stays uncluttered.
      setViewport(true)
      renderShell({ preview: <div>Preview panel</div> })
      const banner = screen.getByRole('banner')
      const wordmarkText = within(banner).queryByText('Agent Deck')
      // The wordmark text is present in the DOM (not removed) but the wrapping
      // Wordmark element must carry a class that hides the text at <=479px.
      expect(wordmarkText).not.toBeNull()
      // The outer Wordmark span receives the responsive hiding class via its
      // className prop — check the closest Wordmark wrapper element.
      const wordmarkOuter = wordmarkText!.closest('span[class*="inline-flex"]')
      expect(wordmarkOuter).not.toBeNull()
      expect(wordmarkOuter!.className).toMatch(/max-\[479px\]/)
    })

    it('marks the open slide-over as a modal (aria-modal) and unmarks it when closed', async () => {
      const user = userEvent.setup()
      setViewport(true)
      renderShell()
      let nav = getSidebarNavElement()
      // Closed: not a modal.
      expect(nav).not.toHaveAttribute('aria-modal', 'true')
      await user.click(screen.getByRole('button', { name: /open navigation/i }))
      nav = getSidebarNavElement()
      expect(nav).toHaveAttribute('aria-modal', 'true')
      // Dismiss via the backdrop clears the modal marking.
      await user.click(screen.getByTestId('mobile-rail-backdrop'))
      nav = getSidebarNavElement()
      expect(nav).not.toHaveAttribute('aria-modal', 'true')
    })

    it('moves focus into the slide-over on open', async () => {
      const user = userEvent.setup()
      setViewport(true)
      renderShell()
      await user.click(screen.getByRole('button', { name: /open navigation/i }))
      const nav = screen.getByRole('navigation', { name: /sidebar/i })
      // Focus is trapped inside the panel: the active element is within the nav.
      expect(nav.contains(document.activeElement)).toBe(true)
    })

    it('returns focus to the header nav control when a resize auto-closes the open rail', async () => {
      // A LIVE matchMedia: the mobile query flips on resize and fires its change
      // listeners so the hook re-renders (the shared setViewport mock never fires
      // change, so build a controllable one here).
      let mobile = true
      const listeners = new Set<() => void>()
      window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const isMobileQuery = query.includes('max-width')
        const mql = {
          get matches() {
            // Mobile query tracks `mobile`; the pane/cockpit width gates stay true/
            // false so the desktop single rail renders after the resize.
            return isMobileQuery ? mobile : query.includes('min-width') && !query.includes('1280')
          },
          media: query,
          onchange: null,
          addEventListener: (_: string, cb: () => void) => {
            if (isMobileQuery) listeners.add(cb)
          },
          removeEventListener: (_: string, cb: () => void) => {
            listeners.delete(cb)
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }
        return mql
      })

      const user = userEvent.setup()
      renderShell()
      const trigger = screen.getByRole('button', { name: /open navigation/i })
      await user.click(trigger)
      const nav = screen.getByRole('navigation', { name: /sidebar/i })
      expect(nav).toHaveAttribute('data-mobile-open', 'true')

      // Widen past the mobile breakpoint: the rail auto-closes and the Menu
      // trigger is replaced by the desktop collapse toggle in the same header
      // slot. A keyboard user must not be dumped on <body> — focus moves to that
      // header nav control so keyboard position is preserved.
      act(() => {
        mobile = false
        for (const cb of listeners) cb()
      })

      expect(screen.queryByRole('button', { name: /open navigation/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /collapse sidebar/i })).toHaveFocus()
    })
  })

  describe('surface-aware split rail', () => {
    const pane = <div data-testid="sessions-pane-content">sessions pane</div>

    it('single variant (default) renders the labeled rail, no icon-nav, no sessions pane', () => {
      renderShell()
      // The labeled Sidebar nav owns the wordmark on a single-rail surface.
      const nav = screen.getByRole('navigation', { name: /sidebar/i })
      expect(within(nav).getByText('Agent Deck')).toBeInTheDocument()
      // No slim icon-nav, no dedicated sessions pane on a single-rail surface.
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
    })

    it('split variant renders the labeled nav AND a dedicated sessions pane (three panels)', () => {
      renderShell({ variant: 'split', sessionsPane: pane })
      // §2(a) — the stable labeled surface nav is the split rail's first column
      // (no slim icon-nav shapeshift).
      const nav = screen.getByRole('navigation', { name: /^sidebar$/i })
      expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      // The dedicated sessions pane (second column) carries the provided content.
      const paneRegion = screen.getByTestId('sessions-pane')
      expect(within(paneRegion).getByTestId('sessions-pane-content')).toBeInTheDocument()
      expect(paneRegion).toHaveAttribute('data-sessions-collapsed', 'false')
    })

    it('does NOT mount the sessions pane below the width gate (labeled nav stays, no pane)', () => {
      setViewport(false, /* wide */ false)
      renderShell({ variant: 'split', sessionsPane: pane })
      // §2(a) — the labeled nav stays stable; only the pane is width-gated away on
      // a narrow desktop (and there's no icon-rail).
      expect(screen.getByRole('navigation', { name: /^sidebar$/i })).toBeInTheDocument()
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
    })

    it('marks the pane collapsed when sessionsCollapsed is set', () => {
      renderShell({ variant: 'split', sessionsPane: pane, sessionsCollapsed: true })
      expect(screen.getByTestId('sessions-pane')).toHaveAttribute('data-sessions-collapsed', 'true')
    })

    it('fires onToggleSessions from the header collapse toggle in split mode', async () => {
      const user = userEvent.setup()
      const onToggleSessions = vi.fn()
      renderShell({ variant: 'split', sessionsPane: pane, onToggleSessions })
      await user.click(screen.getByRole('button', { name: /sessions pane/i }))
      expect(onToggleSessions).toHaveBeenCalledTimes(1)
    })

    it('keeps the mobile slide-over (full labeled rail) in split mode', () => {
      setViewport(true)
      renderShell({ variant: 'split', sessionsPane: pane })
      // On mobile, the slide-over carries the full Sidebar (nav + session list),
      // not the icon-nav split layout — reusing the existing responsive machinery.
      const nav = getSidebarNavElement()
      expect(nav).toHaveAttribute('data-mobile-open', 'false')
      expect(nav).toHaveAttribute('inert')
      expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
      // No desktop slim icon-nav / dedicated pane on mobile.
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
    })

    it('WIDE split: shows the LABELED nav (labels visible) + the sessions pane, no icon-nav', () => {
      // §2(a) — the desktop split nav is ONE stable treatment now: the full
      // labeled surface nav (like the single rail) WHILE keeping the dedicated
      // sessions pane. It never shapeshifts to icons on resize.
      setViewport(false, /* wide */ true, /* cockpit */ true)
      renderShell({ variant: 'split', sessionsPane: pane })
      // The labeled nav column is present, with visible text labels. (Agents is a
      // stable always-visible labeled link, standing in as the proof that labels
      // render, not icon-only rows.)
      const nav = screen.getByRole('navigation', { name: /^sidebar$/i })
      expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: /^agents$/i })).toBeInTheDocument()
      // The dedicated sessions pane stays beside it.
      expect(screen.getByTestId('sessions-pane')).toBeInTheDocument()
      // The labeled column does NOT collapse to the slim icon-nav.
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      // The labeled nav owns the wordmark, so the header doesn't duplicate it.
      expect(within(screen.getByRole('banner')).queryByText('Agent Deck')).not.toBeInTheDocument()
      expect(within(nav).getByText('Agent Deck')).toBeInTheDocument()
      // The split nav drops the embedded session LIST (the pane owns it), so
      // it isn't duplicated.
      expect(within(nav).queryByRole('list', { name: /sessions/i })).not.toBeInTheDocument()
    })

    it('§2(a) NARROW split keeps the LABELED nav (stable) — no icon-rail shapeshift on resize', () => {
      // Wide enough for the pane (>=1024) but below the old 1280 cockpit gate.
      // Previously this collapsed to a slim icon-nav (a surprising shapeshift on
      // resize); now the desktop split rail keeps ONE stable labeled treatment so
      // the nav reads identically at every desktop width. The pane still shows.
      setViewport(false, /* wide */ true, /* cockpit */ false)
      renderShell({ variant: 'split', sessionsPane: pane })
      const nav = screen.getByRole('navigation', { name: /^sidebar$/i })
      expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
      expect(screen.getByTestId('sessions-pane')).toBeInTheDocument()
      // The icon-rail is gone from the desktop split layout entirely.
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      // The labeled nav owns the wordmark, so the header doesn't duplicate it.
      expect(within(screen.getByRole('banner')).queryByText('Agent Deck')).not.toBeInTheDocument()
    })

    it('§2(a) below the pane gate keeps the LABELED nav too (no pane, still no icon-rail)', () => {
      // 768–1023px: too narrow for the dedicated pane, but still desktop. The nav
      // stays the stable labeled treatment (the icon-rail no longer appears on
      // desktop); only the pane is width-gated away.
      setViewport(false, /* wide */ false, /* cockpit */ false)
      renderShell({ variant: 'split', sessionsPane: pane })
      const nav = screen.getByRole('navigation', { name: /^sidebar$/i })
      expect(within(nav).getByRole('link', { name: /^chat$/i })).toBeInTheDocument()
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sessions-pane')).not.toBeInTheDocument()
    })
  })
})

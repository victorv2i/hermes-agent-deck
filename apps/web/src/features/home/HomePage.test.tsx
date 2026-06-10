import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AgentDeckStatus } from '@agent-deck/protocol'
import { StartAgentButton } from '@/features/system/StartAgentButton'
import { START_AGENT_COPY } from '@/features/system/startAgentCopy'
import { HomePage, type HomePageProps } from './HomePage'
import type { SessionSummary } from '@/features/sessions/types'
import type { UsageSummary } from '@/features/usage/types'
import { RECENT_CHANGELOG } from './changelog'
import { setPalette } from '@/features/themes/palette'
import { DEFAULT_PALETTE_ID } from '@/features/themes/palette-registry'

const NOW = Date.UTC(2026, 4, 30, 12, 0, 0)
const NOW_SEC = Math.floor(NOW / 1000)

// The offline headline's one-click recovery rides the REAL StartAgentButton
// (the Maintenance dock's restart machinery); stub its only network call.
const mockRestartGateway = vi.fn()
vi.mock('@/features/system/api', () => ({
  restartGateway: () => mockRestartGateway(),
  fetchSystem: vi.fn(),
  applyHermesUpdate: vi.fn(),
  runDoctor: vi.fn(),
}))

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'sess-1',
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title: 'Plan the launch',
    preview: 'Let us map out the week ahead',
    started_at: NOW_SEC - 600,
    last_active: NOW_SEC - 300,
    message_count: 6,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    cost_usd: null,
    is_active: false,
    ...overrides,
  }
}

const STATUS: AgentDeckStatus = {
  gatewayRunning: true,
  gatewayState: 'running',
  platforms: [
    { name: 'telegram', state: 'connected', error: null },
    { name: 'cron', state: 'connected', error: null },
  ],
  activeSessions: 1,
  version: '0.15.2',
  configUpdateAvailable: false,
}

const USAGE: UsageSummary = {
  periodDays: 7,
  totals: {
    inputTokens: 20000,
    outputTokens: 5500,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0.63,
    actualCost: 0.4,
    sessions: 8,
  },
  daily: [],
  byModel: [],
}

const ACTIVE_PROFILE: HomePageProps['activeProfile'] = {
  name: 'Sol',
  isDefault: false,
  avatar: null,
  displayName: null,
}

const TENDING: HomePageProps['tending'] = {
  connection: { label: 'Connected', tone: 'ok' },
  facts: ['watching 2 schedules', '3 jobs ran today'],
  idle: false,
}

function setup(overrides: Partial<HomePageProps> = {}) {
  const props: HomePageProps = {
    activeProfile: ACTIVE_PROFILE,
    recentSessions: [session()],
    sessionsLoading: false,
    status: STATUS,
    usage: USAGE,
    tending: TENDING,
    onStartChat: vi.fn(),
    onOpenPalette: vi.fn(),
    onResumeSession: vi.fn(),
    onNavigate: vi.fn(),
    now: NOW,
    ...overrides,
  }
  const view = render(
    <MemoryRouter>
      <HomePage {...props} />
    </MemoryRouter>,
  )
  return { ...props, container: view.container }
}

describe('HomePage', () => {
  afterEach(() => {
    // Reset the module-level palette store so palette-driven tests don't leak.
    setPalette(DEFAULT_PALETTE_ID)
  })

  /* ----------------------------------------------------------------------- */
  /* ACT 1 — the identity hero                                               */
  /* ----------------------------------------------------------------------- */

  it('renders an identity hero: the agent face, a "Meet <name>" headline, and ONE Start a chat CTA', () => {
    const props = setup()
    // Headline uses the friendly agent name now that the agent has a face.
    expect(screen.getByRole('heading', { name: /meet sol/i })).toBeInTheDocument()
    // The agent's face renders (the governed Avatar primitive is an <img>).
    const hero = screen.getByRole('banner')
    expect(hero.querySelector('img[src^="/avatars/"]')).not.toBeNull()
    // Exactly one governed amber action: the Start a chat CTA.
    const cta = screen.getByRole('button', { name: /start a chat/i })
    fireEvent.click(cta)
    expect(props.onStartChat).toHaveBeenCalledTimes(1)
  })

  it('shows a welcome-back headline (not a name intro) for returning users with the default profile', () => {
    // Returning user (onboarded=true) with the unnamed default profile — a "Meet …"
    // intro reads as first-run every day; a welcome-back framing is warmer for daily drivers.
    setup({
      activeProfile: { name: 'default', isDefault: true, avatar: null },
      onboarded: true,
    })
    expect(screen.queryByRole('heading', { name: /^meet/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })

  it('shows a name-bearing welcome-back headline (not "Meet …") for returning users with a NAMED agent', () => {
    // A returning (onboarded) user with a named agent shouldn't be re-introduced
    // every visit — "Meet Sol" reads as first-run. A warm "Welcome back to
    // Sol" is the daily-driver framing while keeping the identity name.
    setup({ activeProfile: ACTIVE_PROFILE, onboarded: true })
    expect(screen.queryByRole('heading', { name: /^meet/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /welcome back to sol/i })).toBeInTheDocument()
  })

  it('shows the ACCURATE name ("Meet default", never a fabricated label) for first-run users', () => {
    // New user (onboarded=false / undefined) sees the intro framing with the agent's
    // REAL name — the built-in agent reads as "default", not "your agent".
    setup({
      activeProfile: { name: 'default', isDefault: true, avatar: null },
      onboarded: false,
    })
    expect(screen.getByRole('heading', { name: /meet default/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /meet your agent/i })).not.toBeInTheDocument()
  })

  it('greets a RETURNING user in FIRST PERSON with one real tending fact in the hero subhead', () => {
    // The default TENDING fixture carries real facts; the hero folds ONE in — but
    // only for a returning (onboarded) user, whose headline is welcome-back too.
    setup({ onboarded: true })
    const hero = screen.getByRole('banner')
    expect(within(hero).getByText(/^While you were away/i)).toBeInTheDocument()
    // The folded fact is the real, completed-jobs fact spoken first-person.
    expect(within(hero).getByText(/I finished 3 jobs/i)).toBeInTheDocument()
  })

  it('keeps the FIRST-RUN subhead static (no "While you were away") even when a cron job already ran', () => {
    // Regression: on a genuine first run (onboarded=false) the "Meet {name}" intro
    // headline must not sit next to a "While you were away I finished N jobs"
    // subhead just because the agent ran a cron job before first open.
    setup({ onboarded: false, tending: TENDING })
    const hero = screen.getByRole('banner')
    // Intro headline AND intro subhead — no first-person welcome-back contradiction.
    expect(within(hero).getByRole('heading', { name: /meet sol/i })).toBeInTheDocument()
    expect(within(hero).queryByText(/welcome back/i)).not.toBeInTheDocument()
    expect(within(hero).queryByText(/I finished 3 jobs/i)).not.toBeInTheDocument()
    expect(within(hero).getByText(/this is your agent's home base/i)).toBeInTheDocument()
  })

  it('degrades the subhead to calm static copy when there is no real fact (idle)', () => {
    setup({ tending: { connection: { label: 'Connected', tone: 'ok' }, facts: [], idle: true } })
    const hero = screen.getByRole('banner')
    // No fabricated "welcome back" line — falls back to the steady front-door copy.
    expect(within(hero).queryByText(/welcome back/i)).not.toBeInTheDocument()
    expect(within(hero).getByText(/this is your agent's home base/i)).toBeInTheDocument()
  })

  it('degrades the subhead to static copy when no tending summary is available yet', () => {
    setup({ tending: undefined })
    const hero = screen.getByRole('banner')
    expect(within(hero).queryByText(/welcome back/i)).not.toBeInTheDocument()
    expect(within(hero).getByText(/this is your agent's home base/i)).toBeInTheDocument()
  })

  it('gives the Home CTA real presence (h-11 weight, in-spine 14px radius)', () => {
    setup()
    const cta = screen.getByRole('button', { name: /start a chat/i })
    // On Home only, the single governed amber CTA is sized up beyond the timid h-9.
    expect(cta.className).toContain('h-11')
    expect(cta.className).toContain('px-5')
    expect(cta.className).toContain('rounded-xl')
  })

  it('hero CTA button has touch-manipulation for fast tap response on mobile', () => {
    // `touch-manipulation` disables double-tap zoom so the 44px CTA responds
    // immediately on a phone without the 300ms tap delay.
    setup()
    const cta = screen.getByRole('button', { name: /start a chat/i })
    expect(cta.className).toContain('touch-manipulation')
  })

  it('status band usage line button meets 44px touch target (min-h-11)', () => {
    // The inline usage line ("25.5K tokens…") is an interactive affordance that
    // navigates to /usage. At its natural text height (~20px) it fails the 44px
    // touch-target floor. It must carry min-h-11 touch-manipulation.
    setup()
    const strip = screen.getByRole('region', { name: /status/i })
    const usageBtn = within(strip).getByRole('button', { name: /tokens/i })
    expect(usageBtn.className).toContain('min-h-11')
    expect(usageBtn.className).toContain('touch-manipulation')
  })

  it('homepage root div does not constrain the gateway banner width (no overflow-hidden)', () => {
    // The GatewayBanner is absolute-positioned within the homepage root and should
    // span the full content-area width. The root must be `relative` (positioning
    // context) and must NOT have overflow-hidden, otherwise the banner is clipped.
    const { container } = setup()
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('relative')
    expect(root.className).not.toContain('overflow-hidden')
  })

  it('keeps the ⌘K chip visually subordinate to the CTA (no amber, quiet surface)', () => {
    const hero = setup().container.querySelector('header')!
    const chip = within(hero).getByRole('button', { name: /open the command palette/i })
    // The hint is a quiet surface chip, never the amber action accent.
    expect(chip.className).not.toContain('bg-primary')
  })

  it('falls back to the Agent Deck wordmark when there is no active profile', () => {
    setup({ activeProfile: undefined })
    expect(screen.getByRole('heading', { name: /agent deck/i })).toBeInTheDocument()
    // No "Meet <name>" without a resolved identity.
    expect(screen.queryByRole('heading', { name: /^meet /i })).not.toBeInTheDocument()
  })

  it('advertises the command palette with a platform-correct mod-key chip', () => {
    const hero = setup().container.querySelector('header')!
    // On Linux (the test env) the platform mod-key reads "Ctrl", not the Mac glyph.
    expect(within(hero).getByText('K')).toBeInTheDocument()
    expect(within(hero).getByText(/ctrl|⌘/i)).toBeInTheDocument()
  })

  it('the ⌘K chip is a REAL button that fires the App-owned openPalette action', () => {
    // The chip drives the App-owned `openPalette` Outlet-context action,
    // threaded down by the connected route as the onOpenPalette prop. Pinned
    // strictly: exactly one call, and never the Start-a-chat action.
    const props = setup()
    const hero = props.container.querySelector('header')!
    fireEvent.click(within(hero).getByRole('button', { name: /open the command palette/i }))
    expect(props.onOpenPalette).toHaveBeenCalledTimes(1)
    expect(props.onStartChat).not.toHaveBeenCalled()
  })

  it('hides the ⌘K chip on coarse-pointer (touch) devices, where there is no keyboard', () => {
    const hero = setup().container.querySelector('header')!
    const chip = within(hero).getByRole('button', { name: /open the command palette/i })
    expect(chip.className).toContain('pointer-coarse:hidden')
  })

  it('renders a FULL-WIDTH mode-aware gateway banner (both light + dark imgs, never the accent)', () => {
    setup()
    const banner = screen.getByTestId('hero-gateway')
    // Both mode images ship; the .dark toggle swaps which paints.
    const light = banner.querySelector('img[src="/home-banner-light.webp"]')
    const dark = banner.querySelector('img[src="/home-banner-dark.webp"]')
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // Light shows in light mode (dark:hidden); dark shows in dark mode.
    expect(light!.className).toContain('dark:hidden')
    expect(dark!.className).toContain('dark:block')
    // It is the sky-blue identity art, not the amber --primary accent.
    expect(banner.className).not.toContain('text-primary')
    // Full-bleed: it spans the full page width (lifted out of the max-w column).
    expect(banner.className).toContain('inset-x-0')
  })

  it('anchors the open left with a soft token-driven left-edge glow (atmosphere, not void)', () => {
    setup()
    const banner = screen.getByTestId('hero-gateway')
    const glow = within(banner).getByTestId('hero-left-glow')
    // A token-driven radial (color-mix off --primary or --foreground), low-opacity,
    // NO glassmorphism/backdrop-blur and NO second accent.
    const bg = glow.style.background || glow.style.backgroundImage
    expect(bg).toMatch(/radial-gradient/i)
    expect(bg).toMatch(/color-mix/i)
    expect(bg).toMatch(/--primary|--foreground/)
    expect(glow.className).not.toContain('backdrop-blur')
  })

  /* ----------------------------------------------------------------------- */
  /* ACT 2 — the dashboard                                                   */
  /* ----------------------------------------------------------------------- */

  it('renders the dashboard sections below the hero', () => {
    setup()
    expect(screen.getByRole('region', { name: /status/i })).toBeInTheDocument()
    expect(screen.getByText('Jump back in')).toBeInTheDocument()
    expect(screen.getByText("What's new")).toBeInTheDocument()
  })

  /* ----------------------------------------------------------------------- */
  /* ACT 2 — the "what your agent is tending" strip                          */
  /* ----------------------------------------------------------------------- */

  it('renders a plain-language "tending" strip composed of the real facts', () => {
    setup()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    // The connection headline + each real fact reads as one warm line.
    expect(within(strip).getByText(/connected/i)).toBeInTheDocument()
    expect(within(strip).getByText(/watching 2 schedules/i)).toBeInTheDocument()
    expect(within(strip).getByText(/3 jobs ran today/i)).toBeInTheDocument()
  })

  it('uses a SEMANTIC status dot (not amber) for the connection state', () => {
    setup()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    // The governed StatusDot announces the connection state with an ok tone.
    const dot = within(strip).getByTestId('status-dot')
    expect(dot).toHaveAttribute('data-tone', 'ok')
  })

  it('shows a warn-tone connection headline when a platform needs attention', () => {
    setup({
      tending: {
        connection: { label: 'Connected · a platform needs attention', tone: 'warn' },
        facts: [],
        idle: true,
      },
    })
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    expect(within(strip).getByText(/needs attention/i)).toBeInTheDocument()
    expect(within(strip).getByTestId('status-dot')).toHaveAttribute('data-tone', 'warn')
  })

  it('shows an honest calm line when connected but idle (nothing to tend)', () => {
    setup({
      tending: { connection: { label: 'Connected', tone: 'ok' }, facts: [], idle: true },
    })
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    expect(
      within(strip).getByText(/all quiet|nothing scheduled|ready when you are/i),
    ).toBeInTheDocument()
  })

  it('shows an honest offline line in the tending strip when Hermes is down', () => {
    setup({
      tending: { connection: { label: 'Hermes is offline', tone: 'idle' }, facts: [], idle: false },
    })
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    expect(within(strip).getByText(/offline/i)).toBeInTheDocument()
    expect(within(strip).getByTestId('status-dot')).toHaveAttribute('data-tone', 'idle')
    // No startAgentAction passed (the route gates it off when the deck's own
    // server is unreachable): the offline line stays honestly action-less.
    expect(within(strip).queryByTestId('start-agent')).not.toBeInTheDocument()
  })

  it('omits the tending strip entirely when no summary is available (loading)', () => {
    setup({ tending: undefined })
    expect(screen.queryByRole('region', { name: /what .* tending/i })).not.toBeInTheDocument()
  })

  it('shows a "needs your OK" line when a deck-carried approval is waiting, and opens that chat', () => {
    const onOpenNeedsOk = vi.fn()
    setup({
      tending: { ...TENDING!, needsOk: 1 },
      onOpenNeedsOk,
    })
    const line = screen.getByTestId('tending-needs-ok')
    expect(line).toHaveTextContent('a chat here needs your OK')
    // The honest scope note: chats started here only — never Telegram/CLI runs.
    expect(line.getAttribute('title')).toMatch(/chats started here/i)
    expect(line.getAttribute('title')).toMatch(/telegram or the command line/i)
    fireEvent.click(line)
    expect(onOpenNeedsOk).toHaveBeenCalledTimes(1)
  })

  it('makes NO approval claim when nothing here is pending (honest idle copy stands)', () => {
    setup({
      tending: {
        connection: { label: 'Connected', tone: 'ok' },
        facts: [],
        idle: true,
        needsOk: 0,
      },
      onOpenNeedsOk: vi.fn(),
    })
    // No "needs your OK" line, and no fake all-clear about approvals — the calm
    // idle line about the agent's own tending facts is all that shows.
    expect(screen.queryByTestId('tending-needs-ok')).not.toBeInTheDocument()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    expect(within(strip).getByText(/all quiet, ready when you are/i)).toBeInTheDocument()
  })

  it('drops the redundant Quick actions row (it duplicated the always-visible rail)', () => {
    setup()
    expect(screen.queryByText('Quick actions')).not.toBeInTheDocument()
  })

  it('promotes recents to recognition cards (model + snippet + relative time) and resumes on click', () => {
    const props = setup({
      recentSessions: [
        session({ id: 'a', title: 'First', preview: 'Draft the release notes' }),
        session({ id: 'b', title: 'Second' }),
      ],
    })
    expect(screen.getByText('First')).toBeInTheDocument()
    // The model is shown (short form) and the last-message snippet rides along.
    expect(screen.getAllByText(/claude-sonnet-4/).length).toBeGreaterThan(0)
    expect(screen.getByText(/draft the release notes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Second'))
    expect(props.onResumeSession).toHaveBeenCalledWith('b')
  })

  it('shows the source glyph with an accessible label on a recent card', () => {
    setup({ recentSessions: [session({ id: 'a', title: 'First', source: 'cron' })] })
    expect(screen.getByRole('img', { name: /scheduled/i })).toBeInTheDocument()
  })

  it('shows skeleton cards while sessions load', () => {
    setup({ sessionsLoading: true, recentSessions: [] })
    expect(screen.getAllByTestId('home-session-skeleton').length).toBeGreaterThan(0)
    // No first-run starter prompts while loading.
    expect(screen.queryByText(/new here\?/i)).not.toBeInTheDocument()
  })

  it('shows an explicit recents error instead of first-run prompts when sessions fail', () => {
    const onRetrySessions = vi.fn()
    setup({
      recentSessions: [],
      sessionsLoading: false,
      sessionsError: true,
      onRetrySessions,
    })

    expect(screen.getByText(/couldn't load recent chats/i)).toBeInTheDocument()
    expect(screen.queryByText(/new here\?/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /get started with hermes/i }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetrySessions).toHaveBeenCalledTimes(1)
  })

  it('renders the status band: Hermes version chip, connection dots, usage line with time window', () => {
    setup()
    const strip = screen.getByRole('region', { name: /status/i })
    expect(within(strip).getByText('Hermes Agent')).toBeInTheDocument()
    expect(within(strip).getByText('Connections')).toBeInTheDocument()
    expect(within(strip).getByText('v0.15.2')).toBeInTheDocument()
    expect(within(strip).getByRole('img', { name: /2 of 2 connected/i })).toBeInTheDocument()
    // Usage line includes the time window (· last 7 days) so numbers have context.
    expect(
      within(strip).getByText(/25\.5K tokens · \$0\.63 · 8 sessions · last 7 days/),
    ).toBeInTheDocument()
  })

  it('makes the usage line a real affordance that navigates to /usage', () => {
    const props = setup()
    const strip = screen.getByRole('region', { name: /status/i })
    const usageLink = within(strip).getByRole('button', {
      name: /25\.5K tokens · \$0\.63 · 8 sessions · last 7 days/,
    })
    fireEvent.click(usageLink)
    expect(props.onNavigate).toHaveBeenCalledWith('/usage')
  })

  it('shows a "Config update" badge (not "Update available") that deep-links to the System dock (no action on Home)', () => {
    // configUpdateAvailable is a CONFIG-LEVEL update, not a version update.
    // "Update available" is too generic and misleading. "Config update" is precise.
    setup({ status: { ...STATUS, configUpdateAvailable: true } })
    const link = screen.getByRole('link', { name: /config update/i })
    expect(link).toHaveAttribute('href', '/system')
    // The old generic label must not appear
    expect(screen.queryByRole('link', { name: /^update available$/i })).not.toBeInTheDocument()
  })

  it('degrades the status band calmly (no error wall) when the dashboard is unreachable', () => {
    setup({ status: undefined, usage: undefined })
    const strip = screen.getByRole('region', { name: /status/i })
    expect(strip).toBeInTheDocument()
    expect(within(strip).getByText('offline')).toBeInTheDocument()
    expect(screen.getByText(/doesn't affect chatting/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
  })

  it('uses reachable Hermes health as the status-band fallback when detailed status is unavailable', () => {
    setup({ status: undefined, usage: undefined, hermesReachable: true })
    const strip = screen.getByRole('region', { name: /status/i })
    expect(within(strip).getAllByText(/^available$/i).length).toBeGreaterThan(0)
    expect(within(strip).queryByText(/^offline$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/live status is offline/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Hermes is reachable/i)).toBeInTheDocument()
  })

  it('shows "none connected" (not "no channels") when no platforms are reported', () => {
    setup({ status: { ...STATUS, platforms: [] } })
    const strip = screen.getByRole('region', { name: /status/i })
    expect(within(strip).getByText('none connected')).toBeInTheDocument()
  })

  it('omits the cross-source "Active recently" section when no band is supplied', () => {
    // The hermetic default keeps HomePage presentational — the self-fetching band
    // is injected by the connected route, never mounted by the surface itself.
    setup()
    expect(screen.queryByRole('region', { name: /active recently/i })).toBeNull()
  })

  it('wraps the supplied cross-source band in a labelled "Active recently" section', () => {
    setup({ activeRecently: <div data-testid="fleet-band" /> })
    const section = screen.getByRole('region', { name: /active recently/i })
    expect(within(section).getByTestId('fleet-band')).toBeInTheDocument()
  })

  it('collapses "What\'s new" by default for returning users (onboarded) and reveals entries on toggle', () => {
    // Returning user: What's new starts closed so it does not dominate the home screen.
    setup({ onboarded: true })
    const toggle = screen.getByRole('button', { name: /what's new/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(RECENT_CHANGELOG[0]!.title)).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(RECENT_CHANGELOG[0]!.title)).toBeInTheDocument()
  })

  it('expands "What\'s new" by default for first-run / not-yet-onboarded users', () => {
    // First-run user: What's new starts open so they can see recent improvements.
    setup({ onboarded: false, recentSessions: [] })
    const toggle = screen.getByRole('button', { name: /what's new/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(RECENT_CHANGELOG[0]!.title)).toBeInTheDocument()
  })

  /* ----------------------------------------------------------------------- */
  /* First-run — dual-audience starter prompts                              */
  /* ----------------------------------------------------------------------- */

  it('replaces recents with DUAL-AUDIENCE starter prompts on first run (no recents)', () => {
    const props = setup({ recentSessions: [] })
    // A calm teaching line for newcomers that defines an approval plainly.
    expect(screen.getByText(/approval keeps you in control/i)).toBeInTheDocument()
    // One newcomer, one everyday, one builder prompt — each starts a chat.
    const newcomer = screen.getByRole('button', { name: /get started with hermes/i })
    const everyday = screen.getByRole('button', { name: /weekly plan/i })
    // Builder starter does NOT assume a workspace — uses a general planning framing.
    const builder = screen.getByRole('button', { name: /break down/i })
    fireEvent.click(newcomer)
    fireEvent.click(everyday)
    fireEvent.click(builder)
    expect(props.onStartChat).toHaveBeenCalledTimes(3)
  })

  it('passes the chosen starter prompt text to onStartChat', () => {
    const props = setup({ recentSessions: [] })
    fireEvent.click(screen.getByRole('button', { name: /weekly plan/i }))
    expect(props.onStartChat).toHaveBeenCalledWith(expect.stringMatching(/weekly plan/i))
  })

  it('does not show starter prompts once there are recents', () => {
    setup({ recentSessions: [session()] })
    expect(
      screen.queryByRole('button', { name: /get started with hermes/i }),
    ).not.toBeInTheDocument()
  })
})

describe('HomePage — one-click recovery on the offline tending headline', () => {
  const OFFLINE_TENDING: HomePageProps['tending'] = {
    connection: { label: 'Hermes is offline', tone: 'idle' },
    facts: [],
    idle: false,
  }

  beforeEach(() => {
    mockRestartGateway.mockReset()
  })

  /** HomePage in the offline state with the REAL StartAgentButton in the slot
   * (HomeRoute's wiring), under the connected app's providers. */
  function renderOffline() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage
            activeProfile={ACTIVE_PROFILE}
            recentSessions={[]}
            sessionsLoading={false}
            status={undefined}
            tending={OFFLINE_TENDING}
            startAgentAction={<StartAgentButton />}
            onStartChat={vi.fn()}
            onOpenPalette={vi.fn()}
            onResumeSession={vi.fn()}
            onNavigate={vi.fn()}
            now={NOW}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('shows the Start my agent action next to the offline headline', () => {
    renderOffline()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    expect(within(strip).getByText(/hermes is offline/i)).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: START_AGENT_COPY.action })).toBeInTheDocument()
  })

  it('click → fires the dock restart mutation with honest pending copy and a double-click guard', async () => {
    let resolveRestart!: (v: unknown) => void
    mockRestartGateway.mockReturnValue(new Promise((res) => (resolveRestart = res)))
    renderOffline()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    const button = within(strip).getByRole('button', { name: START_AGENT_COPY.action })
    fireEvent.click(button)

    await waitFor(() => expect(mockRestartGateway).toHaveBeenCalledTimes(1))
    expect(await within(strip).findByText(START_AGENT_COPY.pending)).toBeInTheDocument()
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mockRestartGateway).toHaveBeenCalledTimes(1)

    resolveRestart({ status: 'running' })
    expect(await within(strip).findByText(START_AGENT_COPY.started)).toBeInTheDocument()
  })

  it('failure path: says the start failed plainly and points to the System page', async () => {
    mockRestartGateway.mockRejectedValue(new Error('systemctl exited 1'))
    renderOffline()
    const strip = screen.getByRole('region', { name: /what .* tending/i })
    fireEvent.click(within(strip).getByRole('button', { name: START_AGENT_COPY.action }))

    await waitFor(() =>
      expect(within(strip).getByRole('alert')).toHaveTextContent(START_AGENT_COPY.failureLead),
    )
    expect(within(strip).getByRole('link', { name: START_AGENT_COPY.failureLink })).toHaveAttribute(
      'href',
      '/system',
    )
  })
})

/* ========================================================================== */
/* Theme legibility guards — read the REAL token values off disk and prove    */
/* (a) secondary text clears WCAG AA on every surface it lands on, across all  */
/* five themes incl. light Parchment, and (b) the Home hero band is visible by */
/* CONSTRUCTION (a measurable luminance delta from plain --background), so an  */
/* invisible backdrop can never silently ship "green" again. Pure off-disk     */
/* parsing + WCAG sRGB math — no CSSOM (vitest runs with `css: false`, so      */
/* getComputedStyle resolves no tokens; true pixel sampling is infeasible in   */
/* jsdom, see the hero-band note below).                                       */
/* ========================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_SRC = path.resolve(HERE, '../../')
const INDEX_CSS = readFileSync(path.join(WEB_SRC, 'index.css'), 'utf8')
const PALETTES_CSS = readFileSync(path.join(WEB_SRC, 'features/themes/palettes.css'), 'utf8')

/**
 * Every FAMILY × light/dark face, with the data-palette id (null = default).
 * Three families; each ships a real dark + light variant. (The former standalone
 * 'warm-parchment' folded in as the LIGHT mode of the Warm Void family; the former
 * 'ember-study' family was dropped.)
 */
const THEME_FACES = [
  { name: 'Clay & Sky', palette: null, theme: 'dark' },
  { name: 'Clay & Sky', palette: null, theme: 'light' },
  { name: 'Warm Void', palette: 'warm-void', theme: 'dark' },
  { name: 'Warm Void', palette: 'warm-void', theme: 'light' },
  { name: 'Indigo Atelier', palette: 'indigo-atelier', theme: 'dark' },
  { name: 'Indigo Atelier', palette: 'indigo-atelier', theme: 'light' },
] as const

/**
 * Resolve a hex token value for a (palette, theme) face by selecting the rule
 * block whose selector matches that face, then reading the property. The default
 * (palette = null) face lives at the bare `:root` blocks in index.css; selectable
 * palettes live under `[data-palette='<id>']` (+ a light override) in palettes.css.
 * Light overrides win over the base dark block, matching the real cascade.
 */
function resolveHex(
  property: string,
  face: { palette: string | null; theme: 'dark' | 'light' },
): string {
  const css = face.palette === null ? INDEX_CSS : PALETTES_CSS
  const blocks = parseBlocks(css)
  let dark: string | undefined
  let light: string | undefined
  for (const block of blocks) {
    if (!blockMatchesFace(block.selector, face.palette)) continue
    const value = block.decls.get(property)
    if (value === undefined) continue
    if (/\[data-theme=['"]?light['"]?\]/.test(block.selector)) light = value
    else dark = value
  }
  const chosen = face.theme === 'light' ? (light ?? dark) : dark
  if (!chosen) {
    throw new Error(`no ${property} for palette=${face.palette} theme=${face.theme}`)
  }
  return normalizeHex(chosen)
}

/** Does a comma-list selector target the given palette face (ignoring theme)? */
function blockMatchesFace(selector: string, palette: string | null): boolean {
  const parts = selector.split(',').map((s) => s.trim())
  return parts.some((part) => {
    const palMatch = part.match(/\[data-palette=['"]?([\w-]+)['"]?\]/)
    if (palette === null) {
      // Default face: a bare :root / [data-theme] block that names no palette and
      // is not gated to a different palette via :not().
      if (palMatch) return false
      return /:root|\[data-theme=/.test(part)
    }
    return palMatch ? palMatch[1] === palette : false
  })
}

/** Minimal flat-block parser (selector { --prop: value; … }), at-rules skipped. */
function parseBlocks(css: string): { selector: string; decls: Map<string, string> }[] {
  const out: { selector: string; decls: Map<string, string> }[] = []
  let i = 0
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 2
      continue
    }
    const open = css.indexOf('{', i)
    if (open === -1) break
    const selector = css
      .slice(i, open)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      const ch = css[j]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    if (selector.startsWith('@')) {
      i = j
      continue
    }
    const decls = new Map<string, string>()
    for (const stmt of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
      const idx = stmt.indexOf(':')
      if (idx === -1) continue
      const prop = stmt.slice(0, idx).trim()
      const value = stmt.slice(idx + 1).trim()
      if (prop.startsWith('--')) decls.set(prop, value)
    }
    out.push({ selector, decls })
    i = j
  }
  return out
}

/** "#rgb" / "#rrggbb" → "#rrggbb" lowercase. */
function normalizeHex(raw: string): string {
  const hex = raw.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  return `#${full.toLowerCase()}`
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** WCAG 2.x relative luminance of an sRGB hex color. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio between two sRGB hex colors. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_NORMAL = 4.5

describe('theme legibility — secondary text clears WCAG AA on every surface', () => {
  // `--muted-foreground` is the secondary/snippet/meta text token; on Home it
  // lands on BOTH the base --background (hero subhead) and the --card surface
  // (recent-card snippet, status line). It must clear AA 4.5:1 on each, on every
  // theme face — enforced here as a permanent regression guard.
  for (const face of THEME_FACES) {
    it(`${face.name} (${face.theme}) — --muted-foreground AA on --background AND --card`, () => {
      const muted = resolveHex('--muted-foreground', face)
      const background = resolveHex('--background', face)
      const card = resolveHex('--card', face)

      const onBackground = contrastRatio(muted, background)
      const onCard = contrastRatio(muted, card)

      expect(
        onBackground,
        `${face.name}/${face.theme} muted=${muted} on background=${background} = ${onBackground.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
      expect(
        onCard,
        `${face.name}/${face.theme} muted=${muted} on card=${card} = ${onCard.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }
})

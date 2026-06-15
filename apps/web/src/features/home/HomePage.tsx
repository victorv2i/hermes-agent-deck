import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  Activity,
  Server,
  Sparkles,
  CalendarRange,
  FileSearch,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react'
import type { AgentDeckStatus } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { ErrorState } from '@/components/ui/state'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusDot } from '@/components/ui/StatusDot'
import { resolveAvatar, type ProfileLike } from '@/features/profiles/avatarForProfile'
import { usePlatformModKey } from '@/components/command/platformMod'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/format'
import type { SessionSummary } from '@/features/sessions/types'
import { sessionSourceMeta } from '@/features/sessions/sessionSource'
import { sanitizeSessionPreview } from '@/features/sessions/sessionPreview'
import type { UsageSummary } from '@/features/usage/types'
import { RECENT_CHANGELOG, formatChangelogDate } from './changelog'
import { summarizeFleet, summarizeUsageLine, formatVersion } from './statusSummary'
import { NEEDS_OK_COPY, type TendingSummary } from './tendingSummary'
import { composeGreeting } from './homeGreeting'

/**
 * Home — the IDENTITY-CENTRIC front door (Direction C, identity revamp). Now that
 * the agent has a face, Home is two acts:
 *
 *  - ACT 1 (the hero): the ACTIVE agent's face + a warm "Meet <name>" headline
 *    (falling back to the Agent Deck wordmark), a specific subhead, the ONE
 *    governed amber "Start a chat" CTA, and a quiet ⌘K/Ctrl chip — over a calm
 *    token-driven atmospheric backdrop (a soft radial gradient, NOT a flat box,
 *    no external image, no glassmorphism). One ≤220ms fade-rise, reduced-motion-safe.
 *  - ACT 2 (the dashboard, below a seam): "Jump back in" recognition cards, a slim
 *    live status band (hermes version + update badge + a usage line that opens the
 *    full Usage surface), and a refreshed "What's new". On first run (no recents)
 *    the recents zone becomes dual-audience starter prompts + one calm teaching
 *    line. (The old quick-actions row was dropped — it duplicated the always-
 *    visible rail.)
 *
 * Presentational by design: every input arrives as a prop (the connected
 * {@link './HomeRoute'} wires the hooks), so the surface is testable hermetically
 * and the governed amber accent is spent on exactly one thing — the CTA. Identity
 * (the avatar) is NEVER the accent.
 */
export interface HomePageProps {
  /**
   * The active agent's identity (name + chosen/default avatar) — drives the hero
   * face + headline. Undefined while the roster loads or when there is no
   * resolvable profile, in which case the hero shows the Agent Deck wordmark.
   */
  activeProfile?: ProfileLike
  /** Recent sessions (already limited + sorted by the route); empty on first run. */
  recentSessions: SessionSummary[]
  /** True while the initial sessions list is loading (shows skeleton cards). */
  sessionsLoading: boolean
  /** True when recent sessions failed to load (shows an explicit error state). */
  sessionsError?: boolean
  /** Live cross-source status, or undefined when the dashboard is unreachable. */
  status?: AgentDeckStatus
  /**
   * Lower-level Hermes gateway health fallback. True means Hermes is reachable even
   * when the detailed dashboard status is unavailable; false/undefined keeps the
   * offline/unavailable copy honest.
   */
  hermesReachable?: boolean
  /**
   * The INSTALLED hermes version (System probe — `hermes version`). Home prefers
   * this for the "Hermes" badge so it matches the System page and the user's "my
   * hermes version"; `status.version` is the RUNNING gateway daemon's version,
   * which lags the install until the daemon restarts. Falls back to the gateway
   * version when this probe hasn't resolved.
   */
  installedVersion?: string | null
  /** Rolling usage window, or undefined when usage is unavailable. */
  usage?: UsageSummary
  /**
   * The plain-language "what your agent is tending" summary (composed by the
   * route from existing hooks). Undefined while the first reads load — the strip
   * is omitted until there is a real summary to show.
   */
  tending?: TendingSummary
  /**
   * True once the user has taken a first action (started a chat, resumed a
   * session). Drives copy framing (welcome-back vs intro) and "What's new"
   * default-open for first-run discovery.
   */
  onboarded?: boolean
  /**
   * Start a chat (the CTA, the New chat quick action, and the first-run starter
   * prompts). An optional `prompt` seeds the composer with a starter line.
   */
  onStartChat: (prompt?: string) => void
  /**
   * Open the ⌘K command palette (the hero's quiet hint chip). The App layout owns
   * the palette's open state; the connected route threads its App-owned
   * `openPalette` context action down here.
   */
  onOpenPalette: () => void
  /** Resume a session in place (a "Jump back in" card). */
  onResumeSession: (id: string) => void
  /**
   * Open the chat that is waiting on an approval (the tending strip's "needs
   * your OK" line). Wired by HomeRoute to land on the live conversation; the
   * line renders only when both a pending approval AND this handler exist.
   */
  onOpenNeedsOk?: () => void
  /**
   * One-click recovery for a down agent (the shared Start my agent button),
   * rendered next to the tending strip's offline headline. HomeRoute passes it
   * ONLY when the deck's own server answered a probe AND that answer says the
   * agent is down (health reachable=false, or status with the gateway not
   * running); when the deck server itself is unreachable a restart call cannot
   * land, so the headline stays honestly action-less.
   */
  startAgentAction?: ReactNode
  /** Retry the recent sessions query after an error. */
  onRetrySessions?: () => void
  /** Navigate to another surface (the status band's usage line → Usage). */
  onNavigate: (path: string) => void
  /**
   * The cross-source "Active recently" fleet band (self-fetching). Supplied by
   * the connected {@link './HomeRoute'} so HomePage stays presentational +
   * hermetically testable; omitted, the section is not rendered.
   */
  activeRecently?: ReactNode
  /** Render-time clock for relative ages; injectable for deterministic tests. */
  now?: number
}

export function HomePage({
  activeProfile,
  recentSessions,
  sessionsLoading,
  sessionsError = false,
  status,
  hermesReachable,
  installedVersion,
  usage,
  tending,
  onboarded = false,
  onStartChat,
  onOpenPalette,
  onResumeSession,
  onOpenNeedsOk,
  startAgentAction,
  onRetrySessions,
  onNavigate,
  activeRecently,
  // eslint-disable-next-line react-hooks/purity -- read-only render clock; tests inject a fixed value.
  now = Date.now(),
}: HomePageProps) {
  return (
    // The page is a relative, isolated, full-width column so the gateway banner can
    // be a FULL-BLEED band edge-to-edge across the top, while the hero + dashboard
    // stay in a centered max-w-5xl reading column that sits OVER the calm right side
    // of the banner. (The banner is lifted out of the centered column on purpose.)
    <div className="relative isolate flex w-full flex-col pb-12 md:pb-16">
      {/* ACT 1 atmosphere — the FULL-WIDTH gateway banner band behind the hero. */}
      <GatewayBanner />

      <div className="mx-auto flex w-full max-w-5xl flex-col px-6">
        {/* ACT 1 — the identity hero (centered column, over the banner). */}
        <Hero
          profile={activeProfile}
          tending={tending}
          onboarded={onboarded}
          onStartChat={onStartChat}
          onOpenPalette={onOpenPalette}
        />

        {/* The seam between the brand moment and the operator dashboard. */}
        <hr className="my-10 border-0 border-t border-border md:my-12" />

        {/* ACT 2 — the dashboard. */}
        <div className="flex flex-col gap-10">
          {tending ? (
            <TendingStrip
              tending={tending}
              onOpenNeedsOk={onOpenNeedsOk}
              startAgentAction={startAgentAction}
            />
          ) : null}
          <JumpBackIn
            sessions={recentSessions}
            loading={sessionsLoading}
            error={sessionsError}
            onResume={onResumeSession}
            onStartChat={onStartChat}
            onRetry={onRetrySessions}
            now={now}
          />
          <StatusBand
            status={status}
            hermesReachable={hermesReachable}
            installedVersion={installedVersion}
            usage={usage}
            onNavigate={onNavigate}
          />
          {activeRecently ? <ActiveRecently>{activeRecently}</ActiveRecently> : null}
          <WhatsNew defaultOpen={!onboarded} />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* ACT 1 — Hero                                                               */
/* -------------------------------------------------------------------------- */

function Hero({
  profile,
  tending,
  onboarded,
  onStartChat,
  onOpenPalette,
}: {
  profile?: ProfileLike
  tending?: TendingSummary
  onboarded: boolean
  onStartChat: (prompt?: string) => void
  onOpenPalette: () => void
}) {
  const mod = usePlatformModKey()
  const named = profile && profile.name.trim().length > 0
  const friendly = named ? friendlyName(profile) : null
  // The agent speaks: fold ONE real tending fact into a first-person "while you
  // were away" subhead (the headline already says "Welcome back", so the subhead
  // never repeats it), degrading to the calm static front-door copy when there's
  // nothing real (never fabricated). Gated to onboarded users — on a genuine first
  // run a "while you were away" line would contradict the "Meet {name}" intro
  // headline even when a cron job already ran before first open. The
  // avatar/nameplate are unchanged.
  const subhead = composeGreeting(friendly, tending, onboarded)

  // For a returning user (onboarded) with only the default/unnamed profile, "Meet
  // your agent" reads as a first-run introduction every day. Use a calmer
  // welcome-back framing instead. Named profiles (or default profiles where the
  // user set a displayName) always show their name — identity is the point.
  const hasDisplayName = Boolean(profile?.displayName?.trim())
  const isDefaultProfile =
    !named || (profile && (profile.isDefault || profile.name === 'default') && !hasDisplayName)
  // A returning (onboarded) user shouldn't be re-introduced to their agent every
  // visit. The default/unnamed agent gets a bare "Welcome back"; a NAMED agent gets
  // a warmer name-bearing "Welcome back to {name}". "Meet {name}" stays the genuine
  // FIRST-RUN (not-yet-onboarded) introduction only.
  const headlineIsWelcomeBack = onboarded && isDefaultProfile
  const headlineIsWelcomeBackNamed = onboarded && named && !isDefaultProfile

  return (
    <header className="relative flex flex-col items-start gap-5 pt-14 md:pt-20">
      {/* The atmospheric backdrop is now the FULL-WIDTH gateway banner rendered at
          page level (see {@link GatewayBanner}); the hero content sits over its
          calm right side. */}

      {/* The signature first-paint motion: a single ≤220ms fade-rise, neutralized
          to settle instantly under the global prefers-reduced-motion guard. */}
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 flex flex-col items-start gap-5 duration-200">
        {named ? (
          <Avatar avatarId={resolveAvatar(profile)} name={profile.name} size={56} />
        ) : (
          // No resolved identity yet: a quiet neutral mark, never the amber accent.
          <span
            aria-hidden
            className="ad-surface grid size-14 place-items-center rounded-full bg-surface-2 text-foreground-tertiary"
          >
            <Sparkles className="size-6" />
          </span>
        )}

        <div className="flex flex-col gap-2">
          {headlineIsWelcomeBackNamed ? (
            // Returning user with a NAMED agent: warm, name-bearing welcome-back.
            <h1 className="font-heading text-3xl leading-tight font-medium tracking-tight text-foreground md:text-[2.5rem]">
              Welcome back to {friendly}
            </h1>
          ) : headlineIsWelcomeBack ? (
            // Returning user with unnamed/default agent: warm welcome-back framing.
            <h1 className="font-heading text-3xl leading-tight font-medium tracking-tight text-foreground md:text-[2.5rem]">
              Welcome back
            </h1>
          ) : named ? (
            // Genuine first-run introduction to a named agent.
            <h1 className="font-heading text-3xl leading-tight font-medium tracking-tight text-foreground md:text-[2.5rem]">
              Meet {friendly}
            </h1>
          ) : (
            <h1 className="font-wordmark text-4xl leading-tight tracking-tight text-foreground md:text-5xl">
              Agent Deck
            </h1>
          )}
          <p className="max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
            {subhead}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* The ONE governed amber action on the whole surface. On Home it carries
              real weight next to the 56px face + 2.5rem headline — h-11 / 15px text /
              a 14px (rounded-xl) corner that stays within the ≤14px radius spine. */}
          <Button
            size="lg"
            onClick={() => onStartChat()}
            data-icon="inline-end"
            className="h-11 rounded-xl px-5 text-[15px]"
          >
            Start a chat
            <ArrowRight />
          </Button>
          {/* A quiet hint advertising the command palette — platform-correct key,
              and a REAL button: clicking it opens the palette via the App-owned
              `openPalette` Outlet-context action (Home doesn't own the palette
              state). Hidden on coarse-pointer (touch) devices, which have no
              keyboard for the shortcut it advertises. */}
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label="Open the command palette"
            title="Open the command palette"
            className="ad-surface inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus pointer-coarse:hidden"
          >
            <kbd className="font-sans text-[12px] font-medium text-muted-foreground">{mod}</kbd>
            <kbd className="font-sans text-[12px] font-medium text-muted-foreground">K</kbd>
          </button>
        </div>
      </div>
    </header>
  )
}

/**
 * The hero atmosphere — a FULL-WIDTH, edge-to-edge gateway banner band across the
 * top of Home: a retro 2-tone sky-blue pixel-art cathedral gateway (the brand
 * IDENTITY art, never the `--primary` accent). Spans the whole page width (it is
 * lifted out of the centered max-w-5xl column), with the gateway art pinned to the
 * RIGHT (`object-right`) so the hero text (avatar/headline/CTA) composes WITH it on
 * the OPEN LEFT.
 *
 * The empty left is INTENTIONAL atmosphere, not flat void: a soft, token-driven
 * left-edge radial glow sits behind the text (a low-opacity `color-mix` off
 * `--foreground`/`--primary` — NO glassmorphism/backdrop-blur, NO second accent),
 * so the left reads as composed space.
 *
 * Mode-aware by Tailwind's `.dark` toggle: the light banner (sky-blue on near-
 * white) shows in light mode and is `dark:hidden`; the dark banner (sky-blue on
 * dark slate) is `hidden dark:block`. Decorative + non-interactive (aria-hidden),
 * `object-cover`, and bottom fade-masked so the dashboard below sits on clean
 * --background.
 */
function GatewayBanner() {
  return (
    <div
      aria-hidden
      data-testid="hero-gateway"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 select-none overflow-hidden md:h-80"
      style={{
        maskImage: 'linear-gradient(to bottom, black 0%, black 58%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 58%, transparent 100%)',
      }}
    >
      {/* Light mode: sky-blue gateway on near-white, pinned right. */}
      <img
        src="/home-banner-light.webp"
        alt=""
        className="h-full w-full object-cover object-[72%_center] opacity-45 sm:object-right sm:opacity-100 dark:hidden"
      />
      {/* Dark mode: sky-blue gateway on dark slate, pinned right. */}
      <img
        src="/home-banner-dark.webp"
        alt=""
        className="hidden h-full w-full object-cover object-[72%_center] opacity-45 sm:object-right sm:opacity-100 dark:block"
      />
      <div className="absolute inset-y-0 left-0 w-[76%] bg-background/80 sm:hidden" />
      {/* The intentional-atmosphere left glow behind the hero text: a soft, low-
          opacity token-driven radial off the left edge. color-mix keeps it on the
          theme's own ink (no hardcoded color, no second accent), and it's faint
          enough to read as light, not a box — no glass, no backdrop-blur. */}
      <div
        data-testid="hero-left-glow"
        className="absolute inset-y-0 left-0 w-2/3"
        style={{
          background:
            'radial-gradient(60% 70% at 0% 38%, color-mix(in oklch, var(--foreground) 9%, transparent) 0%, transparent 72%)',
        }}
      />
    </div>
  )
}

/** The display name for the hero: the user-chosen displayName first, else the
 * agent's REAL profile name (the built-in agent reads as "default") — never a
 * fabricated label, identical to every other surface. */
function friendlyName(profile: ProfileLike): string {
  const dn = profile.displayName?.trim()
  if (dn) return dn
  return profile.name.trim()
}

/* -------------------------------------------------------------------------- */
/* ACT 2 — "What your agent is tending" strip                                */
/* -------------------------------------------------------------------------- */

/**
 * The at-a-glance, plain-language summary of what the agent is currently tending
 * — a warm "Connected · watching 2 schedules · 3 jobs ran today" line composed
 * ONLY from existing data (status, cron, sessions, kanban). HONEST by
 * construction: the route shows only real, non-zero facts and a calm offline
 * line when Hermes is down (see {@link summarizeTending}).
 *
 * The connection state uses the governed semantic {@link StatusDot} (ok/warn/
 * idle — never the amber action accent); the facts are quiet neutral text. The
 * only actions are the "needs your OK" jump and, when the route passes it for a
 * down agent, the Start my agent recovery; neither wears amber.
 */
function TendingStrip({
  tending,
  onOpenNeedsOk,
  startAgentAction,
}: {
  tending: TendingSummary
  onOpenNeedsOk?: () => void
  startAgentAction?: ReactNode
}) {
  const { connection, facts, idle } = tending
  const needsOk = tending.needsOk ?? 0
  // The connection dot announces a CHANGING status, so it is a polite live region.
  return (
    <section
      aria-label="What your agent is tending"
      className="ad-surface flex min-h-11 items-start gap-2.5 rounded-xl bg-card px-4 py-3.5 text-sm sm:items-center"
    >
      <StatusDot tone={connection.tone} label={connection.label} role="status" />
      <p className="min-w-0 leading-snug text-foreground">
        <span className="font-medium">{connection.label}</span>
        {/* One-click recovery rides right next to the down headline. The route
            only passes it when the deck server is up and reports the agent down,
            so an offline line with no action stays the honest "nothing to click"
            state (the deck itself is unreachable). */}
        {startAgentAction ? (
          <span className="text-muted-foreground">
            <span aria-hidden className="text-foreground-tertiary">
              {' · '}
            </span>
            {startAgentAction}
          </span>
        ) : null}
        {/* "Needs your OK" leads the facts — it is the one thing waiting on the
            user. Honest scope (deck-carried chats only) rides the tooltip; when
            nothing here is pending, NO claim is made (the deck cannot see
            Telegram/CLI approvals, so silence is the only honest zero state). */}
        {needsOk > 0 && onOpenNeedsOk ? (
          <span className="text-muted-foreground">
            <span aria-hidden className="text-foreground-tertiary">
              {' · '}
            </span>
            <button
              type="button"
              onClick={onOpenNeedsOk}
              data-testid="tending-needs-ok"
              title={NEEDS_OK_COPY.scope}
              className="rounded font-medium text-warning underline-offset-2 hover:underline focus-visible:ad-focus"
            >
              {NEEDS_OK_COPY.line(needsOk)}
            </button>
          </span>
        ) : null}
        {facts.length > 0 ? (
          <span className="text-muted-foreground">
            {facts.map((fact) => (
              <span key={fact}>
                <span aria-hidden className="text-foreground-tertiary">
                  {' · '}
                </span>
                {fact}
              </span>
            ))}
          </span>
        ) : idle && needsOk === 0 ? (
          <span className="text-muted-foreground">
            <span aria-hidden className="text-foreground-tertiary">
              {' · '}
            </span>
            all quiet, ready when you are
          </span>
        ) : null}
      </p>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* ACT 2 — Jump back in / first-run starter prompts                          */
/* -------------------------------------------------------------------------- */

function JumpBackIn({
  sessions,
  loading,
  error,
  onResume,
  onStartChat,
  onRetry,
  now,
}: {
  sessions: SessionSummary[]
  loading: boolean
  error: boolean
  onResume: (id: string) => void
  onStartChat: (prompt?: string) => void
  onRetry?: () => void
  now: number
}) {
  const firstRun = !loading && !error && sessions.length === 0

  return (
    <section aria-labelledby="home-jump-back" className="flex flex-col gap-3">
      <h2 id="home-jump-back" className="ad-section-label">
        {firstRun ? 'Start here' : 'Jump back in'}
      </h2>
      {loading ? (
        <SessionCardSkeletons />
      ) : error ? (
        <ErrorState
          icon={MessageSquareWarning}
          title="Couldn't load recent chats"
          description="Your starter prompts are hidden until Agent Deck knows whether there are real sessions to resume."
          onRetry={onRetry}
          className="items-start px-4 py-5 text-left sm:px-5"
        />
      ) : firstRun ? (
        <StarterPrompts onStartChat={onStartChat} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <RecentCard session={session} onResume={onResume} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A "Jump back in" recognition card — built to be recognized at a glance, not
 * read: the source glyph + label, the model, a last-message snippet, and the
 * relative time. One click resumes the SAME hermes session.
 */
function RecentCard({
  session,
  onResume,
  now,
}: {
  session: SessionSummary
  onResume: (id: string) => void
  now: number
}) {
  const title =
    sanitizeSessionPreview(session.title) ||
    sanitizeSessionPreview(session.preview) ||
    'Untitled conversation'
  const source = sessionSourceMeta(session)
  const snippet = sanitizeSessionPreview(session.preview)
  const showSnippet = snippet && snippet !== title

  return (
    <button
      type="button"
      onClick={() => onResume(session.id)}
      className={cn(
        'ad-surface ad-surface-hover group/card flex h-full min-h-24 w-full flex-col gap-2 rounded-xl bg-card px-4 py-3.5 text-left transition-colors',
        'focus-visible:ad-focus',
      )}
    >
      <span className="flex items-start gap-2">
        {session.is_active ? (
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success"
            role="img"
            aria-label="Active"
            title="Active"
          />
        ) : null}
        <span className="line-clamp-1 min-w-0 flex-1 text-sm leading-snug font-medium text-foreground">
          {title}
        </span>
        <ArrowRight
          className="mt-0.5 size-4 shrink-0 text-foreground-tertiary opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-visible/card:opacity-100"
          aria-hidden
        />
      </span>

      {showSnippet ? (
        <span className="line-clamp-1 text-13 leading-snug text-muted-foreground">{snippet}</span>
      ) : null}

      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-tertiary">
        <span
          className={cn('size-1.5 shrink-0 rounded-full', SOURCE_DOT_TONE[source.tone])}
          role="img"
          aria-label={source.label}
          title={source.label}
        />
        <span className="truncate">{recentMeta(session, now).join(' · ')}</span>
      </span>
    </button>
  )
}

/** The card's quiet meta line: source label · model · relative time. */
function recentMeta(session: SessionSummary, now: number): string[] {
  const parts = [sessionSourceMeta(session).label]
  if (session.model) parts.push(shortModel(session.model))
  parts.push(formatRelative(session.last_active, now))
  return parts.filter(Boolean)
}

/** "anthropic/claude-sonnet-4" → "claude-sonnet-4" (last path segment). */
function shortModel(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}

/** Maps a governed source tone to its semantic dot color (never amber). */
const SOURCE_DOT_TONE: Record<ReturnType<typeof sessionSourceMeta>['tone'], string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-foreground-tertiary',
}

function SessionCardSkeletons() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          data-testid="home-session-skeleton"
          className="ad-surface flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5"
        >
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* First-run — dual-audience starter prompts                                 */
/* -------------------------------------------------------------------------- */

interface StarterPrompt {
  key: string
  /** The prompt seeded into the composer when chosen. */
  prompt: string
  /** A short audience cue shown under the prompt (never amber). */
  audience: string
  icon: LucideIcon
}

/**
 * Dual-audience starters — one newcomer, one everyday, one builder — so the empty
 * Home teaches by example rather than assuming a coder. Each one-click starts a
 * chat with the prompt text seeded.
 */
const STARTER_PROMPTS: StarterPrompt[] = [
  {
    key: 'newcomer',
    prompt: 'Help me get started with Hermes',
    audience: 'New to Hermes',
    icon: Sparkles,
  },
  {
    key: 'everyday',
    prompt: 'Turn this goal into a weekly plan',
    audience: 'Planning',
    icon: CalendarRange,
  },
  {
    key: 'builder',
    prompt: 'Break down a goal or project idea into steps',
    audience: 'Building & planning',
    icon: FileSearch,
  },
]

function StarterPrompts({ onStartChat }: { onStartChat: (prompt?: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[60ch] text-13 leading-relaxed text-muted-foreground">
        New here? Talk to Hermes in plain language. It can reason with you, inspect local work when
        you ask, and pause for your OK before risky actions; that approval keeps you in control.
      </p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {STARTER_PROMPTS.map((p) => (
          <li key={p.key}>
            <StarterPromptCard prompt={p} onStartChat={onStartChat} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function StarterPromptCard({
  prompt,
  onStartChat,
}: {
  prompt: StarterPrompt
  onStartChat: (prompt?: string) => void
}) {
  const { icon: Icon } = prompt
  return (
    <button
      type="button"
      onClick={() => onStartChat(prompt.prompt)}
      className={cn(
        'ad-surface ad-surface-hover group/starter flex h-full min-h-28 w-full flex-col items-start gap-2 rounded-xl bg-card px-4 py-3.5 text-left transition-colors',
        'focus-visible:ad-focus',
      )}
    >
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-muted text-foreground-tertiary transition-colors group-hover/starter:bg-primary/15 group-hover/starter:text-primary"
      >
        <Icon className="size-4" />
      </span>
      <span className="text-sm leading-snug font-medium text-foreground">"{prompt.prompt}"</span>
      <span className="text-[11px] text-foreground-tertiary">{prompt.audience}</span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* ACT 2 — Status band                                                       */
/* -------------------------------------------------------------------------- */

function StatusBand({
  status,
  hermesReachable,
  installedVersion,
  usage,
  onNavigate,
}: {
  status?: AgentDeckStatus
  hermesReachable?: boolean
  installedVersion?: string | null
  usage?: UsageSummary
  onNavigate: (path: string) => void
}) {
  // Prefer the INSTALLED version (System probe) over the running gateway's
  // self-reported version so Home matches the System page and the user's install.
  const version = formatVersion(installedVersion ?? status?.version)
  const fleet = summarizeFleet(status)
  const usageLine = summarizeUsageLine(usage)
  const detailedStatusUnavailable = status === undefined
  // A reachable health probe is a narrower truth than `/status`: it says Hermes is
  // available, but not how many platforms/sessions are live. Use it only to avoid
  // false "offline" copy; do not fabricate version/fleet/activity facts from it.
  const hermesAvailable = !detailedStatusUnavailable || hermesReachable === true

  return (
    <section aria-label="Status" className="ad-surface rounded-xl bg-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        {/* Hermes version + update badge (read-only — no maintenance action on Home). */}
        <StatusItem icon={Server} label="Hermes Agent">
          {version ? (
            <span className="font-medium text-foreground">{version}</span>
          ) : (
            <span className="text-foreground-tertiary">
              {detailedStatusUnavailable ? (hermesAvailable ? 'available' : 'offline') : 'unknown'}
            </span>
          )}
          {status?.configUpdateAvailable ? (
            // Read-only on Home — no disconnecting action on the front door; the
            // badge deep-links to the System maintenance dock where the honest
            // update flow (with its real cost confirm) lives. A Link, no layout
            // change beyond the existing chip.
            // "Config update" is precise: configUpdateAvailable signals a CONFIG-
            // level update (not a version bump), so the generic "Update available"
            // was misleading. Use the specific label for honesty.
            <Badge variant="warning" asChild className="ml-2">
              <Link to="/system">Config update</Link>
            </Badge>
          ) : null}
        </StatusItem>

        {/* connected channel dots */}
        <StatusItem icon={Activity} label="Connections">
          {detailedStatusUnavailable ? (
            <span className="text-foreground-tertiary">
              {hermesAvailable ? 'available' : 'unavailable'}
            </span>
          ) : fleet.total === 0 ? (
            <span className="text-foreground-tertiary">none connected</span>
          ) : (
            <FleetDots fleet={fleet} />
          )}
        </StatusItem>

        {/* one-line usage snapshot — a real affordance to the full Usage surface.
            A button (not a Link) so it routes through onNavigate, which also marks
            the user onboarded, matching the rest of Home's navigation. */}
        {usageLine ? (
          <button
            type="button"
            onClick={() => onNavigate('/usage')}
            className="group/usage inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus"
            title="Open Usage"
          >
            {usageLine}
            <ArrowRight
              className="size-3.5 text-foreground-tertiary opacity-0 transition-opacity group-hover/usage:opacity-100 group-focus-visible/usage:opacity-100"
              aria-hidden
            />
          </button>
        ) : null}
      </div>

      {detailedStatusUnavailable ? (
        <p className="mt-2 text-xs leading-relaxed text-foreground-tertiary">
          {hermesAvailable
            ? 'Detailed live status is unavailable right now; Hermes is reachable.'
            : "Live status is offline right now; this doesn't affect chatting."}
        </p>
      ) : null}
    </section>
  )
}

function StatusItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
      <span className="text-foreground-tertiary">{label}</span>
      <span className="flex items-center">{children}</span>
    </span>
  )
}

function FleetDots({ fleet }: { fleet: ReturnType<typeof summarizeFleet> }) {
  const label =
    fleet.troubled > 0
      ? `${fleet.connected} connected, ${fleet.troubled} need attention`
      : `${fleet.connected} of ${fleet.total} connected`
  // One labelled summary on the wrapper (the meaning); the per-source dots use the
  // shared StatusDot for governed semantic color (ok=success / warn=warning, never
  // the accent) and a warn SHAPE cue, but are aria-hidden so the summary stays the
  // single announcement.
  return (
    <span className="flex items-center gap-1" role="img" aria-label={label} title={label}>
      {Array.from({ length: fleet.connected }).map((_, i) => (
        <StatusDot key={`ok-${i}`} tone="ok" label="connected" aria-hidden />
      ))}
      {Array.from({ length: fleet.troubled }).map((_, i) => (
        <StatusDot key={`bad-${i}`} tone="warn" label="needs attention" aria-hidden />
      ))}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* ACT 2 — Active recently (cross-source fleet)                              */
/* -------------------------------------------------------------------------- */

/**
 * The cross-source "Active recently" fleet section — telegram / cron / cli
 * heartbeat from the hermes dashboard, supplied as the self-fetching
 * {@link ActiveRecentlyBand} by HomeRoute. It expands on the StatusBand's
 * at-a-glance connection summary with per-source detail + an active-session
 * count, and carries its own loading / down states.
 */
function ActiveRecently({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="home-active-recently" className="flex flex-col gap-3">
      <h2 id="home-active-recently" className="ad-section-label">
        Active recently
      </h2>
      <div className="ad-surface rounded-xl bg-card px-4 py-3.5">{children}</div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* ACT 2 — What's new                                                        */
/* -------------------------------------------------------------------------- */

function WhatsNew({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const entries = RECENT_CHANGELOG

  return (
    <section aria-labelledby="home-whats-new" className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="home-whats-new-panel"
        className={cn(
          'group/disclosure flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left',
          'focus-visible:ad-focus',
        )}
      >
        <span id="home-whats-new" className="ad-section-label">
          What's new
        </span>
        <ChevronDown
          className={cn(
            'size-4 text-foreground-tertiary transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <ul id="home-whats-new-panel" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="ad-surface rounded-xl bg-card px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-foreground">{entry.title}</p>
                <span className="text-[11px] text-foreground-tertiary">
                  {formatChangelogDate(entry.date)}
                </span>
              </div>
              <p className="mt-1 text-13 leading-relaxed text-muted-foreground">{entry.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

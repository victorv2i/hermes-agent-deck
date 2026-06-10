import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useSessions } from '@/features/sessions/hooks'
import { useStatus } from '@/features/activity/useStatus'
import { useSystem } from '@/features/system/useSystem'
import { ActiveRecentlyBand } from '@/features/activity/ActiveRecentlyBand'
import { useUsage } from '@/features/usage/useUsage'
import { useProfiles } from '@/features/profiles/useProfiles'
import { useJobs } from '@/features/jobs/hooks'
import { useKanbanBoard } from '@/features/kanban/hooks'
import { useOnboarded } from '@/lib/useOnboarded'
import { fetchHealth, homeHealthKey } from '@/lib/api'
import { StartAgentButton } from '@/features/system/StartAgentButton'
import { useChatStore } from '@/state/useChatStore'
import { CHAT_PATH, type ChatOutletContext } from '@/app/navigation'
import { HomePage } from './HomePage'
import { summarizeTending } from './tendingSummary'
import type { ProfileLike } from '@/features/profiles/avatarForProfile'

/** How many recent sessions the "Jump back in" row shows (spec §2.2: 3-5). */
const JUMP_BACK_LIMIT = 4

/** The usage window the status-strip snapshot rolls up. */
const USAGE_WINDOW_DAYS = 7

/**
 * HomeRoute — the connected Home front door (the integrator lazy-mounts this at
 * `/home`). Wires the live data (recent sessions, cross-source status, the
 * rolling usage window) and the navigation/onboarding side effects into the
 * presentational {@link HomePage}.
 *
 * First-run contract (spec §2): any first action — starting a chat, resuming a
 * session, or jumping to a workspace surface — marks the user "onboarded", so
 * the integrator's landing logic sends them straight to Chat next time. Reads
 * ride the app-wide QueryClient; status + usage are gated to this surface being
 * mounted and degrade calmly (HomePage renders an offline-but-fine strip) when
 * the dashboard is unreachable — never an error wall.
 */
export function HomeRoute() {
  const navigate = useNavigate()
  const [onboarded, markOnboarded] = useOnboarded()
  // The App layout owns the ⌘K palette's open state and hands its `openPalette`
  // action down the Outlet context (Home is a routed surface like Chat); the
  // hero's ⌘K hint chip drives it through the presentational prop.
  const { openPalette } = useOutletContext<ChatOutletContext>()

  const sessions = useSessions({ limit: JUMP_BACK_LIMIT })
  // Polls only while Home is mounted; a failure surfaces as `undefined` data,
  // which HomePage's status strip renders as a calm "offline" line.
  const status = useStatus(true)
  // The INSTALLED hermes version (same `/system` probe the System page uses). Home's
  // `/status` carries the RUNNING gateway version, which lags the install until the
  // daemon is restarted; the front door shows the installed version so it agrees with
  // the System page and the user's "my hermes version". One cheap focus-refetched read.
  const system = useSystem()
  const installedVersion = system.data?.hermes.currentVersion ?? undefined
  const usage = useUsage(USAGE_WINDOW_DAYS)
  // Home needs dynamic Hermes reachability, not the shell's session-cached bind
  // posture. Keep a separate finite-stale query so a later Hermes outage/recovery
  // cannot leave the front door showing stale "available" copy.
  const health = useQuery({
    queryKey: homeHealthKey,
    queryFn: fetchHealth,
    staleTime: 15_000,
    refetchInterval: status.isError ? 15_000 : false,
    retry: false,
  })
  const hermesReachable = health.isError ? undefined : health.data?.hermes.reachable
  const detailedStatus = status.isError ? undefined : status.data
  // One-click recovery gating for the tending strip's down headline. Honest rule:
  // offer the Start button only when the deck's own server ANSWERED a probe and
  // that answer says the agent is down — either `/health` resolved with
  // `reachable: false` (the "Hermes is offline" branch), or `/status` resolved
  // with the gateway not running. When `/health` itself fails the deck server is
  // unreachable too, so a restart call could not land: no action is offered.
  // These two conditions are exactly the summarizer's down branches, so the chip
  // can never sit next to a "Connected" headline.
  const agentDown =
    (detailedStatus === undefined && hermesReachable === false) ||
    detailedStatus?.gatewayRunning === false
  // The agent roster — drives the identity hero's face + "Meet <name>" headline.
  const profiles = useProfiles()
  const activeProfile = resolveActiveProfile(profiles.data)

  // The "what your agent is tending" strip is composed ENTIRELY from existing
  // hooks — no new server route. Jobs + kanban join the already-loaded status to
  // form the plain-language summary; each degrades to "nothing to report" on its
  // own, and the whole strip is omitted until status has resolved at least once.
  const jobs = useJobs()
  const board = useKanbanBoard()
  // An unanswered approval gate in the deck's live chat (the single `/chat-run`
  // conversation this app carries — its store is global, so Home sees it). This
  // is the honest scope: approvals from Telegram/CLI runs never reach this
  // socket and are never counted or claimed.
  const pendingApprovals = useChatStore((s) => (s.pendingApproval ? 1 : 0))
  // eslint-disable-next-line react-hooks/purity -- read-only render clock for "ran today"; only consumed by the pure summarizer.
  const now = Date.now()
  const tending = detailedStatus
    ? summarizeTending({
        status: detailedStatus,
        jobs: jobs.data,
        board: board.data,
        pendingApprovals,
        now,
      })
    : status.isError || pendingApprovals > 0
      ? // Honest fallback: `/status` failed; health can only prove reachability.
        // (Also taken while status is still loading IF an approval is waiting —
        // a gate on the user must never hide behind a slow dashboard read.)
        summarizeTending({
          status: undefined,
          hermesReachable,
          jobs: undefined,
          board: undefined,
          pendingApprovals,
          now,
        })
      : undefined

  const onStartChat = useCallback(
    (prompt?: string) => {
      markOnboarded()
      // Land on Chat with the first-run hand-off ChatRoute reads from
      // location.state: `focusComposer` lands the cursor in the composer, and a
      // starter prompt rides along as `draft` for the composer to seed.
      navigate(CHAT_PATH, { state: { focusComposer: true, draft: prompt } })
    },
    [markOnboarded, navigate],
  )

  const onResumeSession = useCallback(
    (id: string) => {
      markOnboarded()
      // The established resume contract: Chat reads `?continue=<id>` and resumes
      // the SAME hermes session (see features/sessions/WIRING.md).
      navigate(`${CHAT_PATH}?continue=${encodeURIComponent(id)}`)
    },
    [markOnboarded, navigate],
  )

  const onNavigate = useCallback(
    (path: string) => {
      markOnboarded()
      navigate(path)
    },
    [markOnboarded, navigate],
  )

  // "Needs your OK" → land on the LIVE conversation (plain /chat, no :id): the
  // chat store still holds the in-flight run + its approval card, and the App
  // layout reflects the live session id into the URL itself. Navigating to
  // /chat/:id here would instead trigger the history rehydration effect and
  // clobber the live transcript.
  const onOpenNeedsOk = useCallback(() => {
    markOnboarded()
    navigate(CHAT_PATH)
  }, [markOnboarded, navigate])

  return (
    <HomePage
      activeProfile={activeProfile}
      recentSessions={sessions.data?.sessions ?? []}
      sessionsLoading={sessions.isLoading}
      sessionsError={sessions.isError}
      status={detailedStatus}
      hermesReachable={hermesReachable}
      installedVersion={installedVersion}
      usage={usage.data}
      tending={tending}
      onboarded={onboarded}
      onStartChat={onStartChat}
      onOpenPalette={openPalette}
      onResumeSession={onResumeSession}
      onOpenNeedsOk={onOpenNeedsOk}
      startAgentAction={agentDown ? <StartAgentButton /> : undefined}
      onRetrySessions={() => {
        void sessions.refetch()
      }}
      onNavigate={onNavigate}
      // Cross-source fleet band — self-fetching, shares Home's `/status` query
      // (one deduped poll). Kept enabled: the front door always wants fleet status.
      activeRecently={<ActiveRecentlyBand enabled />}
    />
  )
}

/**
 * The active agent's identity for the hero — the profile flagged active, else the
 * default, else the first. Returns undefined while the roster loads (the hero
 * shows the Agent Deck wordmark until a face resolves), so there is no flicker of
 * the wrong name.
 */
function resolveActiveProfile(
  data: ReturnType<typeof useProfiles>['data'],
): ProfileLike | undefined {
  const profiles = data?.profiles
  if (!profiles || profiles.length === 0) return undefined
  const activeName = data?.active
  const active =
    profiles.find((p) => p.name === activeName) ?? profiles.find((p) => p.isDefault) ?? profiles[0]
  if (!active) return undefined
  return {
    name: active.name,
    isDefault: active.isDefault,
    avatar: active.avatar,
    displayName: active.displayName,
  }
}

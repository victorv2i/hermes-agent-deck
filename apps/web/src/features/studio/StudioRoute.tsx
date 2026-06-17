import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStatus } from '@/features/activity/useStatus'
import { useJobs } from '@/features/jobs/hooks'
import { useKanbanBoard } from '@/features/kanban/hooks'
import { useProfiles } from '@/features/profiles/useProfiles'
import { NewAgentDialog } from '@/features/profiles/NewAgentDialog'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import { summarizeTending } from '@/features/home/tendingSummary'
import { useOnboarded } from '@/lib/useOnboarded'
import { toast } from '@/lib/toast'
import { CHAT_PATH } from '@/app/navigation'
import { SurfaceFallback } from '@/components/layout/SurfaceFallback'
import { useAwayDigest } from '@/features/home/awayDigest/useAwayDigest'
import { AwayDigestCard } from '@/features/home/awayDigest/AwayDigestCard'
import { StudioPage } from './StudioPage'
import { ImportAgentDialog } from './ImportAgentDialog'
import type { LaunchpadStatus } from './StudioLaunchpad'
import {
  cloneName,
  resolveSelectedAgent,
  resolveStudioSection,
  resolveStudioView,
  type StudioSection,
  type StudioView,
} from './state/selection'
import { useCreateStudioProfile } from './hooks'

// The GLOBAL Connections surface, embedded as the Studio's "Connections" view.
// Reused unchanged (it keeps its own internal Voice/Messaging/MCP/Pairing/
// Webhooks/Credentials sub-tabs); code-split so its chunk only loads when the
// Connections view is opened.
const ConnectionsRoute = lazy(() =>
  import('@/features/connections').then((m) => ({ default: m.ConnectionsRoute })),
)

/** The query param the Studio uses to address the open agent (a cross-device deep link). */
const AGENT_PARAM = 'agent'
/** The query param the Studio uses to address the open workbench section. */
const SECTION_PARAM = 'section'
/** The query param the Studio uses to address the top-level view (agents/connections). */
const VIEW_PARAM = 'view'

/**
 * StudioRoute — the connected Agent Studio surface, mounted as Home (`/`). Wires
 * the top-level view switch (`?view=agents|connections`), the roster + the
 * selection/section deep link (`?agent=` / `?section=`, so a shared link or a
 * refresh lands on the same agent + section), the launchpad's tending status (the
 * shared status hook + jobs/board, same compose as the old Home), and the
 * create/clone flows into the presentational {@link StudioPage}. The global
 * Connections surface is embedded as the "Connections" view (reused unchanged).
 *
 * Deep links: `/profiles/:name` redirects (router.tsx) to `/?agent=<name>`, and
 * `/connections` (+ `/voice` · `/messaging` · `/mcp`) redirect to
 * `/?view=connections[&tab=…]`, so the canonical Studio URL is `/` + the params;
 * this route is the single place that resolves them against the live roster.
 */
export function StudioRoute() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [, markOnboarded] = useOnboarded()
  const [hatchOpen, setHatchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const profiles = useProfiles()
  // Memoize the roster derivation so its identity is stable across renders (it
  // feeds the rosterNames memo + the pure agent resolver).
  const roster = useMemo(() => profiles.data?.profiles ?? [], [profiles.data])
  const rosterNames = useMemo(() => roster.map((p) => p.name), [roster])

  // Resolve the open agent: the `?agent=` deep link if it's real, else the active
  // profile, else the first agent (the pure resolver skips stale/phantom names).
  const requestedAgent = params.get(AGENT_PARAM)
  const selectedAgent = resolveSelectedAgent({
    selected: requestedAgent,
    active: profiles.data?.active,
    roster: rosterNames,
  })
  const selectedProfile = roster.find((p) => p.name === selectedAgent) ?? null
  const section = resolveStudioSection(params.get(SECTION_PARAM))
  // The top-level view: the roster ("agents", default) or the global Connections
  // surface. Addressed by `?view=` so the `/connections` redirect + deep links
  // land on the right view.
  const view = resolveStudioView(params.get(VIEW_PARAM))

  // The launchpad's tending status — composed from the shared status hook + jobs
  // + board (the same honest summary the old Home showed), then projected to the
  // launchpad's slim {tone,label,facts} shape.
  const status = useStatus(true)
  const jobs = useJobs()
  const board = useKanbanBoard()
  const detailedStatus = status.isError ? undefined : status.data
  // eslint-disable-next-line react-hooks/purity -- read-only render clock for "ran today"; only consumed by the pure summarizer.
  const now = Date.now()
  const launchpadStatus: LaunchpadStatus | undefined = useMemo(() => {
    const tending = detailedStatus
      ? summarizeTending({ status: detailedStatus, jobs: jobs.data, board: board.data, now })
      : status.isError
        ? summarizeTending({ status: undefined, jobs: undefined, board: undefined, now })
        : undefined
    if (!tending) return undefined
    return { tone: tending.connection.tone, label: tending.connection.label, facts: tending.facts }
  }, [detailedStatus, jobs.data, board.data, status.isError, now])

  const selectAgent = useCallback(
    (name: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(AGENT_PARAM, name)
          // Reset the section so switching agents always opens on Identity (the
          // section is per-view, not carried across an agent switch).
          next.delete(SECTION_PARAM)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const changeSection = useCallback(
    (next: StudioSection) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set(SECTION_PARAM, next)
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const changeView = useCallback(
    (next: StudioView) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'agents') {
            // "Agents" is the default view — keep the URL clean (drop `?view=`),
            // and drop the Connections-only `?tab=` so it doesn't linger.
            p.delete(VIEW_PARAM)
            p.delete('tab')
          } else {
            p.set(VIEW_PARAM, next)
          }
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const onStartChat = useCallback(() => {
    markOnboarded()
    navigate(CHAT_PATH, { state: { focusComposer: true } })
  }, [markOnboarded, navigate])

  // "While you were away": the honest on-return catch-up, computed once from the
  // sessions + jobs the app already loads (no new fetch, no poll). Null in the
  // common case (first visit, quick refresh, or nothing happened), so Home reads
  // exactly as before unless there is real news.
  const away = useAwayDigest()
  const awayDigest = away.digest ? (
    <AwayDigestCard
      digest={away.digest}
      onDismiss={away.dismiss}
      // A finished run opens its read-only transcript (the same target the rail's
      // "View transcript" uses); the jobs page is where cron runs/failures live.
      onOpenSession={(id) => navigate(`/sessions/${id}`)}
      onOpenJobs={() => navigate('/jobs')}
    />
  ) : null

  // Clone the selected agent: create+clone, then open the new agent in the Studio
  // (a deterministic suffixed id; Hermes copies config/.env/SOUL.md/skills).
  const create = useCreateStudioProfile()
  const onCloneSelected = useCallback(
    async (sourceName: string) => {
      const target = cloneName(sourceName, rosterNames)
      // A clone should wear its SOURCE's face. Hermes `--clone-from` copies
      // config/.env/SOUL.md/skills but NOT the deck's avatar sidecar, so without
      // this the new agent falls through to a name-derived default (a face
      // unrelated to what it was cloned from). Seed the source's resolved avatar
      // (its explicit choice, else its deterministic default) on the clone.
      const source = roster.find((p) => p.name === sourceName)
      const avatar = source ? resolveAvatar(source) : undefined
      try {
        const created = await create.mutateAsync({ name: target, cloneFrom: sourceName, avatar })
        toast.success(`Cloned ${sourceName} to ${created.name}`, {
          description: 'Restart your agent to apply if it is running.',
        })
        selectAgent(created.name)
      } catch (err) {
        toast.error("Couldn't clone the agent", {
          description: err instanceof Error ? err.message : 'Please try again.',
        })
      }
    },
    [create, rosterNames, roster, selectAgent],
  )

  return (
    <>
      <StudioPage
        view={view}
        onViewChange={changeView}
        connections={
          <Suspense fallback={<SurfaceFallback />}>
            <ConnectionsRoute />
          </Suspense>
        }
        profiles={roster}
        loading={profiles.loading}
        error={profiles.error}
        selectedAgent={selectedAgent}
        selectedProfile={selectedProfile}
        section={section}
        launchpadStatus={launchpadStatus}
        awayDigest={awayDigest}
        onSelectAgent={selectAgent}
        onSectionChange={changeSection}
        onStartChat={onStartChat}
        onNewAgent={() => setHatchOpen(true)}
        onCloneSelected={(name) => void onCloneSelected(name)}
        onImport={() => setImportOpen(true)}
        onRetry={() => void profiles.refetch()}
      />
      {/* The existing Hatch (birth) dialog — on create it navigates to
          `/profiles/:name`, which router.tsx redirects to `/?agent=<name>`, so
          the freshly-hatched agent opens in the Studio. */}
      <NewAgentDialog open={hatchOpen} onOpenChange={setHatchOpen} />
      {/* Import an exported .tar.gz agent back as a new one; on success it opens
          the imported agent's workbench (same navigate path as Hatch). */}
      <ImportAgentDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingNames={rosterNames}
      />
    </>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStatus } from '@/features/activity/useStatus'
import { useJobs } from '@/features/jobs/hooks'
import { useKanbanBoard } from '@/features/kanban/hooks'
import { useProfiles } from '@/features/profiles/useProfiles'
import { NewAgentDialog } from '@/features/profiles/NewAgentDialog'
import { summarizeTending } from '@/features/home/tendingSummary'
import { useOnboarded } from '@/lib/useOnboarded'
import { toast } from '@/lib/toast'
import { CHAT_PATH } from '@/app/navigation'
import { StudioPage } from './StudioPage'
import type { LaunchpadStatus } from './StudioLaunchpad'
import {
  cloneName,
  resolveSelectedAgent,
  resolveStudioSection,
  type StudioSection,
} from './state/selection'
import { useCreateStudioProfile } from './hooks'

/** The query param the Studio uses to address the open agent (a cross-device deep link). */
const AGENT_PARAM = 'agent'
/** The query param the Studio uses to address the open workbench section. */
const SECTION_PARAM = 'section'

/**
 * StudioRoute — the connected Agent Studio surface, mounted as Home (`/`). Wires
 * the roster + the selection/section deep link (`?agent=` / `?section=`, so a
 * shared link or a refresh lands on the same agent + section), the launchpad's
 * tending status (the shared status hook + jobs/board, same compose as the old
 * Home), and the create/clone flows into the presentational {@link StudioPage}.
 *
 * Deep links: `/profiles/:name` redirects (router.tsx) to `/?agent=<name>`, so
 * the canonical Studio URL is `/` + the params; this route is the single place
 * that resolves them against the live roster.
 */
export function StudioRoute() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [, markOnboarded] = useOnboarded()
  const [hatchOpen, setHatchOpen] = useState(false)

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

  const onStartChat = useCallback(() => {
    markOnboarded()
    navigate(CHAT_PATH, { state: { focusComposer: true } })
  }, [markOnboarded, navigate])

  // Clone the selected agent: create+clone, then open the new agent in the Studio
  // (a deterministic suffixed id; Hermes copies config/.env/SOUL.md/skills).
  const create = useCreateStudioProfile()
  const onCloneSelected = useCallback(
    async (sourceName: string) => {
      const target = cloneName(sourceName, rosterNames)
      try {
        const created = await create.mutateAsync({ name: target, cloneFrom: sourceName })
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
    [create, rosterNames, selectAgent],
  )

  return (
    <>
      <StudioPage
        profiles={roster}
        loading={profiles.loading}
        error={profiles.error}
        selectedAgent={selectedAgent}
        selectedProfile={selectedProfile}
        section={section}
        launchpadStatus={launchpadStatus}
        onSelectAgent={selectAgent}
        onSectionChange={changeSection}
        onStartChat={onStartChat}
        onNewAgent={() => setHatchOpen(true)}
        onCloneSelected={(name) => void onCloneSelected(name)}
        onRetry={() => void profiles.refetch()}
      />
      {/* The existing Hatch (birth) dialog — on create it navigates to
          `/profiles/:name`, which router.tsx redirects to `/?agent=<name>`, so
          the freshly-hatched agent opens in the Studio. */}
      <NewAgentDialog open={hatchOpen} onOpenChange={setHatchOpen} />
    </>
  )
}

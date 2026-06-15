import { useCallback, useEffect, useState } from 'react'
import { Link, useBlocker, useLocation, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  CircleDot,
  FileKey,
  Layers,
  Pencil,
  Server,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/state'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/utils'
import { useProfiles } from './useProfiles'
import { resolveAvatar } from './avatarForProfile'
import { AgentMemoryTabs } from './AgentMemoryTabs'
import { HatchCeremony } from './HatchCeremony'
import { EditAvatarDialog } from './EditAvatarDialog'
import { RenameAgentDialog } from './RenameAgentDialog'
import { SwitchAgentButton } from './SwitchAgentButton'
import type { ProfileSummary } from './types'

/**
 * AgentDetailPage — the per-agent HUB at `/profiles/:name`. The agent's "home,"
 * read top-to-bottom as a CHARACTER SHEET (not a config form): the FACE +
 * identity facts, then the SWITCH affordance, then the agent's inner life — Soul,
 * Memory, User (all editable) and the folded-in Skills tab. face → facts → switch
 * → soul/memory/user/skills.
 *
 * The identity is editable (click the face → the EditAvatarDialog, which sets the
 * face AND a friendly display name) and the underlying profile id is renamable
 * (the pencil → RenameAgentDialog, hidden for the reserved default agent);
 * identity uses `resolveAvatar` so the face matches every other surface. Amber
 * stays on the action accents only — the avatar/identity is never the accent.
 */
export function AgentDetailPage() {
  const { name = '' } = useParams<{ name: string }>()
  const location = useLocation()
  const { data, loading, error, refetch } = useProfiles()
  // Once a switch is applied the restart card must persist even though the roster
  // immediately reports this agent active (active_profile is written before the
  // gateway restart that applies it). Keep the affordance mounted past that flip;
  // reset when navigating to a different agent's hub.
  const [switchApplied, setSwitchApplied] = useState(false)
  const [switchAppliedFor, setSwitchAppliedFor] = useState(name)
  if (name !== switchAppliedFor) {
    setSwitchAppliedFor(name)
    setSwitchApplied(false)
  }
  // The birth ceremony plays once, when we arrive here straight from a Hatch
  // (NewAgentDialog navigates with `state.hatched`). One-shot: the flag is
  // dropped from history so a refresh or Back never replays it.
  const [hatchCelebration, setHatchCelebration] = useState(() =>
    Boolean((location.state as { hatched?: boolean } | null)?.hatched),
  )
  useEffect(() => {
    if ((location.state as { hatched?: boolean } | null)?.hatched) {
      window.history.replaceState({ ...window.history.state, usr: null }, '')
    }
  }, [location])
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [soulDirty, setSoulDirty] = useState(false)

  // A stable callback so AgentMemoryTabs' dirty-effect doesn't re-fire each render.
  const onDirtyChange = useCallback((d: boolean) => setSoulDirty(d), [])

  // Guard an unsaved Soul edit against an accidental tab close / reload.
  useEffect(() => {
    if (!soulDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [soulDirty])

  // …and against an in-app route change (switching agent / surface). beforeunload
  // only catches the tab close, so block client navigations too — but through the
  // app's themed ConfirmDialog (focus-trap + ARIA + reduced-motion), not a raw
  // window.confirm, so it matches every other guarded action in the app. The
  // blocker only arms while there are unsaved edits; `blocked` opens the dialog.
  //
  // It guards LEAVING this agent (a pathname change). It must NOT fire on the
  // hub's own `?tab=` writes — those are same-pathname and already carry their own
  // unsaved-draft confirm inside AgentMemoryTabs; double-guarding would pop two
  // dialogs (and block the tab switch the user just confirmed).
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        soulDirty && currentLocation.pathname !== nextLocation.pathname,
      [soulDirty],
    ),
  )
  const leaveBlocked = blocker.state === 'blocked'

  const profile = data?.profiles.find((p) => p.name === name)

  if (loading) return <DetailSkeleton />

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[920px] px-6 py-10">
        <ErrorState
          icon={Server}
          title="Couldn’t load this agent"
          description={error}
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  if (!profile) {
    // A just-hatched agent may not be in the (stale) roster yet — its post-create
    // refetch is still in flight, and `loading` is false because cached roster
    // data exists. Don't flash "No agent named X" during the birth; hold the
    // skeleton until it materializes, then the loaded branch plays the ceremony.
    // (handleCreate only navigates on a successful create, so a hatched agent
    // always lands here within a refetch.)
    if (hatchCelebration) return <DetailSkeleton />
    return (
      <div className="mx-auto flex w-full max-w-[920px] flex-col items-center gap-4 px-6 py-16 text-center">
        <p className="text-sm text-foreground-tertiary">
          No agent named <span className="font-mono text-foreground">{name}</span>.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/profiles">
            <ArrowLeft aria-hidden />
            Back to agents
          </Link>
        </Button>
      </div>
    )
  }

  const avatarId = resolveAvatar(profile)
  // The accurate name: a user-chosen displayName, else the agent's REAL profile
  // name (the built-in agent reads as "default") — identical to every surface.
  const friendlyName = profile.displayName?.trim() || profile.name

  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-8 sm:px-8">
      {hatchCelebration && (
        <HatchCeremony
          name={friendlyName}
          avatar={avatarId}
          onDone={() => setHatchCelebration(false)}
        />
      )}
      {/* Breadcrumb — "Agents › <name>" — so this hidden /profiles/:name detail
          reads as a child of the Agents roster, not an orphan. The first crumb is
          a real Back link to the roster; the agent name is the inert trailing
          crumb. Neutral, never amber. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex items-center gap-1 text-xs text-foreground-tertiary"
      >
        <Link
          to="/profiles"
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ad-focus"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Agents
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-foreground-tertiary">{friendlyName}</span>
      </nav>

      <Card className="sticky top-0 z-10 gap-0">
        {/* Identity header — the face you tend, then the facts. */}
        <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-start">
          <button
            type="button"
            onClick={() => setEditingAvatar(true)}
            className="group/avatar relative shrink-0 self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Edit ${friendlyName}'s identity (face & display name)`}
          >
            <Avatar avatarId={avatarId} name={profile.name} size={56} />
            <span
              aria-hidden
              className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full border border-[var(--border-strong)] bg-surface-1 text-foreground-tertiary transition-colors group-hover/avatar:text-foreground"
            >
              <Pencil className="size-3" />
            </span>
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-lg font-medium text-foreground">
                {friendlyName}
              </h1>
              {/* Real rename — hidden for the default agent (the CLI reserves it,
                  so offering a rename there would only fail: no fake affordance). */}
              {!profile.isDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRenaming(true)}
                  aria-label={`Rename ${profile.name}`}
                  className="relative text-foreground-tertiary before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Rename
                </Button>
              )}
              {profile.isDefault && (
                <Badge variant="outline" className="gap-1">
                  <Star className="size-3" aria-hidden />
                  Default
                </Badge>
              )}
              {profile.isActive && (
                <Badge variant="outline" className="gap-1">
                  <CircleDot className="size-3" aria-hidden />
                  Active
                </Badge>
              )}
            </div>
            {/* The real id stays as muted mono even when we show a friendly name. */}
            <p
              className="truncate font-mono text-xs text-foreground-tertiary"
              title={profile.displayPath}
            >
              {profile.name} · {profile.displayPath}
            </p>
          </div>

          {(!profile.isActive || switchApplied) && (
            <div className="shrink-0 self-start">
              <SwitchAgentButton name={profile.name} onApplied={() => setSwitchApplied(true)} />
            </div>
          )}
        </div>

        <CardContent className="mt-5 border-t border-border pt-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <MetaField icon={Layers} label="Model">
              {profile.model ? (
                <span className="font-mono text-13 text-foreground">{profile.model}</span>
              ) : (
                <span className="text-13 text-foreground-tertiary">Unknown</span>
              )}
              {profile.provider && (
                <Badge variant="muted" className="font-mono">
                  {profile.provider}
                </Badge>
              )}
            </MetaField>

            <MetaField icon={Sparkles} label="Skills">
              <span className="text-13 text-foreground">
                {profile.skillCount} {profile.skillCount === 1 ? 'skill' : 'skills'}
              </span>
            </MetaField>

            <MetaField icon={Server} label="Agent">
              <StatusDot
                tone={profile.gatewayRunning ? 'ok' : 'idle'}
                label={profile.gatewayRunning ? 'Agent running' : 'Agent stopped'}
              />
              <span
                className={cn(
                  'text-13',
                  profile.gatewayRunning ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {profile.gatewayRunning ? 'Agent running' : 'Agent stopped'}
              </span>
            </MetaField>

            <MetaField icon={FileKey} label="Environment">
              <StatusDot
                tone={profile.hasEnv ? 'info' : 'idle'}
                label={profile.hasEnv ? '.env present' : 'No .env'}
              />
              <span
                className={cn(
                  'text-13',
                  profile.hasEnv ? 'text-foreground' : 'text-foreground-tertiary',
                )}
              >
                {profile.hasEnv ? '.env present' : 'No .env'}
              </span>
            </MetaField>
          </dl>
        </CardContent>
      </Card>

      {/* The agent's inner life — Soul/Memory/User (all editable) + folded-in Skills. */}
      <section aria-label="Agent soul, memory & skills" className="mt-5">
        <AgentMemoryTabs
          profile={profile.name}
          isActive={profile.isActive}
          onDirtyChange={onDirtyChange}
        />
      </section>

      <EditAvatarDialog
        open={editingAvatar}
        onOpenChange={setEditingAvatar}
        name={profile.name}
        current={avatarId}
        displayName={profile.displayName}
      />

      {!profile.isDefault && (
        <RenameAgentDialog open={renaming} currentName={profile.name} onOpenChange={setRenaming} />
      )}

      {/* The unsaved-Soul leave guard, through the themed ConfirmDialog (matches
          the rest of the app's confirms). Confirm → leave; Cancel / dismiss →
          stay put. */}
      <Dialog
        open={leaveBlocked}
        onOpenChange={(open) => {
          // Closing the dialog by any means (Esc, overlay, the X) means "stay".
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leave with unsaved Soul changes?</DialogTitle>
            <DialogDescription>
              You’ve edited this agent’s Soul but haven’t saved. If you leave now, those changes are
              lost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              Stay
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              Leave without saving
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetaField({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="ad-section-label flex items-center gap-1.5">
        <Icon className="size-3 text-foreground-tertiary" aria-hidden />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div
      data-testid="agent-detail-loading"
      className="mx-auto w-full max-w-[920px] px-6 py-8"
      aria-busy="true"
    >
      <Card className="gap-0">
        <div className="flex gap-4 px-5 pt-5">
          <div className="size-14 animate-pulse rounded-full bg-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <CardContent className="mt-5 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex flex-col gap-1.5">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export type { ProfileSummary }

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import { GatewayRestartCard } from '@/features/profiles/GatewayRestartCard'
import {
  useSwitchProfile,
  switchAppliedLine,
  switchInstantLine,
  SWITCH_RESTART_NOTE,
} from '@/features/profiles/mutations'
import { NewAgentDialog } from '@/features/profiles/NewAgentDialog'
import type { ProfileSummary } from '@/features/profiles/types'

/**
 * ProfileSwitcher — the presence-chip menu, built on `ui/dialog` (there is no
 * Popover primitive; radix gives focus-trap / keyboard / ARIA / reduced-motion).
 *
 * Avatar-led rows, ACTIVE-FIRST. Selecting a non-active agent runs the SHARED
 * `switchProfile` and then shows the ONE quiet honest status with a real browser
 * restart action. No fake "switched!".
 *
 * "Singular by default, growing feels natural": at N=1 the switcher is the SAME
 * shape (your agent + a calm New-agent entry) — no upsell, no "0 others", no
 * scarcity framing. So reaching two agents is never a NEW concept.
 */
export function ProfileSwitcher({
  open,
  onOpenChange,
  profiles,
  activeName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: ProfileSummary[]
  activeName: string
}) {
  const navigate = useNavigate()
  const switchProfile = useSwitchProfile()
  const [pendingSwitch, setPendingSwitch] = useState<{ name: string; instant: boolean } | null>(
    null,
  )
  const [creating, setCreating] = useState(false)

  // Active first, then the rest in their natural order.
  const ordered = [...profiles].sort((a, b) => {
    if (a.name === activeName) return -1
    if (b.name === activeName) return 1
    return 0
  })
  const single = profiles.length === 1

  async function handleSelect(profile: ProfileSummary) {
    if (profile.name === activeName) {
      onOpenChange(false)
      navigate(`/profiles/${encodeURIComponent(profile.name)}`)
      return
    }
    try {
      const result = await switchProfile.mutateAsync(profile.name)
      setPendingSwitch({ name: profile.name, instant: result.instant })
    } catch (err) {
      toast.error("Couldn't set the active agent", {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) setPendingSwitch(null)
    onOpenChange(next)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm gap-3">
          <DialogHeader>
            <DialogTitle>{single ? 'Your agent' : 'Switch agent'}</DialogTitle>
            <DialogDescription>
              {single
                ? 'Open your agent, or create another.'
                : 'Pick the active agent. If it has its own gateway running it takes over instantly; otherwise after a gateway restart.'}
            </DialogDescription>
          </DialogHeader>

          <ul className="grid gap-1" role="list">
            {ordered.map((profile) => {
              const isActive = profile.name === activeName
              return (
                <li key={profile.name}>
                  <button
                    type="button"
                    onClick={() => handleSelect(profile)}
                    disabled={switchProfile.isPending}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive && 'bg-surface-2',
                    )}
                  >
                    <Avatar avatarId={resolveAvatar(profile)} name={profile.name} size={32} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {/* The accurate name: displayName, else the REAL profile
                            name (the built-in agent reads as "default"). */}
                        {profile.displayName?.trim() || profile.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-foreground-tertiary">
                        {profile.model ?? 'model unknown'}
                      </span>
                    </span>
                    {isActive ? (
                      // The single sky-blue active marker (a Check, never on the avatar).
                      <Check className="size-4 shrink-0 text-primary" aria-label="Active" />
                    ) : (
                      <ArrowRight
                        className="size-4 shrink-0 text-foreground-tertiary"
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Honest post-switch status. Instant (the agent has its own reachable
              gateway) → a calm "active now" line. Otherwise → the restart-required
              line + the WHY (one agent at a time) + a real browser restart. */}
          {pendingSwitch &&
            (pendingSwitch.instant ? (
              <p
                className="flex items-center gap-2 text-sm text-foreground-secondary"
                role="status"
              >
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
                {switchInstantLine(pendingSwitch.name)}
              </p>
            ) : (
              <GatewayRestartCard
                message={switchAppliedLine(pendingSwitch.name)}
                note={SWITCH_RESTART_NOTE}
              />
            ))}

          {/* The always-present, never-pushy grow path (calm at N=1). */}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false)
                navigate('/profiles')
              }}
              className="text-foreground-tertiary"
            >
              Manage agents
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New agent
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NewAgentDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

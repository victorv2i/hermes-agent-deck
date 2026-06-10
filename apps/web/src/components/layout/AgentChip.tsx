import { useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useProfiles } from '@/features/profiles/useProfiles'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import type { ProfileSummary } from '@/features/profiles/types'
import { ProfileSwitcher } from './ProfileSwitcher'
import { restartPending } from './restartPending'

/**
 * AgentChip — the agent's PRESENCE in the chrome. A calm, persistent face + name
 * answering "which agent am I on?" at a glance (recognition over recall), and the
 * entry to the {@link ProfileSwitcher}.
 *
 * Rendered in the labeled Sidebar as a full-width quiet button: a 28px face +
 * name + muted-mono model, under the Wordmark.
 *
 * Governance: the avatar is IDENTITY (never the amber action accent). The
 * "restart to apply" marker is MUTED (a quiet neutral dot — never amber, never a
 * ConnectionDot color, no pulse): it's an honest hint that the named active agent
 * isn't the one the running gateway adopted, not an alarm.
 *
 * Identity name: every label/tooltip uses the FRIENDLY name (a user-chosen
 * displayName, else the real profile id) — never the raw id when a display name
 * exists — so the chip reads the same way the agent's face does everywhere.
 *
 * aria-label: "Active agent: <friendly-name> (<model>) — switch agent".
 */
export function AgentChip() {
  const { data } = useProfiles()
  const [open, setOpen] = useState(false)

  const profiles = data?.profiles ?? []
  const activeName = data?.active ?? 'default'
  const active =
    profiles.find((p) => p.name === activeName) ?? profiles.find((p) => p.isDefault) ?? null

  // Nothing to show until the roster loads (no skeleton flicker in the rail).
  if (!active) return null

  const restartHint = restartPending(profiles, activeName)
  const model = active.model ?? 'model unknown'
  // The accurate name: a user-chosen displayName, else the agent's REAL profile
  // name (the built-in agent reads as "default") — identical to every other surface.
  const friendly = active.displayName?.trim() || active.name
  const label = `Active agent: ${friendly} (${model}), switch agent`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className={cn(
          'ad-surface flex w-full items-center gap-2.5 rounded-lg bg-surface-1 px-2.5 py-2 text-left transition-colors',
          'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span className="relative shrink-0">
          <Avatar avatarId={resolveAvatar(active)} name={friendly} size={28} />
          {restartHint && <RestartMarker />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">{friendly}</span>
          <span className="truncate font-mono text-[11px] text-foreground-tertiary">{model}</span>
        </span>
        {restartHint && (
          <span className="shrink-0 text-[10px] text-foreground-tertiary">restart to apply</span>
        )}
      </button>
      <SwitcherFor open={open} setOpen={setOpen} profiles={profiles} activeName={activeName} />
    </>
  )
}

function SwitcherFor({
  open,
  setOpen,
  profiles,
  activeName,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  profiles: ProfileSummary[]
  activeName: string
}) {
  return (
    <ProfileSwitcher
      open={open}
      onOpenChange={setOpen}
      profiles={profiles}
      activeName={activeName}
    />
  )
}

/** A small MUTED marker — neutral surface dot, no amber, no pulse. */
function RestartMarker() {
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-[var(--border-strong)] bg-foreground-tertiary"
    />
  )
}

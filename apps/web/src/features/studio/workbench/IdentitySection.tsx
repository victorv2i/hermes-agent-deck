import { useState } from 'react'
import { CircleDot, FileKey, Layers, Pencil, Server, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/utils'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import { EditAvatarDialog } from '@/features/profiles/EditAvatarDialog'
import { RenameAgentDialog } from '@/features/profiles/RenameAgentDialog'
import { SwitchAgentButton } from '@/features/profiles/SwitchAgentButton'
import type { ProfileSummary } from '@/features/profiles/types'

/**
 * IdentitySection — the Identity section of the Studio workbench. The agent's
 * face + facts, read as a character sheet: edit the face + display name
 * (EditAvatarDialog), rename the underlying profile id (RenameAgentDialog, hidden
 * for the reserved default), switch this agent to active (SwitchAgentButton,
 * which writes `active_profile` and surfaces the honest "restart to apply"), and
 * the running / .env status.
 *
 * Reuses the existing profile dialogs + the shared avatar resolver verbatim
 * (one face everywhere). Amber stays on the action accents only; identity is
 * never the accent.
 */
export function IdentitySection({ profile }: { profile: ProfileSummary }) {
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Keep the switch affordance + its restart card mounted past the moment the
  // roster reports this agent active (active_profile is written before the
  // gateway restart that applies it).
  const [switchApplied, setSwitchApplied] = useState(false)

  const avatarId = resolveAvatar(profile)
  const friendlyName = profile.displayName?.trim() || profile.name

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
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
            <h2 className="truncate font-heading text-lg font-medium text-foreground">
              {friendlyName}
            </h2>
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
          <p className="truncate font-mono text-xs text-foreground-tertiary" title={profile.displayPath}>
            {profile.name} · {profile.displayPath}
          </p>
        </div>

        {(!profile.isActive || switchApplied) && (
          <div className="shrink-0 self-start">
            <SwitchAgentButton name={profile.name} onApplied={() => setSwitchApplied(true)} />
          </div>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
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
            className={cn('text-13', profile.gatewayRunning ? 'text-success' : 'text-muted-foreground')}
          >
            {profile.gatewayRunning ? 'Agent running' : 'Agent stopped'}
          </span>
        </MetaField>

        <MetaField icon={FileKey} label="Environment">
          <StatusDot tone={profile.hasEnv ? 'info' : 'idle'} label={profile.hasEnv ? '.env present' : 'No .env'} />
          <span className={cn('text-13', profile.hasEnv ? 'text-foreground' : 'text-foreground-tertiary')}>
            {profile.hasEnv ? '.env present' : 'No .env'}
          </span>
        </MetaField>
      </dl>

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

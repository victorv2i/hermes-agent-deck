import { useState } from 'react'
import {
  CircleDot,
  Download,
  FileKey,
  Layers,
  Loader2,
  Pencil,
  Server,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/StatusDot'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import { EditAvatarDialog } from '@/features/profiles/EditAvatarDialog'
import { RenameAgentDialog } from '@/features/profiles/RenameAgentDialog'
import { DeleteAgentDialog } from '@/features/profiles/DeleteAgentDialog'
import { SwitchAgentButton } from '@/features/profiles/SwitchAgentButton'
import type { ProfileSummary } from '@/features/profiles/types'
import { useStudioSkills, useExportStudioProfile } from '../hooks'

/**
 * IdentitySection — the Identity section of the Studio workbench. The agent's
 * face + facts, read as a character sheet: edit the face + display name
 * (EditAvatarDialog), rename the underlying profile id (RenameAgentDialog, hidden
 * for the reserved default), switch this agent to active (SwitchAgentButton,
 * which writes `active_profile` and surfaces the honest "restart to apply"), and
 * the running / .env status.
 *
 * Reuses the existing profile dialogs + the shared avatar resolver verbatim
 * (one face everywhere). The sky-blue accent stays on the action accents only; identity is
 * never the accent.
 */
export function IdentitySection({ profile }: { profile: ProfileSummary }) {
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Keep the switch affordance + its restart card mounted past the moment the
  // roster reports this agent active (active_profile is written before the
  // gateway restart that applies it).
  const [switchApplied, setSwitchApplied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const avatarId = resolveAvatar(profile)
  const friendlyName = profile.displayName?.trim() || profile.name

  // The roster's skillCount is a raw on-disk SKILL.md walk that OVER-counts
  // disabled + duplicate skills for non-active profiles (hermes only reconciles
  // the active one to the deduped set). The per-profile skills API returns the
  // true set for ANY agent, so a freshly cloned agent reads its real count
  // (matching its source) instead of an inflated number. Fall back to the roster
  // value while the scoped list loads.
  const skills = useStudioSkills(profile.name)
  const skillCount = skills.data?.length ?? profile.skillCount

  // Export this agent as a portable .tar.gz (hermes excludes credentials from the
  // archive). A browser download — no cache to touch.
  const exportProfile = useExportStudioProfile()
  const onExport = () => {
    exportProfile.mutate(profile.name, {
      onSuccess: () =>
        toast.success(`Exported ${profile.displayName?.trim() || profile.name}`, {
          description: 'Credentials are not included. Re-add provider keys after importing.',
        }),
      onError: (err) =>
        toast.error("Couldn't export the agent", {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <button
          type="button"
          onClick={() => setEditingAvatar(true)}
          className="group/avatar relative shrink-0 self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Edit ${friendlyName}'s identity (face & display name)`}
        >
          <Avatar avatarId={avatarId} name={profile.name} size={56} />
          <span
            aria-hidden
            className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-md border border-[var(--border-strong)] bg-surface-1 text-foreground-tertiary transition-colors group-hover/avatar:text-foreground"
          >
            <Pencil className="size-3" />
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate font-heading text-2xl font-semibold tracking-tight text-foreground">
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

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
        <MetaField icon={Layers} label="Model">
          {profile.model ? (
            <span className="font-mono text-13 font-medium text-foreground">{profile.model}</span>
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
          <span className="text-13 font-medium text-foreground">
            {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
          </span>
        </MetaField>

        <MetaField icon={Server} label="Agent">
          <StatusDot
            tone={profile.gatewayRunning ? 'ok' : 'idle'}
            label={profile.gatewayRunning ? 'Agent running' : 'Agent stopped'}
          />
          <span
            className={cn(
              'text-13 font-medium',
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
              'text-13 font-medium',
              profile.hasEnv ? 'text-foreground' : 'text-foreground-tertiary',
            )}
          >
            {profile.hasEnv ? '.env present' : 'No .env'}
          </span>
        </MetaField>
      </dl>

      {/* Footer actions, set apart below the facts. Export is available for EVERY
          agent (hermes excludes credentials from the archive, so it is safe for
          the default agent too). Delete is hidden for the reserved default agent
          (the CLI keeps it), and disabled while THIS agent is the active one
          (hermes binds the active profile to the running gateway, so the user
          switches away first) with an honest hint rather than a fake. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={exportProfile.isPending}
          data-testid="studio-export-agent"
          title="Download this agent as a .tar.gz (credentials excluded)"
        >
          {exportProfile.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          Export agent
        </Button>
        {!profile.isDefault && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDeleting(true)}
            disabled={profile.isActive}
            title={
              profile.isActive ? 'Switch to another agent before deleting this one' : undefined
            }
            className="text-foreground-tertiary hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete agent
          </Button>
        )}
      </div>

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

      {!profile.isDefault && (
        <DeleteAgentDialog
          open={deleting}
          name={profile.name}
          displayName={profile.displayName}
          onOpenChange={setDeleting}
        />
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
